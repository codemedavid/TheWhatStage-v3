# Lead Silent Auto Follow-Up — Design

**Status:** approved (brainstorm), pending implementation plan
**Date:** 2026-05-17
**Owner:** John Angelo David

## Summary

Automatically nudge a Messenger lead who has stopped replying with a fixed 7-step time-decaying schedule (5m, 1h, 5h, 8h, 12h, 18h, 24h after the lead's last inbound). Activates only when the lead has sent fewer than 15 lifetime inbound messages **and** the bot has not yet completed a "page action" (booking confirmed, form submitted, order created). Any new inbound message from the lead cancels the current schedule and (if gates still pass) seeds a fresh one.

Follow-ups are LLM-generated one-liners that respect the chatbot's configured personality. The 5-minute touchpoint is a light check-in ("Hi {name}, interested pa po kayo?" style). If the lead has held a "real conversation" (≥4 inbound messages), later touchpoints reference what was discussed. Messages must contain **no dash characters** and must be one line.

## Activation rules

- **Always on.** No per-page or per-action-page toggle.
- **Gate G1 — lifetime lead inbound count < 15.** Counted on `messenger_messages WHERE direction='inbound'` for the thread (i.e. lead-sent messages only). Re-evaluated at seed time and again before each fire.
- **Gate G2 — no completed page action.** No row in `action_page_submissions` for the lead with a terminal outcome (booking confirmed, form submitted, order created). Centralized in `src/lib/followups/gates.ts`.

## Schedule

```
OFFSETS_MS = [5m, 1h, 5h, 8h, 12h, 18h, 24h]
```

Offset 0 (5 min) is **always** a light check-in regardless of `conversation_kind` (per spec: "The first follow-up should be a light check-in"). Offsets 1–6 vary based on `conversation_kind`:

- `conversation_kind = 'generic'` (lead inbound count < 4 at seed time): all 7 messages are light, varied check-ins.
- `conversation_kind = 'real'` (lead inbound count ≥ 4 at seed time): offset 0 is still a light check-in; offsets 1–6 are LLM-personalized using the last 20 messages of the thread.

`conversation_kind` is decided once at seed time and does not flip mid-schedule.

## Cancellation

- **Lead inbound message:** cancels the entire remaining schedule. Same handler then seeds a fresh schedule from the new `last_inbound_at` if gates still pass.
- **Human owner outbound:** does NOT cancel.
- **Bot outbound (including our own follow-ups):** does NOT cancel.

## Data model

New table `lead_followup_schedules`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid | RLS subject |
| `lead_id` | uuid | FK leads |
| `thread_id` | uuid | FK messenger_threads |
| `page_id` | uuid | FK facebook_pages (denorm for worker) |
| `started_at` | timestamptz | = lead's `last_inbound_at` when seeded |
| `next_offset_idx` | smallint | 0..6 |
| `next_run_at` | timestamptz | when worker should fire |
| `status` | text enum | `pending` \| `running` \| `done` \| `cancelled` \| `failed` |
| `conversation_kind` | text enum | `generic` \| `real` |
| `lead_inbound_count_at_seed` | smallint | debug snapshot |
| `last_error` | text \| null | |
| `created_at`, `updated_at` | timestamptz | |

Indexes:

```sql
CREATE UNIQUE INDEX uniq_active_followup_per_thread
  ON lead_followup_schedules(thread_id)
  WHERE status IN ('pending','running');

CREATE INDEX idx_followup_due
  ON lead_followup_schedules(next_run_at)
  WHERE status = 'pending';
```

RLS: select/update scoped to `user_id = auth.uid()`. Worker uses service role.

## Seed & cancel logic

Entry point: `maybeScheduleFollowup(admin, { threadId, leadId, userId, pageId, lastInboundAt })`, called from `src/app/api/messenger/process/route.ts` after the inbound message row is committed.

Transactional flow:

1. `UPDATE lead_followup_schedules SET status='cancelled' WHERE thread_id=$1 AND status IN ('pending','running')`.
2. Evaluate G1 and G2.
3. If both pass:
   - `inboundCount = count(messenger_messages WHERE thread_id=$1 AND direction='inbound')`
   - Insert row with `started_at = lastInboundAt`, `next_offset_idx = 0`, `next_run_at = lastInboundAt + 5min`, `conversation_kind = inboundCount >= 4 ? 'real' : 'generic'`.

The unique partial index `uniq_active_followup_per_thread` guarantees no double-seed under concurrent webhook deliveries; the insert uses `ON CONFLICT DO NOTHING` as belt-and-suspenders.

## Worker & message generation

Endpoint: `src/app/api/followups/process/route.ts` — POST, gated by `x-worker-secret`, invoked once per minute by a pg_cron job (mirrors `messenger_jobs`).

Claim:

```sql
UPDATE lead_followup_schedules
SET status='running', updated_at=now()
WHERE id IN (
  SELECT id FROM lead_followup_schedules
  WHERE status='pending' AND next_run_at <= now()
  ORDER BY next_run_at LIMIT 50
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

For each claimed row:

1. Re-evaluate G1 + G2. If failed → `status='done'`, exit.
2. Bulk-load: thread, lead name, page token, `chatbot_configs.personality`, last 20 messages.
3. Generate message via `generateMessage({ kind: row.conversation_kind, offsetIdx, personality, leadName, recentMessages })`.
4. Sanitize: strip every dash variant (`-`, `‐`, `‑`, `‒`, `–`, `—`, `―`), collapse whitespace, force one line, cap at 200 chars.
5. Send via `sendOutbound`. Inside 24h window → default policy. Outside → `messaging_type: 'MESSAGE_TAG'`, `tag: 'HUMAN_AGENT'` (the 24h touchpoint may land at the edge).
6. Advance: if `next_offset_idx < 6` → set `pending` + `next_run_at = started_at + OFFSETS_MS[idx]`. Else → `done`.
7. Send error → `failed` + `last_error`. No retries; the lead's next inbound will reseed if applicable.

## Message generation

`src/lib/followups/generateMessage.ts` — one LLM call via `HfRouterLlm` with `ragConfig.classifierModel` (same as `reminders/fire.ts`).

System prompt branches on `conversation_kind`:

- **generic:** "Write a single short, warm Messenger check-in. This is follow-up N of 7 to a lead who has gone quiet. Don't repeat earlier phrasings. Match personality. One line. No dashes. No markdown. ≤200 chars."
- **real:** Same + include last 20 messages, instruct LLM to reference what was discussed and propose a concrete next step.

Hard rules echoed in every prompt: **one line, no dashes, no markdown, ≤200 chars, match personality language**.

Fallback (LLM timeout 8s or empty response): static pool keyed by `(conversation_kind, offset_idx)` with `{name}` interpolation. Generic 5-min fallback = exactly your example: `"Hi {name}, interested pa po kayo?"`.

## Files

**New**

- `supabase/migrations/20260601000000_lead_followup_schedules.sql`
- `src/lib/followups/config.ts`
- `src/lib/followups/gates.ts`
- `src/lib/followups/seed.ts`
- `src/lib/followups/cancel.ts`
- `src/lib/followups/sanitize.ts`
- `src/lib/followups/generateMessage.ts`
- `src/lib/followups/fire.ts`
- `src/app/api/followups/process/route.ts`

**Modified**

- `src/app/api/messenger/process/route.ts` — call `maybeScheduleFollowup` after committing inbound message.
- `.env.example` — add `FOLLOWUPS_WORKER_SECRET`.

## Tests

- `sanitize.test.ts` — strips every dash glyph, collapses whitespace, length cap.
- `gates.test.ts` — boundary cases for G1 (14 pass, 15 fail) and G2 (booking confirmed fails, form submitted fails, order created fails, none pass).
- `generateMessage.test.ts` — mocked LLM: content returned, sanitizer applied, fallback pool used on timeout, personality plumbed through.
- `seed.test.ts` — integration: seeds row, cancels existing pending, unique-index prevents double-seed under concurrent insert.
- `fire.test.ts` — claims due row, advances offset, marks done after offset 6, marks done if gates fail mid-schedule, marks failed on send error.

## Operational notes

- pg_cron every minute calls `/api/followups/process` with `x-worker-secret`.
- Logging: `followup.seeded`, `followup.fired`, `followup.skipped` with `{ scheduleId, offsetIdx, reason }` via existing logger.
- New table only — no data migration needed.

## Out of scope

- Per-page or per-action-page opt-out toggle (always on per spec).
- Stop-word / opt-out keyword detection (tracked separately on the agent-followup roadmap).
- Reporting / analytics dashboard for follow-up schedules.
- UI changes.
