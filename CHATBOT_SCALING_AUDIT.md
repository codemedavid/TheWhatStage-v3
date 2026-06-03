# WhatStage_V3 Messenger Chatbot — Scaling & Reliability Audit

> Goal under review: reliably handle **hundreds of concurrent conversations**, with **low latency** and **guaranteed delivery**, under bursty Facebook Messenger webhook traffic.
> Mode: analysis-only. Every recommendation below is behavior-preserving unless an explicit breaking-risk callout says otherwise.

---

## 1. Executive Summary

The hard parts of this system are **already done well** and should not be rewritten: HMAC-verified ingress with a fast 20s ack, a durable Postgres job queue, per-thread serialization via `FOR UPDATE SKIP LOCKED` + "oldest-queued-sibling" filtering, a heartbeat + stale-reclaim loop, a 1-minute safety-net cron, and outbound idempotency for text/button sends keyed on `outbound_text_fb_id` / `outbound_button_fb_id`. These are the correct primitives.

The system nonetheless **cannot meet the stated goal today**, for three reasons:

1. **Throughput is capped at roughly one conversation pipeline at a time** (THRU-1). One worker invocation drains the whole queue serially at `BATCH_SIZE=3`, so effective rate is ~7–18 jobs/min — orders of magnitude below a 100–300 inbound/min burst. Replies arrive minutes late. *Messages are not lost* (jobs persist, cron re-fires), so this is a **latency/throughput** failure, not data loss.
2. **Guaranteed delivery has real holes.** Inbound messages are silently dropped on transient ingress DB errors with a `200` returned to Meta (REL-3, no redelivery, no DLQ, invisible to the newly-installed Sentry). Retry-exhausted `failed` jobs are never alerted (REL-4). A regressed migration causes media + recommendation cards to re-send on every retry (REL-1, REL-2).
3. **Avoidable latency tax + an unbounded Graph call.** Several serial round-trips sit needlessly in front of the LLM (LAT-1/3/4/5/6), and Graph `fetch` has no timeout (LAT-2), so a single slow FB socket can pin worker slots forever because the heartbeat keeps the job "running."

The good news: **most of the highest-impact fixes are low- or zero-breaking-risk**, and the parallel-safety invariant the whole design rests on (the SQL claim) means we can scale throughput just by spawning more workers and widening the batch.

---

## 2. Architecture As-Is

**Ingress** — `src/app/api/webhooks/facebook/route.ts`
Verifies `x-hub-signature-256` (timing-safe, lines 174-186), parses, then iterates each `entry.messaging[]` event **sequentially** (128-144) calling `handleEvent()`. Per inbound event: page lookup → `isUserActive` → thread upsert on `(page_id, psid)` (389-401) → message insert deduped by `unique(fb_message_id)` (408-428) → thread-tail update (431-438) → optional config check → `messenger_jobs` insert (458-472). Returns `200 {received:true}` (171), then fires **exactly one** `triggerWorker()` via `after()` (164-166) regardless of event count.

**Worker** — `src/app/api/messenger/process/route.ts` (`maxDuration=300`)
`drainMessengerJobs` (177-198) is a serial `while (Date.now() < claimDeadline)` loop: `claimJobs(BATCH_SIZE=3)` → `await Promise.allSettled(jobs.map(runJob))` → repeat until empty or `DRAIN_DEADLINE_MS=200_000`. Per inbound job: `loadJobContext` → `ensureLead` (FB profile fetch, first-touch) → `loadReplyContext` (6 parallel queries) → `typing_on` → `answerWithClassification` (combined reply+classify LLM) → `sendOutbound` → persist → fire-and-forget reminders/summary/media/recommendations. Heartbeat every 30s; `RUNNING_STALE_MS=90s`; `MAX_ATTEMPTS=3` / `MAX_RATE_LIMIT_ATTEMPTS=10`.

