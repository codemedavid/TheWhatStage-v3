# Reminder Sequence + Time-Awareness Design

**Date:** 2026-05-18
**Status:** Draft — awaiting user review

## Problem

Two related defects in the AI reminder feature:

1. **Time/date blindness.** The main chatbot reply path does not include current date/time in its system prompt, so the bot confidently answers customers about "Wednesday" without knowing what Wednesday is. The reminder extraction path (`src/lib/reminders/extract.ts`) already injects Manila time, but the chatbot reply and agent draft paths do not — and operators see fabricated/inferred dates as a result.

2. **Conflicting follow-up logic.** When a customer asks to be contacted at a future time, two systems activate in parallel:
   - `src/app/api/messenger/process/route.ts:346` seeds `lead_followup_schedules` (the auto silent-followup: 5m / 1h / 5h / 8h / 12h / 18h / 24h after the last inbound).
   - `processReminderHooks` (`route.ts:1769`) inserts a `lead_reminders` row.

   The customer gets nudged by both systems for the same silence — duplicate, conflicting outreach.

This spec covers a dedicated multi-touchpoint reminder sequence that takes over when the customer requests one, plus the time-awareness fix.

## Goals

1. When a customer asks to be followed up at a future time, suppress the default auto silent-followup for that lead and run a **dedicated 7-touchpoint sequence** anchored at the requested time.
2. **Pre-generate** the entire schedule (timestamps + message bodies) at the moment of request so the operator can preview and the system can survive LLM outages.
3. Make **current date/time** reliably available to every customer-facing LLM call.

## Non-Goals

- Re-architecting the existing auto silent-followup (`src/lib/followups/*`). Only its gating changes.
- Multi-lingual NLP improvements beyond what the existing extraction model handles.
- Operator UI for editing pre-generated messages mid-sequence (deferred — the existing per-row reminder edit already works for emergencies).
- Model selection / upgrades. DeepSeek-V4-Flash is in use and handles the relative-date math acceptably once "current time" is injected.

## Decisions (locked during brainstorming)

| # | Question | Decision |
|---|----------|----------|
| 1 | Cadence anchor + unit | Post-anchor, in **days**. T1 = requested time. T2–T7 follow. |
| 2 | Mid-sequence reply behavior | **Soft resolution** via existing `resolveTopics`. Topic-addressing reply cancels; small talk does not. |
| 3 | Touchpoint spacing | **Cumulative from anchor**: T1, anchor+1d, +2d, +3d, +5d, +8d, +13d. Final touchpoint = 13 days after anchor. |
| 4 | Pre-generation strategy | **Pre-generate all 7 + late refresh**. Upfront generation seeds `pre_generated_text` as fallback; fire-time attempts a fresh per-touchpoint LLM call. |
| 5 | Operator approval | **Auto-send by default.** Sequence touchpoints fire automatically. Operator can cancel from the dashboard. |
| 6 | Time-awareness scope | Inject "Current time: …" into every customer-facing LLM call. No model upgrade. |
| 7 | Reschedule / multiple requests | **One active sequence per lead. Replace on new request** (enforced by a partial unique index). |

## Architecture

### Control flow on every inbound

In `src/app/api/messenger/process/route.ts` (per-job worker path):

1. Worker picks up the inbound, refreshes thread/lead — unchanged.
2. **NEW (synchronous, pre-reply):** call `extractReminder(inboundText)`. Runs on text-bearing inbounds with length ≥ 4, same gate as today. **Cheap pre-filter:** before the LLM call, run a regex check (`hasTimeMarker`) for common time/date words (`tomorrow|tonight|later|tonite|mamaya|bukas|next|on|at|am|pm|monday|...|sunday|lunes|...|linggo|january|...|december|enero|...|disyembre|\d{1,2}\s*(am|pm|:)`). If no match, skip the LLM call entirely. This keeps the median inbound on the existing latency budget; only inbounds that plausibly contain a future-time request pay the ~1–2 s extraction cost.
3. **Gate the default auto silent-followup:**
   - If `extractReminder` returned a hit → cancel any active `lead_followup_schedules` row for the thread; skip `maybeScheduleFollowup`.
   - Also skip `maybeScheduleFollowup` if an `active` `lead_reminder_sequences` row already exists for the lead (handles future inbounds during an in-flight sequence).
   - Otherwise → existing seed runs as today.
