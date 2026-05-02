-- =========================================================================
-- Messenger worker: atomic per-thread job claim + outbound idempotency
-- =========================================================================
-- Phase 1 of the chatbot scaling plan. Two changes that together make it
-- safe to run many `/api/messenger/process` invocations concurrently:
--
--   1. claim_messenger_jobs() — a SECURITY DEFINER function that atomically
--      claims at most one queued job per thread. Returned rows are
--      guaranteed to have distinct thread_ids, so two workers can never
--      reply to the same Messenger conversation in parallel and produce
--      out-of-order messages. Uses `FOR UPDATE SKIP LOCKED` for row-level
--      atomicity, and a `NOT EXISTS (older queued sibling)` filter to
--      collapse multiple queued jobs per thread to the oldest one.
--
--   2. outbound_text_fb_id / outbound_button_fb_id on messenger_jobs —
--      idempotency keys for the two FB Graph send calls. Worker writes
--      them immediately on FB success; on retry, presence of the column
--      means "FB already sent, skip the call" — preventing duplicate
--      messages when the DB write that follows the FB call fails.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Per-thread "oldest queued" lookup index. Critical for the claim
--    function's `NOT EXISTS (older queued sibling)` filter.
-- -------------------------------------------------------------------------
create index if not exists messenger_jobs_thread_queued_idx
  on public.messenger_jobs (thread_id, scheduled_at, id)
  where status = 'queued';

-- -------------------------------------------------------------------------
-- 2. Outbound idempotency columns on messenger_jobs.
--    Set as soon as the corresponding FB Graph call returns successfully,
--    BEFORE the messenger_messages insert. On retry, a non-null value
--    signals "FB already sent — do not call again."
-- -------------------------------------------------------------------------
alter table public.messenger_jobs
  add column if not exists outbound_text_fb_id   text,
  add column if not exists outbound_button_fb_id text;

-- -------------------------------------------------------------------------
-- 3. Atomic per-thread claim function.
--
--    Returns up to p_limit jobs, with these invariants:
--      - No two returned rows share a thread_id.
--      - No returned row's thread_id has another job already in 'running'.
--      - Stuck running jobs (started_at older than p_stale_seconds) are
--        reset to 'queued' first, so a crashed worker's jobs become
--        reclaimable without a separate cron.
--
--    Concurrency model:
--      a) `not exists (status='running')` — durable, post-commit signal
--         that another worker holds this thread. Prevents future claims.
--      b) `not exists (older queued sibling)` — collapses N queued jobs
--         for one thread down to the oldest one. Two concurrent workers
--         that both see N queued jobs for thread T will both want the
--         same row (the oldest), and (c) settles the race between them.
--      c) `for update skip locked` — row-level. The losing worker skips
--         the locked row and, because (b) excludes the siblings, gets
--         nothing for thread T this round. After the winner commits,
--         (a) becomes durable.
--      d) The UPDATE's `where status='queued'` is a belt-and-braces
--         guard for any path that bypassed the lock.
--
--    Granted to service_role only — webhook + worker run with the
--    service-role key. Never callable from the dashboard surface.
-- -------------------------------------------------------------------------
create or replace function public.claim_messenger_jobs(
  p_limit          int default 5,
  p_stale_seconds  int default 300
)
returns table (
  id                    uuid,
  thread_id             uuid,
  inbound_msg_id        uuid,
  user_id               uuid,
  attempts              integer,
  outbound_text_fb_id   text,
  outbound_button_fb_id text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Reset stuck running jobs (worker invocation crashed before finishing).
  update public.messenger_jobs
     set status = 'queued',
         started_at = null
   where status = 'running'
     and started_at is not null
     and started_at <= now() - make_interval(secs => p_stale_seconds);

  return query
  with picked as (
    select j.id,
           j.thread_id,
           j.inbound_msg_id,
           j.user_id,
           j.attempts,
           j.outbound_text_fb_id,
           j.outbound_button_fb_id
      from public.messenger_jobs j
     where j.status = 'queued'
       and j.scheduled_at <= now()
       -- (a) Skip threads that already have a running job — that worker
       -- holds the conversation. Becomes true post-commit of the winning
       -- claim, preventing future double-claims.
       and not exists (
         select 1
           from public.messenger_jobs r
          where r.thread_id = j.thread_id
            and r.status = 'running'
       )
       -- (b) Within a thread, only consider the oldest queued job. Tie-
       -- break on id so the choice is deterministic across concurrent
       -- snapshots.
       and not exists (
         select 1
           from public.messenger_jobs e
          where e.thread_id = j.thread_id
            and e.status = 'queued'
            and (
              e.scheduled_at < j.scheduled_at
              or (e.scheduled_at = j.scheduled_at and e.id < j.id)
            )
       )
     order by j.scheduled_at, j.id
     limit greatest(p_limit, 1)
     -- (c) Row-level atomicity. Concurrent workers skip locked rows; the
     -- (b) filter ensures they cannot fall back to a sibling for the same
     -- thread.
     for update skip locked
  )
  -- (d) Belt-and-braces: only flip rows that are still queued.
  update public.messenger_jobs j
     set status = 'running',
         started_at = now()
    from picked p
   where j.id = p.id
     and j.status = 'queued'
  returning j.id,
            j.thread_id,
            j.inbound_msg_id,
            j.user_id,
            j.attempts,
            j.outbound_text_fb_id,
            j.outbound_button_fb_id;
end;
$$;

revoke all on function public.claim_messenger_jobs(int, int) from public;
grant execute on function public.claim_messenger_jobs(int, int) to service_role;