**Concurrency** — `supabase/migrations/...messenger_concurrent_claim.sql` (claim RPC, now redefined in `20260514000000_agent_followup.sql:141-220`)
`claim_messenger_jobs()` (SECURITY DEFINER, service_role only) first resets stale `running` jobs (162-167), then selects queued jobs filtered by **(a)** no running sibling (184-189) and **(b)** oldest queued sibling per thread (191-200), with `FOR UPDATE SKIP LOCKED` (203). This guarantees **at most one job per `thread_id`** across concurrent invocations — the invariant that makes parallel workers safe.

**Backstop** — `supabase/migrations/20260502235749_supabase_cron_jobs.sql:83-87`: `whatstage-messenger-drain` runs `* * * * *` (every minute), POSTing `/api/cron/messenger-drain` which re-fires the worker.

**What is genuinely good (do not touch):** the per-thread SQL serialization, the mid-dedup + thread-upsert idempotency, text/button outbound idempotency, heartbeat + stale-reclaim, and the cron backstop. The refuted finding THRU-2 (see Appendix) confirms the Supabase transport is HTTP/PostgREST, so there is **no per-invocation Postgres connection held** — connection-pool exhaustion is *not* the binding limit.

---

## 3. Bottleneck Analysis (with throughput math)

### 3.1 THRU-1 — Single-worker serial drain is the dominant ceiling *(critical)*

- One trigger per webhook (`route.ts:164-166`); no fan-out, no debounce, no singleton lock found.
- Serial loop (`process/route.ts:184-196`): the next `claimJobs` does not run until the **slowest** of the current 3 jobs settles.
- Per-job cost is LLM-bound: RAG embed+RPC (~0.5–1.5s) + `typing_on` + `answerWithClassification` (5–30s, occasionally 60s+) + blocking media/recommendation sends (1–4s each).

**The math.** Effective throughput = `3 jobs / per-batch wall time`.

| Per-batch wall time | Jobs/min (1 worker) |
|---|---|
| 10s (fast LLM) | ~18 |
| 25s (LLM under load + 1 media send) | ~7 |

A burst of **100–300 inbound/min** overwhelms a ~7–18 job/min drain. The queue grows during the burst and clears only at drain rate; combined with per-thread collapse (THRU-3), hundreds of waiting threads see replies **minutes** late. Vercel Fluid in-function concurrency cannot help because there is rarely more than one worker invocation to co-locate.

**Fix (non-breaking):** raise `BATCH_SIZE` 3→8–10 (`process/route.ts:74`) **and** add bounded worker self-fan-out (after a non-empty claim, fire one extra capped `triggerWorker()` POST). The SQL claim already guarantees parallel safety. Keep the cron. *Caveat:* the alternative webhook-side multi-POST variant conflicts with `webhooks/facebook/route.test.ts:336,704` (asserts `triggerWorker` called once) — prefer the BATCH_SIZE + worker-self-fan-out path, which breaks no tests.

### 3.2 THRU-3 — Per-thread "oldest-sibling" collapse starves chatty senders *(medium, adjusted down from high)*

The claim returns at most one queued job per `thread_id` (184-200). A user who fires 5 messages advances **one per batch round**. Verdict correction: this is mostly self-mitigating — multiple concurrent invocations each cover *disjoint* threads, so distinct-thread coverage = `(concurrent invocations) × BATCH_SIZE`, not a hard cap of 3. The genuine hard limit is **per single chatty thread** (one message/round, by design, to preserve ordering). Do **not** relax per-thread one-at-a-time. THRU-1 fan-out is the right mitigation; ingress message coalescing (Phase 3) is the deeper option.

### 3.3 THRU-5 / THRU-7 / REL-8 — Drain exits early; lost wakeups *(medium)*

`claimJobs` only returns `scheduled_at <= now()` jobs (migration:182); the loop does `if (jobs.length===0) break` (186). So when only backoff-scheduled (rate-limited) jobs remain, the warm worker **exits**, and recovery waits on the next webhook or the 1-min cron. `triggerWorker` is fire-and-forget with warn-only failure (`route.ts:546-561`); under burst the internal POST competes for the same throttled Vercel pool, so dropped wakeups are *most likely exactly under load*. Fixes: sleep-until-next-`scheduled_at` instead of breaking; retry the trigger fetch once on throttle; emit a Sentry breadcrumb on trigger failure.