4. Build context + bot reply — **unchanged**, except the system prompt now includes the shared "Current time" block (see §Time awareness).
5. **After the bot reply,** in the existing fire-and-forget `processReminderHooks` block:
   - `resolveTopics` runs against any active sequence's topic (one shared topic per sequence) → if resolved, mark sequence `resolved`.
   - If a fresh reminder was extracted in step 2:
     - If an active sequence already exists, mark it `cancelled` with `resolved_reason='rescheduled'` (Q7).
     - Call `seedReminderSequence({ lead, thread, anchor_at, topic, source_message_id })`: insert sequence row + 7 touchpoint rows in `lead_reminders` (offsets `[0, 1, 2, 3, 5, 8, 13]` days), pre-generate all 7 message bodies in parallel via the chatbot LLM, write them to `pre_generated_text`. Always populate `fallback_text` from the curated per-position pool.
6. **Cron `/api/cron/reminders-tick`** — unchanged. Picks up `lead_reminders` rows with `auto_send=true`, `status='pending'`, `scheduled_at <= now`, enqueues `reminder_fire` jobs. New sequence touchpoints set `auto_send=true` on insert.
7. **Worker `reminder_fire` handler** (`src/lib/reminders/fire.ts`) — modified:
   - Load the touchpoint row. If it has a `sequence_id`, also load the parent sequence.
   - If parent sequence's `status != 'active'`, mark touchpoint `cancelled` and skip send.
   - Generate fresh message text via the LLM (Manila-time-aware, 8s timeout, history-aware). On timeout/failure, use `pre_generated_text`; if that's NULL, use `fallback_text`.
   - Send via `sendOutbound` (existing 24h window handling preserved).
   - Mark touchpoint `sent`. If this was position 6, mark parent sequence `exhausted`.

### Single source of truth

The sequence row's `status` is the only gate any individual touchpoint consults at fire time. Cancellation, resolution, and reschedule never need to UPDATE 7 rows; they UPDATE 1.

## Data model

### New table — `lead_reminder_sequences`

```sql
create table public.lead_reminder_sequences (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id)               on delete cascade,
  lead_id       uuid not null references public.leads(id)             on delete cascade,
  thread_id     uuid not null references public.messenger_threads(id) on delete cascade,

  anchor_at     timestamptz not null,
  topic         text not null check (char_length(topic) between 1 and 500),
  source_message_id uuid references public.messenger_messages(id) on delete set null,

  status text not null default 'active'
    check (status in ('active','resolved','cancelled','exhausted')),
  resolved_at     timestamptz,
  resolved_reason text check (resolved_reason in ('topic_addressed','manual','rescheduled')),
  cancelled_at    timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index uniq_active_reminder_sequence_per_lead
  on public.lead_reminder_sequences (lead_id)
  where status = 'active';

create index idx_reminder_sequences_user_status
  on public.lead_reminder_sequences (user_id, status, anchor_at desc);

alter table public.lead_reminder_sequences enable row level security;

create policy "lead_reminder_sequences_owner_rw" on public.lead_reminder_sequences
  for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.touch_lead_reminder_sequences_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger lead_reminder_sequences_touch_updated_at
  before update on public.lead_reminder_sequences
  for each row execute function public.touch_lead_reminder_sequences_updated_at();
```

### Extend `lead_reminders`

```sql
alter table public.lead_reminders
  add column sequence_id        uuid references public.lead_reminder_sequences(id) on delete cascade,
  add column sequence_position  smallint check (sequence_position between 0 and 6),
  add column pre_generated_text text check (char_length(pre_generated_text) <= 2000),
  add column fallback_text      text check (char_length(fallback_text) <= 2000);

create unique index uniq_reminder_sequence_position
  on public.lead_reminders (sequence_id, sequence_position)
  where sequence_id is not null;
```

