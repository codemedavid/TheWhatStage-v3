# AI Follow-Up Agent — Implementation Plan

Natural-language command surface for bulk, personalized Messenger follow-ups.
Example: *"Hey, follow up all my interested customers — tell them this story:
{...} — and attach this image."*

---

## 1. Goals & non-goals

### Goals
- Single command turns into N personalized Messenger messages with optional shared image.
- Audience resolved from pipeline stage (e.g. *Interested*).
- "Almost instant" feel: drafts begin streaming in <2 s, all 200 drafts in <30 s,
  send begins <1 s after confirmation.
- Honors Meta's 24h policy, opt-in, and OTN rules already enforced by
  `src/lib/messenger/outbound.ts`.
- Doesn't fatigue recipients, the FB pages, or our LLM provider.

### Non-goals (v1)
- Multi-stage / boolean audiences (`interested OR considering`)
- Scheduled/delayed sends (`tomorrow at 9am`)
- A/B variants
- Per-recipient image overrides
- Voice input
- Visual workflow builder integration

---

## 2. Latency & throughput targets

| Stage | p50 | p95 | Notes |
|---|---|---|---|
| Intent parse (1 LLM call) | 600 ms | 1.5 s | Small fast model |
| Audience resolve (SQL) | 50 ms | 150 ms | Indexed |
| Bulk context fetch | 80 ms | 200 ms | One round-trip |
| Time-to-first-draft (streamed) | 1.2 s | 2.0 s | Streamed via SSE |
| Time-to-all-drafts (200 leads) | 18 s | 30 s | Bounded fan-out |
| Dispatch enqueue (200 jobs) | 250 ms | 600 ms | Single bulk insert |
| Time-to-first-send | 400 ms | 1.0 s | Direct worker trigger |
| Total send time (200 msgs, 1 page) | 22 s | 35 s | ~7 msg/s/page pace |

**Sustained throughput design point**: 1 user × ~10 messages/sec/page,
500 messages/day default user cap, 200 messages/campaign cap.

The throughput ceiling isn't our infra — it's the **per-page Messenger rate
limit + spam-detection signal**. Pacing slower than FB's hard limit by 5×
keeps us off their radar.

---

## 3. End-to-end architecture

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │  /dashboard/agent  (Next.js App Router page, client component)      │
 │                                                                     │
 │  [ command textarea ] [ image picker ] [ Preview ]                  │
 │                                                                     │
 │   ┌───────────── live preview grid (SSE-streamed rows) ──────────┐  │
 │   │ ☑ Lead A · RESPONSE · "Hey Anna, ..." [edit] [regen]         │  │
 │   │ ☑ Lead B · OTN     · "Hi Ben, ..." [edit] [regen]            │  │
 │   │ ☐ Lead C · paused:window — no opt-in, skipped                │  │
 │   └───────────────────────────────────────────────────────────────┘  │
 │  [ Send N messages ]                                                │
 └─────────────────────────────────────────────────────────────────────┘
        │                                                ▲
        │  POST /api/agent/preview (SSE)                 │ poll/SSE for run progress
        ▼                                                │
 ┌────────────────────────┐    ┌────────────────────────────────────┐
 │ Intent parser          │    │ Run progress endpoint              │
 │  HfRouterLlm (small)   │    │  /api/agent/campaigns/:id/stream   │
 └─────────┬──────────────┘    └────────────────────────────────────┘
           │
           ▼
 ┌────────────────────────┐
 │ Audience resolver      │   one indexed SQL on leads + threads
 └─────────┬──────────────┘
           │
           ▼
 ┌────────────────────────┐
 │ Policy + context probe │   bulk reads: messenger_marketing_optins,
 │                        │   messenger_otn_tokens, messenger_messages
 └─────────┬──────────────┘
           │
           ▼
 ┌────────────────────────┐
 │ Draft fan-out          │   p-limit(8 in flight) → HfRouterLlm
 │  emits SSE per draft   │   smaller/faster model than RAG chatbot
 └─────────┬──────────────┘
           │  user clicks "Send N"
           ▼
 ┌──────────────────────────────────────────────────────────┐
 │ POST /api/agent/campaigns/:id/dispatch                   │
 │  - upserts agent_campaign_messages (idempotency keys)    │
 │  - bulk-insert N rows into messenger_jobs (kind=         │
 │    'agent_campaign_send', payload jsonb)                 │
 │  - fire-and-forget HTTP to /api/messenger/process        │
 └──────────────────────────────────────────────────────────┘
                          │
                          ▼
 ┌──────────────────────────────────────────────────────────┐
 │ Existing messenger worker (already per-thread serialized │
 │ via claim_messenger_jobs)                                │
 │  - branches on job.kind                                  │
 │    inbound_reply       → existing handler                │
 │    agent_campaign_send → sendOutbound() with             │
 │                          kind='workflow_human_agent'     │
 │                          or 'bot' depending on policy    │
 │  - per-page token-bucket pacing (NEW)                    │
 │  - updates agent_campaign_messages.status                │
 │  - bumps agent_campaigns.sent / failed counters          │
 └──────────────────────────────────────────────────────────┘