### 3.4 THRU-6 — `DRAIN_DEADLINE_MS` headroom is sized for typical, not worst-case *(medium)*

A pessimistic single job (`typing_on` + 30–60s LLM + 4 media + 2 recommendations) can be ~40–80s; a batch of 3 in `Promise.allSettled` ≈ 80s wall time. Claimed near t=199s it finishes near t=279s — inside `maxDuration=300` but thin. If the LLM hits its 60s+ tail, the invocation can be **killed mid-job**; the in-process heartbeat dies, the row stays `running` until 90s stale-reclaim → a cluster of frozen conversations. Fixes: lower `DRAIN_DEADLINE_MS` to ~160–170s; per-job `Promise.race` timeout; parallelize the serial media loop and product-vs-property sends.

### 3.5 Latency tax in front of / just after the LLM *(LAT-1, 3, 4, 5, 6, 7)*

| ID | Where | Cost | Fix |
|---|---|---|---|
| LAT-3 | `typing_on` awaited before LLM (`process/route.ts:533-543`) | ~0.2–0.5s + tail, **every reply** | Fire as `void ...catch()` |
| LAT-1 | `decideForceSend` awaited inside `answerWithClassification` (`classify.ts:396`) | +1 cheap-classifier LLM call on qualified path (2 in a narrow sub-case) | Return reply text + LLM's own actionPage immediately; run force-send in parallel, apply only to the **separate** button send (`process/route.ts:970+`) |
| LAT-4 | `paymentEnumBlock` serial before `retrieve` (`classify.ts:159-166`) | extra serial DB round-trip | `Promise.all(paymentEnumBlock, retrieve)` |
| LAT-5 | `extractReminder` + `activeSequenceExists` serial before `loadReplyContext` (`process/route.ts:351-415`) | extra LLM/DB hop on booking-intent messages | Start `loadReplyContext` concurrently; resolve `suppressFollowup` after reply (only gates fire-and-forget seeding) |
| LAT-6 | exact `COUNT(*)` awaited before media/recommendation sends (`process/route.ts:705, 1638-1651`) | grows with thread size; delays customer-visible media | Move after sends or approximate from in-memory history length |
| LAT-7 | `resolveSourceTitles` awaited before return (`classify.ts:424`) | DB round-trip for data the worker discards | Make optional / non-blocking on the worker path |

LAT-1 was **downgraded high→medium**: the extra calls use the 8B Groq classifier (`config.ts:16-17`) at 30–60 max tokens — sub-second, not the DeepSeek reply model — and only one call fires on the canonical already-qualified path (`force-send.ts:237` short-circuits the prereq branch). LAT-8 (prompt-cache layout) is **already optimal** given that KB context must vary per query — treat as monitoring, not a defect.

### 3.6 DB hotspots on the claim RPC *(DB-1, DB-2 — high)*

The hottest query in the system has **no supporting index** for two of its operations:

- **DB-1:** unconditional stale-reset `UPDATE ... WHERE status='running' AND started_at<=threshold` on *every* claim (`20260514000000_agent_followup.sql:162-167`). The only index is `messenger_jobs_status_idx (status, scheduled_at)` (`20260430000400:72-74`) — ordered by `scheduled_at`, not `started_at`, so Postgres evaluates the predicate per running row. (Verdict nuance: with healthy heartbeats the UPDATE usually matches **zero** rows, so steady-state lock contention is mild; the certain cost is the repeated full scan of all running rows.)
- **DB-2:** `NOT EXISTS (running sibling)` subquery (`184-189`) has no `thread_id`-leading index for running rows, so each queued candidate triggers a scan.

Both get worse once THRU-1 fan-out raises claim frequency. **Fix (pure additive, zero risk):**
```sql
CREATE INDEX IF NOT EXISTS messenger_jobs_running_started_idx
  ON public.messenger_jobs (started_at) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS messenger_jobs_running_thread_idx
  ON public.messenger_jobs (thread_id) WHERE status = 'running';
```