Existing `lead_reminders` rows are unaffected (`sequence_id IS NULL`) — one-off operator reminders keep working as today.

### Migration ordering

Single new file: `supabase/migrations/20260602000000_lead_reminder_sequences.sql` with the create + alter + policy + trigger. No data backfill. (Last existing migration: `20260601000000_lead_followup_schedules.sql`.)

## Schedule structure

Cumulative offsets from `anchor_at` (in days):

| Position | Offset       | Role                                       |
| -------- | ------------ | ------------------------------------------ |
| 0 (T1)   | +0 days      | The promised delivery                      |
| 1 (T2)   | +1 day       | First light nudge                          |
| 2 (T3)   | +2 days      | Offer to clarify                           |
| 3 (T4)   | +3 days      | Brief check-in                             |
| 4 (T5)   | +5 days      | Re-engage with a fresh angle               |
| 5 (T6)   | +8 days      | Last substantive ping                      |
| 6 (T7)   | +13 days     | Gracious final close — door-open exit      |

Constant in `src/lib/reminders/sequence.ts`:

```ts
export const SEQUENCE_OFFSETS_DAYS = [0, 1, 2, 3, 5, 8, 13] as const
export const SEQUENCE_LENGTH = SEQUENCE_OFFSETS_DAYS.length
```

## Message authoring

### Pre-generation prompt (and fire-time refresh prompt)

```
{chatbot persona block: tone / language / do-rules / dont-rules}

Current time: {now Manila long-form}, (Asia/Manila, UTC+08:00).
The customer asked to be followed up at {anchor local long-form} about: "{topic}".
You are writing message #{N+1} of 7 in that scheduled follow-up sequence.
This message will be sent at {scheduled local long-form} (Asia/Manila).

Position role for message #{N+1}: {role text from the schedule table}.

Hard rules: one line only, max 200 characters, no dashes ("-","—","–"),
no markdown, no emoji unless personality calls for them. Match the
personality language (Tagalog, Taglish, or English). Sound human, never
robotic. Reference the topic naturally. Never start with "Hello! I am..."
or generic AI phrasing.
```

At fire time, the prompt is identical except it also appends the last 20 messages of conversation history so the message can react to anything said since the request.

### Sample messages

For *topic = "pricing for the 3BR unit"*, *anchor = Wed Aug 12 2:00 PM*, lead = Maria, persona = Taglish real-estate sales:

| Pos | Scheduled (Manila)  | Message                                                                                                  |
| --- | ------------------- | -------------------------------------------------------------------------------------------------------- |
| 0   | Wed Aug 12, 2:00 PM | Hi Maria, balik lang po gaya ng usap, ready na ako para i discuss ang pricing ng 3BR. Pwede pa po ba ngayon? |
| 1   | Thu Aug 13, 2:00 PM | Hi Maria, follow up lang po sa pricing ng 3BR. May oras po ba kayo today para mag chat?                  |
| 2   | Fri Aug 14, 2:00 PM | Hi Maria, sabihan niyo lang po kung gusto niyong i breakdown ang pricing or hanapan ng ibang option.     |
| 3   | Sat Aug 15, 2:00 PM | Hi Maria, nandito lang po ako kung gusto niyong balikan yung pricing ng 3BR.                             |
| 4   | Mon Aug 17, 2:00 PM | Hi Maria, may flexible payment terms po pala tayo. Gusto niyo po bang malaman?                           |
| 5   | Thu Aug 20, 2:00 PM | Hi Maria, last in-depth check po. May specific budget po ba kayo para i match ko ng listing?             |
| 6   | Tue Aug 25, 2:00 PM | Hi Maria, kahit anong oras po kayong handa na, dito lang ako. Salamat po sa oras niyo!                   |

### Fallback pool