```

The hot path **reuses every piece of existing infra**:
- `messenger_jobs` queue + `claim_messenger_jobs` RPC (per-thread serialized)
- `sendOutbound` (channel-policy aware)
- `HfRouterLlm` (LLM transport)
- `media_assets` (image storage)
- `messenger_threads.last_inbound_at` (24h-window source of truth)

What's new: a thin command-parsing UI, a draft fan-out endpoint, two campaign
tables, and per-page pacing.

---

## 4. Scaling strategy

### 4.1 Latency: streaming over batching
The user sees nothing until results arrive. We avoid the "200-lead spinner" by
streaming each draft over SSE the moment it's generated.

- **`/api/agent/preview` is an SSE endpoint** (`Content-Type: text/event-stream`).
- Server emits events as it processes: `audience`, `draft`, `done`, `error`.
- Client renders rows incrementally; first row visible at p95 < 2 s even when
  total drafts take 30 s.

Implementation: Vercel Functions support streaming Response bodies. Use
`ReadableStream` + `TextEncoder`; no extra infra needed.

### 4.2 Concurrency: bounded fan-out, not unbounded
Fanning out 200 LLM calls in parallel will hit HF Router rate limits and bury
latency for everyone else.

```ts
const limit = pLimit(8) // tunable, env-driven
await Promise.all(
  leads.map((l) => limit(() => generateDraft(l, intent)))
)
```

Rule of thumb: **concurrency ≈ provider RPS budget / per-call wall time**.
HF Router on Llama 3.1-8B-Instruct (recommended for drafts) sustains ~30
RPS comfortably; 8-way concurrency at ~1.5 s/call yields ~5 RPS — safe.

A larger 70B model is overkill here. Drafts are short, formulaic, and
benefit more from speed than from reasoning depth. **Use `meta-llama/Llama-3.1-8B-Instruct:groq` for drafts; keep 70B for the existing RAG chatbot.**

### 4.3 Throughput: per-page token bucket
Sending 200 messages in 5 seconds → spam flag. Cap each page at a steady rate.

Add a Postgres-based token bucket (no Redis needed):

```sql
create table messenger_page_rate_buckets (
  page_id uuid primary key references facebook_pages(id),
  tokens int not null default 10,
  capacity int not null default 10,
  refill_per_sec int not null default 7,   -- ~7 msg/sec/page
  last_refill_at timestamptz not null default now()
);
```

The send worker's tight loop:
1. Begin tx, `select ... for update` the bucket row.
2. Refill: `tokens = least(capacity, tokens + floor(elapsed * refill_per_sec))`.
3. If `tokens >= 1`, decrement and proceed; else schedule retry at
   `now() + (1 / refill_per_sec) seconds` and exit.

Refill_per_sec is configurable per page — start at 7 (well below FB limits),
adjust as we see throttle responses.

### 4.4 Worker scaling: trigger on enqueue, don't wait for cron
The `messenger_jobs` worker today is cron-driven (1-min cycle on Supabase
pg_cron). For "almost instant" we **fire a non-blocking HTTP request to
`/api/messenger/process`** immediately after enqueue:

```ts
fetch(`${BASE_URL}/api/messenger/process`, {
  method: 'POST',
  headers: { 'x-worker-secret': WORKER_SECRET },
  // intentionally not awaited
})
```

The worker is idempotent (claim_messenger_jobs uses FOR UPDATE SKIP LOCKED),
so duplicate triggers from cron + enqueue are safe. Cron stays as the
liveness backstop.

### 4.5 Database: no N+1, bulk every read
Three round-trips total during preview, regardless of audience size:

```sql
-- 1. Audience + thread + last_inbound timestamp + page token
select l.id, l.name, l.custom_fields, l.user_id,
       t.id as thread_id, t.psid, t.last_inbound_at,
       p.id as page_id, p.page_access_token
  from leads l
  join pipeline_stages s on s.id = l.stage_id
                         and s.user_id = l.user_id
                         and lower(s.name) = lower($1)
  join messenger_threads t on t.lead_id = l.id
  join facebook_pages p on p.id = t.page_id
 where l.user_id = auth.uid()
 limit 200;