---

## 4. Reliability & Guaranteed Delivery

### 4.1 REL-3 — Silent inbound drop on transient DB error *(high)*

`handleEvent` returns `null` on **any** DB error (`route.ts:368-371, 384-386, 398-401, 422-427, 468-471`; `_status.ts:16-19`), and the POST still returns `200` (`171`) because the per-event catch (141-143) swallows it. **Meta does not redeliver on 200.** The `isUserActive` path drops the message *before any row is inserted* — total loss. Sentry (commit a11dd4e) does **not** catch this: the swallowing catch prevents propagation to `captureRequestError`, and there is no `captureConsoleIntegration`.

**Fix (MEDIUM breaking risk — behavior change):** distinguish "not for us / already seen" (`return null` → 200) from "our DB failed" (`throw` → 500 so Meta redelivers the batch). Make `isUserActive` throw on query error. Redelivery is idempotent via `unique(fb_message_id)` (`20260430000400:47`) + thread upsert on `(page_id,psid)`. The existing deliberate skip paths asserted in `route.test.ts` (paused owner, self-loop comment, echo) are terminal conditions and remain `null`/200.

### 4.2 REL-4 — Failed jobs invisible *(high)*

Terminal `failed` branches (`process/route.ts:1268-1300, 233-248, 260-276`, plus `src/lib/followups/fire.ts:323,353`) only `console.error`. Sentry never sees them (swallowed, no console integration). The cron only re-fires the worker; it **never resurrects `status='failed'` rows**. A Meta/OpenRouter outage can fail thousands of jobs in minutes with zero operator signal — the single largest blind spot against guaranteed delivery. **Fix (additive):** `Sentry.captureException(err, { tags:{ jobKind, threadId, jobId }, level:'error' })` in each branch; optionally a cron `COUNT(failed)` alert.

### 4.3 REL-1 / REL-2 / REL-5 — Duplicate sends on retry

- **REL-1 (high):** migration `20260502090000` added `outbound_media` to the claim RPC return; `20260514000000_agent_followup.sql:145-155, 211-219` **dropped it**. The worker still reads it (`claimJobs` coerces missing→`[]`, `process/route.ts:216-218`) and `sendSelectedMedia` builds its "already sent" set from it (`1900-1905`). So every retry re-sends up to 4 images, doubling Graph media volume against Meta's 10/sec/page ceiling. **Fix:** re-add `outbound_media jsonb` to the RPC return — worker code already references it.
- **REL-2 (medium, adjusted down from high):** product/property recommendation blocks (`767-967`) never read `outbound_button_fb_id` to short-circuit, unlike the action-page block (`1022`). Verdict correction: the recommendation block's own post-send writes are **swallowed** in local try/catch, so the realistic requeue trigger is the single final `markDone` UPDATE (`1881-1888`). **Fix:** mirror the action-page early-skip on `outbound_button_fb_id`; also skip the redundant RAG cycle on retry.
- **REL-5 (medium):** stale-reclaim re-runs the whole `runJob`; fixing REL-1 + REL-2 closes most of it. Additionally make source-image attach idempotent (write `attached_item_keys` incrementally rather than only after all sends, `738-754`).

### 4.4 REL-6 / REL-7 — OTN loss and empty-message_id duplicate

- **REL-6 (medium):** OTN token consumed *before* the Graph send and not atomic (`outbound.ts:171-180`); a failed send + retry finds it consumed → `paused` → the opted-in notification is permanently dropped. **Fix:** consume only after a confirmed `message_id`, scoped to the selected token row.
- **REL-7 (low):** `textFbId = result.messageId ?? null; if (textFbId) {...}` (`641-648`) — a rare `sent:true` with empty `message_id` never persists `outbound_text_fb_id`, so the retry re-sends, and the `null` `fb_message_id` row defeats the secondary dedupe. **Fix:** treat empty-`message_id`-but-sent as a hard failure (throw → retry).