`src/lib/reminders/sequence-fallbacks.ts` — keyed by position (0–6), one curated string per position in the existing Taglish voice. Mirrors the pattern in `src/lib/followups/generateMessage.ts` (`FALLBACK_POOL`). Used when `pre_generated_text` is NULL at insert time and as the last resort at fire time.

## Time awareness

New shared helper: `src/lib/time/manilaNow.ts`.

```ts
export const MANILA_TZ = 'Asia/Manila'

export interface ManilaNow {
  iso: string         // "2026-05-18 14:32"
  weekday: string     // "Monday"
  dateLong: string    // "Monday, May 18, 2026"
  utcIso: string      // "2026-05-18T06:32:00.000Z"
}

export function manilaNow(d?: Date): ManilaNow
export function manilaNowBlock(d?: Date): string
// returns: "Current time: Monday, May 18, 2026, 14:32 (Asia/Manila, UTC+08:00)."
```

Manila is fixed UTC+08:00 (no DST), so formatting is deterministic. The helper replaces the inline `nowInManila()` in `src/lib/reminders/extract.ts`.

### Call sites that gain the block

| File | Change |
|------|--------|
| `src/lib/rag/prompt-builder.ts` → `assembleSystemPrompt` | Prepend `manilaNowBlock()` to the system message. **Highest-impact fix** — covers every chatbot reply customers see. |
| `src/lib/reminders/extract.ts` | Replace inline `nowInManila()` with shared `manilaNow()`. Behavior-equivalent. |
| `src/lib/reminders/fire.ts` → `generateFollowUpText` | Add `manilaNowBlock()` to the single-shot reminder prompt. |
| `src/lib/agent/generateDraft.ts` | Add `manilaNowBlock()` to the bulk-campaign draft prompt. |
| `src/lib/followups/generateMessage.ts` → `buildSystemPrompt` | Add `manilaNowBlock()` so the existing auto silent-followup also has it. |
| New `src/lib/reminders/sequence-generate.ts` (pre-gen + late refresh) | Built in from the start. |

Cost: ~50 system-prompt tokens per LLM call, no extra round-trips.

Tests: `manilaNow.test.ts` pins behavior at fixed `Date` inputs, covering midnight, year-boundary, and the UTC+08 offset.

## Module layout

```
src/lib/time/
  manilaNow.ts
  manilaNow.test.ts

src/lib/reminders/
  extract.ts                  (existing; switch to shared manilaNow, add hasTimeMarker pre-filter)
  hasTimeMarker.ts            (NEW: regex pre-filter so extractReminder skips obvious non-requests)
  hasTimeMarker.test.ts
  resolve.ts                  (existing; unchanged)
  fire.ts                     (existing; add sequence parent check, time block)
  sequence.ts                 (NEW: SEQUENCE_OFFSETS_DAYS, role descriptions)
  sequence-fallbacks.ts       (NEW: per-position curated lines, sanitized)
  sequence-seed.ts            (NEW: seedReminderSequence — inserts sequence + 7 rows, parallel pre-gen)
  sequence-generate.ts        (NEW: prompt builder + LLM call for a position)
  sequence-resolve.ts         (NEW: thin wrapper around resolveTopics that updates the sequence row)
  sequence-seed.test.ts
  sequence-generate.test.ts

src/app/api/cron/reminders-tick/route.ts   (existing; unchanged)
src/app/api/reminders/[id]/route.ts         (existing; unchanged — touchpoint-level ops still work)
src/app/api/reminders/sequences/[id]/route.ts   (NEW: PATCH cancel, GET detail)

src/app/api/messenger/process/route.ts      (modified: synchronous extractReminder before seed, gate auto-followup)

src/app/(app)/dashboard/reminders/         (extended: group rows by sequence_id when present)
```

The new files are all small, focused units with explicit inputs/outputs. `sequence-seed.ts` is the only one that does I/O; everything else is pure.

## Edge cases

