-- =========================================================================
-- Messenger worker scaling: claim-RPC indexes + restore outbound_media
-- =========================================================================
-- Phase 0 of the chatbot scaling roadmap (see CHATBOT_SCALING_AUDIT.md).
-- Three pure-additive changes — no behavior change, no data migration:
--
--   1+2. Partial indexes that back the two unindexed operations inside
--        claim_messenger_jobs() — the hottest query in the system (runs on
--        every batch of every worker invocation + the 1-minute cron):
--          - the per-claim stale-reset UPDATE filters on
--            (status='running' AND started_at<=threshold) but the only
--            existing index (messenger_jobs_status_idx on status,scheduled_at)
--            is ordered by scheduled_at, so the predicate is evaluated per
--            running row. A partial index on (started_at) WHERE status='running'
--            turns the normal (no-stale) case into a near-empty index range.
--          - the "(a) no running sibling" NOT EXISTS subquery probes by
--            thread_id among running rows with no supporting index. A partial
--            index on (thread_id) WHERE status='running' makes it an index probe.
--
--   3. Re-create claim_messenger_jobs to ALSO return outbound_media jsonb.
--      Migration 20260502090000 added it to the RPC return; migration
--      20260514000000_agent_followup.sql redefined the function and silently
--      dropped it. The worker still reads job.outbound_media (claimJobs coerces
--      a missing value to []) and sendSelectedMedia builds its "already sent"
--      set from it — so with the column dropped, every retry re-sends up to 4
--      images. Restoring the column to the return shape makes media sends
--      idempotent again with zero worker-code change.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Stale-reset support index: bounds the per-claim UPDATE scan.
-- -------------------------------------------------------------------------
create index if not exists messenger_jobs_running_started_idx
  on public.messenger_jobs (started_at)
  where status = 'running';

-- -------------------------------------------------------------------------
-- 2. Running-sibling probe index for the claim filter.
-- -------------------------------------------------------------------------
create index if not exists messenger_jobs_running_thread_idx
  on public.messenger_jobs (thread_id)
  where status = 'running';

-- -------------------------------------------------------------------------
-- 3. Re-create claim_messenger_jobs to restore outbound_media in the return.
--    Identical to the 20260514000000 definition in every other respect
--    (stale-reset, per-thread (a)/(b) filters, FOR UPDATE SKIP LOCKED).
-- -------------------------------------------------------------------------
create or replace function public.claim_messenger_jobs(
  p_limit         int default 5,
  p_stale_seconds int default 300
)
returns table (
  id                    uuid,
  thread_id             uuid,
  inbound_msg_id        uuid,
  user_id               uuid,
  attempts              integer,
  outbound_text_fb_id   text,
  outbound_button_fb_id text,
  outbound_media        jsonb,
  kind                  text,
  payload               jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Reset stuck running jobs from crashed workers.
  update public.messenger_jobs
     set status     = 'queued',
         started_at = null
   where status     = 'running'
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
           j.outbound_button_fb_id,
           j.outbound_media,
           j.kind,
           j.payload
      from public.messenger_jobs j
     where j.status = 'queued'
       and j.scheduled_at <= now()
       -- (a) Skip threads with a running job — that worker owns the conversation.
       and not exists (
         select 1
           from public.messenger_jobs r
          where r.thread_id = j.thread_id
            and r.status   = 'running'
       )
       -- (b) Only the oldest queued job per thread.
       and not exists (
         select 1
           from public.messenger_jobs e
          where e.thread_id = j.thread_id
            and e.status    = 'queued'
            and (
              e.scheduled_at < j.scheduled_at
              or (e.scheduled_at = j.scheduled_at and e.id < j.id)
            )
       )
     order by j.scheduled_at, j.id
     limit greatest(p_limit, 1)
     for update skip locked
  )
  update public.messenger_jobs j
     set status     = 'running',
         started_at = now()
    from picked p
   where j.id     = p.id
     and j.status = 'queued'
  returning j.id,
            j.thread_id,
            j.inbound_msg_id,
            j.user_id,
            j.attempts,
            j.outbound_text_fb_id,
            j.outbound_button_fb_id,
            j.outbound_media,
            j.kind,
            j.payload;
end;
$$;

revoke all   on function public.claim_messenger_jobs(int, int) from public;
grant execute on function public.claim_messenger_jobs(int, int) to service_role;