### 4.5 LAT-2 — Unbounded Graph fetch *(high — reliability + latency)*

`postJson`/`getJson` (`messenger.ts:39-76`) call native `fetch` with **no `AbortSignal`**; undici has no default timeout. On the hot path (`typing_on` `process/route.ts:534`, `fetchMessengerProfile` `1519/1547`, every send). Because the drain awaits `Promise.allSettled` over the batch and the heartbeat keeps the job `running`, one hang **pins 3 slots, halts new claims, and is never reclaimed** — an FB blip becomes a fleet-wide stall. **Fix:** `AbortSignal.timeout` (10–15s sends, 8s profile/typing), mirroring `capi.ts:13,201`.

---

## 5. Security / Vulnerabilities (ranked by exploitability)

| # | Issue | Exploitability | Impact | Fix |
|---|---|---|---|---|
| 1 | **Silent inbound drop on DB error** (REL-3) — integrity/availability defect; 200 to Meta, no redelivery, no DLQ, invisible to Sentry | n/a (internal) | High (lost customer messages) | Throw 5xx on infra error; redelivery idempotent (see §4.1) |
| 2 | **Webhook DoS / no rate limit** (`route.ts:104-186`) — HMAC is correct (timing-safe), so forgery needs `FB_APP_SECRET`; risk is burst/valid traffic amplifying the single-worker drain | Low (forgery) / Medium (burst) | Medium | Explicit small `maxDuration` on the route; edge request shaping |
| 3 | **Service-role key compromise** (`migration ...:152`) — RPC correctly granted to service_role only, but webhook+worker bypass RLS; a leaked key = full job-queue takeover, no audit trail | Medium (requires leak) | High | Rotate/vault key; restrict egress; audit trigger on `messenger_jobs` |
| 4 | **OTN token loss / Meta policy** (REL-6, `outbound.ts:171-180`) | Low | Low–Medium | Consume after confirmed `message_id` |
| 5 | **Rate-limit detection bypass** (`process/route.ts:82-91`, `messenger.ts:21-23`) — HTTP-status string match misses Graph error envelopes (code 4/17/32/613 on 200/400), burning `MAX_ATTEMPTS=3` instead of backing off | Low | Low–Medium | Parse `error.code` from the JSON body |
| 6 | **Postback synthetic-ID collision** (`_postback.ts:18-20`) — same-ms identical postbacks hash identically; 8-hex prefix | Low | Low | Widen hash slice / include more entropy |

---

## 6. Quick Wins (Phase 0 — ship now)

All trivial/small, none/low breaking risk, behavior-preserving:

1. `AbortSignal.timeout` on `postJson`/`getJson` (`messenger.ts:39-76`). **(LAT-2)**
2. Fire `typing_on` as `void` (`process/route.ts:533-543`). **(LAT-3)**
3. Add `messenger_jobs_running_started_idx (started_at) WHERE status='running'`. **(DB-1)**
4. Add `messenger_jobs_running_thread_idx (thread_id) WHERE status='running'`. **(DB-2)**
5. Re-add `outbound_media` to the `claim_messenger_jobs` return. **(REL-1)**
6. `Sentry.captureException` on every terminal `failed` branch. **(REL-4)**
7. Raise `BATCH_SIZE` 3→8–10. **(THRU-1)**
8. `Promise.all(paymentEnumBlock, retrieve)` + relocate the `COUNT(*)` summary check off the customer-visible path. **(LAT-4, LAT-6)**

---

## 7. Phased Roadmap

### Phase 0 — Quick wins
*See §6.* Effort: trivial/small. Breaking risk: none/low.