-- 2. Last 1-2 inbound messages per thread (for personalization)
select distinct on (m.thread_id) m.thread_id, m.text, m.created_at
  from messenger_messages m
 where m.thread_id = any($1::uuid[])
   and m.direction = 'inbound'
 order by m.thread_id, m.created_at desc;

-- 3. Opt-ins + OTN tokens, bulk
select thread_id, opted_out_at
  from messenger_marketing_optins
 where thread_id = any($1::uuid[]);

select thread_id, token, requested_at
  from messenger_otn_tokens
 where thread_id = any($1::uuid[])
   and consumed_at is null
   and (expires_at is null or expires_at > now());
```

Channel-policy resolution then runs **in-memory in JS** (no DB hit per lead).
Refactor `resolveSendPolicy` to a pure function plus a thin DB-backed helper.

### 4.6 Caching: cheap wins only
- **Last inbound text per thread**: cached in-memory for the duration of the
  preview request. Already covered by §4.5.
- **Pipeline stage list**: 100% read-mostly per user. Cache for 60 s in the
  server-action. Use `unstable_cache` with `cacheTag('stages:'+userId)` and
  invalidate on pipeline edits.
- **Intent parse**: don't cache; commands vary too much.
- **Drafts**: don't cache; personalization defeats the cache.

### 4.7 Provider strategy
Stick with HF Router + Llama-3.1-8B-Instruct for v1. Future upgrade path:
**Vercel AI Gateway** with model fallbacks — if HF Router rate-limits,
auto-fail-over to Groq direct or Anthropic Haiku. One env var swap, no
code rewrite. Note for backlog, not blocking.

---

## 5. Fatigue & safety controls

These are the controls that prevent this feature from becoming a footgun.

### 5.1 Per-recipient cooldown
Reject any campaign send to a thread that received an outbound campaign in
the last **48 h** (configurable). Prevents accidental double-blasts when
the user runs the same command twice.

```sql
-- Surfaced in preview as "skipped: recently contacted"
select thread_id from agent_campaign_messages
 where thread_id = any($1::uuid[])
   and status = 'sent'
   and sent_at > now() - interval '48 hours';
```

### 5.2 Per-user daily cap
Default 500 outbound campaign messages per user per 24 h. Configurable in
settings. Surfaced loudly in preview if cap would be exceeded ("you've
already sent 470 today; 30 of these will be deferred").

```sql
select count(*) from agent_campaign_messages m
  join agent_campaigns c on c.id = m.campaign_id
 where c.user_id = $1
   and m.status = 'sent'
   and m.sent_at > now() - interval '24 hours';