| # | Case | Behavior |
|---|------|---------|
| 1 | Customer replies "ok send pricing now" mid-sequence | `resolveTopics` returns the sequence's topic id (one shared topic per sequence). Sequence row → `status='resolved', resolved_reason='topic_addressed'`. Remaining touchpoints skip at fire time via the parent status check. |
| 2 | Customer replies with small talk | `resolveTopics` returns nothing. Sequence stays `active`. Touchpoints continue. Default auto silent-followup stays gated off. |
| 3 | Customer requests reschedule | `extractReminder` returns a new anchor. Seeder marks the existing active sequence `cancelled, resolved_reason='rescheduled'` and creates a new sequence + 7 new touchpoints. Partial unique index prevents two active sequences. |
| 4 | Anchor in the past at extract time | Already rejected in `extractReminder`. No-op — falls through to default behavior, no sequence created. |
| 5 | Anchor passes without engagement | Normal — T2–T7 keep firing on schedule. Sequence completes at T7 with `status='exhausted'`. |
| 6 | Customer replies a week after T7 | Sequence is already `exhausted`. Default auto silent-followup resumes via the existing seed path on that new inbound. |
| 7 | Pre-generation LLM times out for some positions | Parallel `Promise.allSettled`. Rejections leave `pre_generated_text` NULL; `fallback_text` is always populated. Sequence still seeds. |
| 8 | Pre-generation fully fails | Sequence row created with all 7 touchpoints having `pre_generated_text=NULL` and `fallback_text` populated. Fire-time can still attempt fresh generation. |
| 9 | 24-hour FB messaging window | Existing `isInsideWindow(thread.last_inbound_at)` in `reminders/fire.ts` already toggles `sendOutbound` kind between `bot` and `workflow_human_agent`. No change. |
| 10 | Concurrent inbound double-detect | `extractReminder` runs in the per-message worker path. Across concurrent worker calls, the partial unique index serializes; second insert errors with 23505 and seeder swallows it. |
| 11 | Operator cancels sequence | New `PATCH /api/reminders/sequences/[id]` sets `status='cancelled', resolved_reason='manual'`. Touchpoints skip at fire time. |
| 12 | Operator-edited message body (deferred) | Existing per-row reminder edit UI works on individual touchpoints. Late-refresh order at fire time will be tightened in a follow-up PR. **Not in v1 scope.** |
| 13 | Lead crosses `MAX_LIFETIME_LEAD_INBOUND=15` mid-sequence | Reminder sequence is *not* gated on inbound count. A customer who explicitly asked for follow-up gets it regardless of chattiness. |

## Testing

- `src/lib/time/manilaNow.test.ts` — date formatting at fixed inputs.
- `src/lib/reminders/hasTimeMarker.test.ts` — true-positive coverage on the common phrasings (English + Tagalog + Taglish), false-positive guard on chatty messages without time intent.
- `src/lib/reminders/sequence-seed.test.ts` — schedule offset math, partial unique index conflict, pre-gen with mixed success/failure.
- `src/lib/reminders/sequence-generate.test.ts` — prompt content includes time block, topic, position role.
- Manual end-to-end:
  1. Send "follow up Wednesday 2pm about pricing" as a customer.
  2. Verify `lead_reminder_sequences` row created, 7 `lead_reminders` rows with monotonic `scheduled_at`, all `auto_send=true`.
  3. Verify `lead_followup_schedules` row for the thread is `cancelled` and no new one is seeded.
  4. Advance clock past T1, T2; verify both fire, distinct copy, message rows recorded.
  5. Reply "ok send pricing now"; verify sequence becomes `resolved`, remaining touchpoints skip.
  6. New scenario: reply "actually Friday instead"; verify first sequence becomes `cancelled/rescheduled`, second is created.

## Rollout

1. Migration applied to Supabase (`supabase migration up`).
2. Code merged with the time-awareness changes guarded behind `manilaNowBlock` — these are safe to ship independently and improve every customer reply immediately.
3. Sequence logic is gated by the new `extractReminder` returning a hit, so existing flows (default auto silent-followup, one-off reminders) are unaffected until a customer asks.
4. Dashboard sequence grouping is a UI-only follow-up.

## Open questions for implementation

None — all decisions from brainstorming are locked above.