### Phase 1 — Throughput
| Item | Effort | Breaking risk |
|---|---|---|
| `BATCH_SIZE` 3→8–10 (`process/route.ts:74`) | trivial | low (no test refs it) |
| Bounded worker self-fan-out after non-empty claim (capped extra `triggerWorker()` POST) | medium | low (SQL claim guarantees safety) |
| Drain loop: sleep-until-next-`scheduled_at` instead of `break` when only backoff jobs remain (THRU-5) | small | low |
| `triggerWorker` retry-once on throttle + Sentry breadcrumb (THRU-7/REL-8) | small | low |
| Decouple `decideForceSend` from text reply; apply override only to button send (LAT-1) | medium | low |
| `loadReplyContext` concurrent with `extractReminder` (LAT-5) | medium | low |
| Lower `DRAIN_DEADLINE_MS` ~160–170s + per-job `Promise.race` timeout (THRU-6) | medium | low |

### Phase 2 — Reliability & delivery
| Item | Effort | Breaking risk |
|---|---|---|
| Rethrow transient ingress DB errors → 5xx for Meta redelivery (REL-3) | medium | **medium** (behavior change; idempotency makes it safe) |
| Recommendation idempotency on `outbound_button_fb_id` (REL-2) | small | low |
| Idempotent source-image attach (REL-5) | medium | low |
| OTN consume after confirmed `message_id` (REL-6) | small | low |
| Empty-`message_id`-but-sent → hard failure (REL-7) | trivial | low |
| Graph error-CODE parsing in retry detection | small | low |
| Cron `COUNT(failed)` alert (REL-4 follow-up) | small | none |

### Phase 3 — Deeper architecture (only if SLO unmet after 0–2)
| Item | Effort | Breaking risk |
|---|---|---|
| Apply per-page token bucket to the **inbound** send path (currently campaign-only, `campaignSend.ts:128,255-287`) | medium | low (additive gate) |
| Make the token bucket atomic (SECURITY DEFINER `UPDATE ... RETURNING` with `tokens>=1` guard) | medium | low |
| Graduate trigger+drain to a managed queue (QStash / Vercel Queues / Inngest), keep Postgres as data model | large | medium |
| Coalesce rapid same-thread inbound into one job (THRU-3 depth) | large | medium (changes turn semantics) |
| Explicit small `maxDuration` on the webhook route (`route.ts:9-10`) | trivial | low |

---

## 8. Appendix — Cleared / Refuted Items

- **THRU-2 — "uncapped fan-out exhausts the Supabase connection pool" — REFUTED.** `createAdminClient()` (`src/lib/supabase/admin.ts`) uses `@supabase/supabase-js` → `@supabase/postgrest-js`, a stateless **HTTP** client to `/rest/v1/`. There is no raw Postgres driver anywhere (no `pg`/`@vercel/postgres`/`drizzle`/`prisma`/`new Pool`, no `DATABASE_URL`). A DB connection is consumed server-side only for each individual query, not held for the ~200s drain or during LLM/FB calls. Pool sizing scales with **concurrent in-flight queries**, not with the number of Node invocations or client objects. The "connection ceiling is the binding limit" thesis does not hold. (Two narrow sub-claims were valid but low-severity and are folded into THRU-5/REL-8: `claimJobs` returns `[]` on RPC error and the loop `break`s — mitigated by the cron — and there is no Sentry on claim-RPC failure.)
- **LAT-8 — prompt-cache layout — CLEARED.** The cache-friendly layout (static persona+stage prefix, volatile KB/summary trailing, `manilaDateBlock` last) is already optimal; per-query KB variance is inherent. Treat realized cache-hit rate as a monitoring item, not a code change.

---

### Closing note for implementers
The single most valuable change is **Phase 1 throughput** (BATCH_SIZE + worker self-fan-out) because the design's per-thread SQL claim already makes parallel workers correct — you are unlocking capacity that the architecture was built to support but never spawns. Pair it with **Phase 0 timeouts/indexes** so the new parallelism doesn't amplify the unbounded-fetch stall (LAT-2) or the un-indexed claim scans (DB-1/DB-2). Then close the **delivery holes** (REL-3, REL-4, REL-1) so "we always send the message, once" is actually true.

---

*Generated by a 38-agent analysis workflow (7 subsystem maps + 4 best-practice research tracks + 8 analysis dimensions + adversarial verification of all high/critical findings + architect synthesis). 55 findings raised, 54 survived verification, 1 refuted.*