```

### 5.3 Per-page rate limit
Already covered in §4.3 — token bucket caps to ~7 msg/s/page.

### 5.4 Campaign size cap
Hard-cap audience at 200 leads/campaign in v1. Higher caps require explicit
multi-batch UX which we're punting.

### 5.5 Mandatory preview-before-send (v1)
The "send without preview" toggle is **deliberately not in v1**. Add it in
v2 once we've seen 10+ successful runs. Pre-send preview is the difference
between "useful tool" and "Messenger ban + brand hit."

### 5.6 Cancellation mid-run
User can cancel a sending campaign. Worker checks `agent_campaigns.status`
before each send (cheap — already inside a transaction):

```sql
select status from agent_campaigns where id = $1 for share;
-- if 'cancelled' → mark remaining messages skip_reason='cancelled'
```

### 5.7 Opt-out detection
If the next inbound from a recipient contains stop-language ("STOP", "unsubscribe",
"don't message me"), automatically:
- Insert `messenger_marketing_optins.opted_out_at = now()`
- Add to `agent_campaign_messages` cooldown index for forever
- Surface in dashboard

This piggybacks on the existing inbound classifier; add a stop-word check
in `src/lib/chatbot/classify.ts` or a new lightweight pre-filter.

### 5.8 Channel-policy honesty
Never silently downgrade a `MARKETING_MESSAGE` to `RESPONSE` (current stub
behavior in `outbound.ts:124`). Instead:
- If outside 24 h **and** no opt-in **and** no OTN → mark `skipped`,
  don't send.
- The preview already shows this row as grey/excluded.
- Forces the user to capture opt-ins to grow reach — the right incentive.

---

## 6. Data model

### 6.1 New tables

```sql
-- ===========================================================================
-- agent_campaigns: parent run record (one per "Send" click)
-- ===========================================================================
create table public.agent_campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  command_text text not null,             -- raw NL command
  intent jsonb not null,                  -- parsed intent (audience, instruction, tone)
  image_media_asset_id uuid references public.media_assets(id),
  image_url text,                         -- denormalized public URL at dispatch time

  status text not null default 'previewing'
    check (status in ('previewing','dispatching','sending','completed','cancelled','failed')),

  total int not null default 0,           -- = count of agent_campaign_messages
  sent int not null default 0,
  failed int not null default 0,
  skipped int not null default 0,

  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  completed_at timestamptz
);

create index agent_campaigns_user_idx on public.agent_campaigns (user_id, created_at desc);

alter table public.agent_campaigns enable row level security;
create policy "owner_rw" on public.agent_campaigns
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ===========================================================================
-- agent_campaign_messages: per-recipient row, drafts + dispatch state
-- ===========================================================================
create table public.agent_campaign_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.agent_campaigns(id) on delete cascade,

  lead_id uuid not null references public.leads(id) on delete cascade,
  thread_id uuid references public.messenger_threads(id) on delete set null,

  -- preview-time fields
  draft_text text not null,
  policy_at_preview text not null,        -- 'RESPONSE' | 'MARKETING_MESSAGE' | 'OTN' | 'paused:*'
  user_included boolean not null default true,
  user_edited boolean not null default false,

  -- dispatch-time fields
  status text not null default 'pending'
    check (status in ('pending','sent','failed','skipped','cancelled')),
  skip_reason text,                       -- 'window' | 'optin' | 'cooldown' | 'cancelled' | 'cap'
  policy_at_send text,                    -- final policy used
  facebook_message_id text,
  error text,
  attempts int not null default 0,
  sent_at timestamptz,

  created_at timestamptz not null default now()
);

create index agent_campaign_messages_campaign_idx
  on public.agent_campaign_messages (campaign_id, status);
create index agent_campaign_messages_thread_recent_idx
  on public.agent_campaign_messages (thread_id, sent_at desc)
  where status = 'sent';
create index agent_campaign_messages_user_recent_idx
  on public.agent_campaign_messages (campaign_id, sent_at desc)
  where status = 'sent';

alter table public.agent_campaign_messages enable row level security;
create policy "owner_rw_via_campaign" on public.agent_campaign_messages
  for all using (
    exists (select 1 from public.agent_campaigns c
             where c.id = campaign_id and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.agent_campaigns c
             where c.id = campaign_id and c.user_id = auth.uid())
  );

-- ===========================================================================
-- Per-page rate-limit token buckets
-- ===========================================================================
create table public.messenger_page_rate_buckets (
  page_id uuid primary key references public.facebook_pages(id) on delete cascade,
  tokens numeric not null default 10,
  capacity numeric not null default 10,
  refill_per_sec numeric not null default 7,
  last_refill_at timestamptz not null default now()
);
-- service_role only (worker writes); no RLS for end-users (admin surface only).
```

### 6.2 Changes to existing tables

```sql
-- messenger_jobs gains a kind + payload to carry campaign sends
alter table public.messenger_jobs
  add column if not exists kind text not null default 'inbound_reply'
    check (kind in ('inbound_reply','agent_campaign_send')),
  add column if not exists payload jsonb;

