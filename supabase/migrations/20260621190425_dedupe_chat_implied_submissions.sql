-- =========================================================================
-- Backfill: collapse duplicate chat-implied ("virtual") submissions.
--
-- Chat-implied submissions used to be deduped per inbound MESSAGE
-- (meta.idempotency_key = 'chat-intent:<thread>:<msg_id>'), so a lead who sent
-- more than one consent-style phrase in the same conversation produced one
-- 'implied_proceed' row per phrase — the doubling seen in the submissions list.
-- The application now dedupes per THREAD ('chat-intent:<thread>'); this migration
-- repairs the rows already written under the old scheme.
--
-- Two steps:
--   1. Keep the EARLIEST implied_proceed virtual row per thread; delete the rest.
--   2. Normalize survivors' idempotency_key to the thread-scoped form so the
--      partial unique index on (meta->>'idempotency_key') holds going forward.
--
-- Order matters: delete BEFORE normalizing, otherwise two same-thread rows would
-- momentarily share the thread-scoped key and trip the unique index.
--
-- Re-runnable: after the first pass there is one row per thread, so the DELETE
-- matches nothing and the UPDATE is a no-op (sets the same value). Only rows
-- carrying data->>'thread_id' are touched — every virtual submission writes it
-- (see virtual-submission.ts), and real form fills are never affected.
-- =========================================================================

-- Step 1 — drop all but the earliest virtual submission per thread.
with ranked as (
  select
    id,
    row_number() over (
      partition by (data->>'thread_id')
      order by created_at asc, id asc
    ) as rn
  from public.action_page_submissions
  where outcome = 'implied_proceed'
    and meta->>'virtual' = 'true'
    and data->>'thread_id' is not null
)
delete from public.action_page_submissions s
using ranked r
where s.id = r.id
  and r.rn > 1;

-- Step 2 — normalize the survivors' idempotency key to the thread-scoped form.
update public.action_page_submissions
set meta = jsonb_set(
  coalesce(meta, '{}'::jsonb),
  '{idempotency_key}',
  to_jsonb('chat-intent:' || (data->>'thread_id'))
)
where outcome = 'implied_proceed'
  and meta->>'virtual' = 'true'
  and data->>'thread_id' is not null
  and meta->>'idempotency_key' is distinct from ('chat-intent:' || (data->>'thread_id'));