create index messenger_jobs_kind_queued_idx
  on public.messenger_jobs (kind, scheduled_at)
  where status = 'queued';
```

`claim_messenger_jobs` already serializes per `thread_id` regardless of `kind`,
which is exactly what we want: a new inbound and a campaign send for the same
thread will never run concurrently.

---

## 7. Pipeline detail

### 7.1 Intent parser (`src/lib/agent/parseIntent.ts`)

Single LLM call, JSON mode.

```ts
const system = `You convert sales follow-up commands into structured intent.
Output strictly this JSON:
{
  "audience": {
    "stage_name": string | null,        // best-match stage from the list
    "last_active_within_days": number | null
  },
  "instruction": string,                // what the user wants said
  "tone": "friendly" | "casual" | "professional",
  "ambiguities": string[]               // non-empty if you're unsure
}
Available stages: ${stages.join(', ')}`
```

If `ambiguities` is non-empty, surface them in the UI before running drafts.

### 7.2 Audience resolver (`src/lib/agent/resolveAudience.ts`)
The bulk SQL from §4.5 plus stage fuzzy-match (case-insensitive +
`pg_trgm`-similar, threshold 0.4).

### 7.3 Policy + context probe (`src/lib/agent/resolvePolicies.ts`)
Three bulk reads (§4.5), then a pure function per lead:

```ts
function classify(lead, optin, otn, cooldown) {
  if (cooldown) return { policy: 'paused', reason: 'cooldown' }
  if (insideWindow(lead.last_inbound_at)) return { policy: 'RESPONSE' }
  if (optin && !optin.opted_out_at) return { policy: 'MARKETING_MESSAGE' }
  if (otn) return { policy: 'OTN', token: otn.token }
  return { policy: 'paused', reason: 'window' }
}
```

### 7.4 Streaming draft generator (`src/app/api/agent/preview/route.ts`)

```ts
export async function POST(req: Request) {
  const { command, imageId } = await req.json()
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder()
      const send = (e: string, d: unknown) =>
        controller.enqueue(enc.encode(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`))

      const intent = await parseIntent(command, stages)
      send('intent', intent)

      const audience = await resolveAudience(intent, userId)
      send('audience', { count: audience.length })

      const ctx = await loadContext(audience)
      const limit = pLimit(8)
      await Promise.all(audience.map((lead) => limit(async () => {
        const draft = await generateDraft(lead, intent, ctx, image)
        const policy = classify(lead, ctx)
        send('draft', { lead_id: lead.id, draft, policy })
      })))

      send('done', {})
      controller.close()
    },
  })
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}
```

The campaign row is created at `intent` event-time so the user has a stable
`campaign_id` for editing/dispatch, even before drafts arrive.

### 7.5 Preview UI (`src/app/dashboard/agent/page.tsx` + components)
- Server Component for the page shell.
- Client Component for the command bar (`useState`, `EventSource` for SSE).
- Virtualized list (`@tanstack/react-virtual`) for >50 rows.
- Each row is its own client component to keep re-renders local on edit.

### 7.6 Dispatch (`src/app/api/agent/campaigns/[id]/dispatch/route.ts`)

```ts
// Server Action / API route, atomic-ish:
// 1. Mark campaign 'dispatching'
// 2. Bulk insert messenger_jobs (kind='agent_campaign_send'),
//    payload = { campaign_message_id }
// 3. Bulk insert agent_campaign_messages already happened during preview;
//    here we only flip status to 'pending' for included rows.
// 4. Mark campaign 'sending'
// 5. Fire-and-forget POST to /api/messenger/process
```

All in one Postgres transaction except step 5.

### 7.7 Send worker (`src/app/api/messenger/process/route.ts` — extend)

Branch on `job.kind`:

```ts
if (job.kind === 'inbound_reply') {
  await handleInboundReply(job)        // existing code path
} else if (job.kind === 'agent_campaign_send') {
  await handleCampaignSend(job)        // NEW
}
```

`handleCampaignSend`:
1. Acquire token from `messenger_page_rate_buckets`. If empty, reschedule
   job for `now() + 1/refill_rate` seconds and return.
2. Re-resolve policy (state may have changed since preview).
3. Check campaign isn't cancelled.
4. Check 48-h cooldown.
5. Call `sendOutbound(...)` — `kind: 'workflow_human_agent'` if outside 24 h
   with HUMAN_AGENT permitted, else `'bot'`.
6. Update `agent_campaign_messages` (status, fb_message_id, sent_at).
7. Bump `agent_campaigns.sent` / `failed` / `skipped` counter.

Idempotency: the existing `outbound_text_fb_id` column on `messenger_jobs`
already handles "FB sent but DB write failed" replays. We add
`agent_campaign_message_id` to the payload so retries resolve to the same
recipient row.

### 7.8 Run progress stream (`/api/agent/campaigns/[id]/stream`)
SSE endpoint that emits `progress` events as `agent_campaigns` counters
update. Implementation: poll the row every 500 ms server-side and emit
deltas; Postgres `LISTEN/NOTIFY` is overkill for v1.

---

## 8. Failure modes & recovery

| Failure | Detection | Recovery |
|---|---|---|
| LLM timeout for one draft | per-call 8 s timeout | retry 1×; fall back to a templated message ("Hi {name}, just checking in 👋") |
| LLM provider 429 | 429 response | exponential backoff, lower concurrency by half for the rest of the request |
| FB Graph 4xx (e.g. user blocked page) | response body | mark message `failed`, surface in UI; no retry |
| FB Graph 5xx / network | response/throw | retry with backoff up to 3× via existing `messenger_jobs.attempts` |
| Worker crashes mid-send | `started_at` stale | existing `claim_messenger_jobs` resets `running` jobs older than 300 s |
| Page rate-limit hit | 4xx/specific code | halve `messenger_page_rate_buckets.refill_per_sec`, alert |
| User cancels mid-run | `agent_campaigns.status='cancelled'` | worker checks before each send; remaining → `skipped` |
| Duplicate campaign trigger | same `campaign_id` re-dispatched | `agent_campaign_messages.status='pending'` is the dedup key — bulk insert is `on conflict do nothing` |
| Lead deleted between preview and send | FK `on delete cascade` | row gone — worker no-ops |

---

## 9. Observability

Minimal but real:

- Structured logs with `campaign_id`, `lead_id`, `phase`, `duration_ms`,
  `policy`, `outcome`. Already the project's logging style.
- A new `/dashboard/agent/campaigns/:id` page showing per-row status,
  errors, FB message IDs, and the original drafts.
- Aggregate stats card on `/dashboard/agent`: 7-day send count, success rate,
  median time-to-completion.
- Console warnings for: rate-bucket exhaustion, marketing-policy stub
  fallthroughs, opt-out captures.

No new metrics infra in v1. If we need real metrics later, plug into
Vercel Observability or a Supabase `metrics` table.

---

## 10. Build order (phased, with file paths)

Each phase ends with something testable.

### Phase 1 — Foundations (≈ 1 day)
- Migration `2026MMDD_agent_followup.sql`:
  - `agent_campaigns`, `agent_campaign_messages`
  - `messenger_page_rate_buckets`
  - `messenger_jobs.kind` + `payload`
- Backfill default `kind='inbound_reply'` for existing rows.
- Seed one bucket row per existing FB page.

### Phase 2 — Channel-policy hardening (≈ 0.5 day)
- Refactor `src/lib/messenger/outbound.ts`:
  - Extract `resolveSendPolicy` into `resolveSendPolicyBulk(threadIds[])`
    that does the three reads in parallel and returns a Map.
  - Remove the silent `MARKETING_MESSAGE → RESPONSE` fallthrough; return
    `paused:optin` instead.
- Add per-page token-bucket helpers: `acquirePageToken(pageId)`.

### Phase 3 — Server-side pipeline (≈ 1.5 days)
- `src/lib/agent/parseIntent.ts` — LLM call, JSON-mode.
- `src/lib/agent/resolveAudience.ts` — bulk audience SQL, stage fuzzy-match.
- `src/lib/agent/loadContext.ts` — bulk reads (last messages, optins, OTNs,
  cooldown, daily cap).
- `src/lib/agent/classifyPolicy.ts` — pure function from §7.3.
- `src/lib/agent/generateDraft.ts` — single-lead LLM call.
- `src/app/api/agent/preview/route.ts` — SSE endpoint orchestrating all.
- `src/app/api/agent/campaigns/[id]/dispatch/route.ts` — enqueue + trigger.
- `src/app/api/agent/campaigns/[id]/stream/route.ts` — progress SSE.

### Phase 4 — Worker integration (≈ 1 day)
- Extend `src/app/api/messenger/process/route.ts` to branch on `job.kind`.
- New `src/lib/messenger/campaignSend.ts` — `handleCampaignSend` worker fn.
- Token-bucket acquire/release inside the per-job transaction.
- Cooldown + cap checks at send time (not just preview).

### Phase 5 — UI (≈ 2 days)
- `src/app/dashboard/agent/page.tsx` — page shell.
- `src/app/dashboard/agent/_components/CommandBar.tsx` — input + image picker.
- `src/app/dashboard/agent/_components/PreviewGrid.tsx` — virtualized,
  EventSource-driven.
- `src/app/dashboard/agent/_components/DraftRow.tsx` — per-lead row, edit/regen.
- `src/app/dashboard/agent/campaigns/[id]/page.tsx` — run detail.
- `src/app/dashboard/agent/_components/ImagePicker.tsx` — pulls from
  `media_assets`, supports drag-drop upload.

### Phase 6 — Safety polish (≈ 0.5 day)
- Stop-word inbound detection in `src/lib/chatbot/classify.ts` to auto-set
  opt-out.
- Daily-cap warning UX in preview.
- "Cancel campaign" button + worker cancel-check.
- Empty-state guidance on `/dashboard/agent`.

### Phase 7 — Hardening (≈ 0.5 day)
- Load test: simulate 200-lead campaign end-to-end on a staging FB page
  (or a sandbox app); confirm latency targets in §2.
- Chaos test: kill the worker mid-send, verify reclaim within 5 minutes.
- Verify RLS: a second user cannot read/dispatch another user's campaign.

**Total: ~7 working days.** This is achievable because ~60 % of the heavy
lifting (queue, per-thread serialization, outbound coordinator, RAG, media
storage) is already shipped.

---

## 11. Open questions / decisions to confirm

1. **Marketing-Message API registration**. The Meta-side business
   verification needed for true `MARKETING_MESSAGE` sends is out of scope
   for v1 — we cleanly skip those rows. Confirm that's acceptable.
2. **Stop-word language**. Tagalog/Taglish stop phrases ("ayoko na",
   "tama na", etc.) — we should curate a list with the user since the
   chatbot is Filipino-focused.
3. **OTN consumption during preview**. We must NOT consume OTN tokens
   in preview — only at send time. Plan reflects this; just flagging.
4. **Image-only campaigns**. Should an empty draft + image-only message be
   allowed? FB allows it. Recommend: yes, fall back to a tiny templated
   caption so FB doesn't reject.
5. **Per-page or per-user fanout policy** when one user has multiple FB
   pages. Plan paces *per page*, which is correct, but worth confirming
   the user expects one campaign to cover leads across all their pages
   (yes, by default).
6. **Default `refill_per_sec`**. 7/sec/page is conservative. We can
   raise post-launch if FB never throttles.

---

## 12. What we explicitly are NOT building (to keep v1 scoped)

- Voice-to-text command input
- Scheduling ("send tomorrow at 9am")
- A/B variants
- Multi-stage / boolean audiences
- Per-recipient image overrides
- Auto-reply classification of campaign responses (defer to existing
  `answerWithClassification`)
- Visual workflow-builder integration (`/dashboard/workflows` is its own
  track per `WORKFLOW_IMPLEMENTATION_PLAN.md`)
- Email or SMS channels (Messenger only)

Each is a clean follow-up. None block v1.
