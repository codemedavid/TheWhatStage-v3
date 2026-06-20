-- =========================================================================
-- Message debounce: coalesce rapid-fire customer messages into one AI reply
-- =========================================================================
-- Two additive changes:
--
--   1. chatbot_configs.message_debounce_seconds — per-tenant quiet window. The
--      webhook defers a reply job by this many seconds and slides the window
--      forward on each new inbound, so a burst of messages is answered once.
--      Default 6s. 0 = disabled (instant, legacy behavior). Capped to 15 in
--      app code (rowToConfig) so it stays under the worker's 20s warm-wait.
--
--   2. enqueue_or_extend_messenger_job(...) — atomically EITHER bump the
--      scheduled_at of the thread's existing queued (not-yet-running) reply job
--      OR insert a fresh one. Guarantees at most one queued job per thread and
--      closes the check-then-insert race two concurrent webhook events would
--      otherwise hit. Returns the job id.
-- =========================================================================

alter table public.chatbot_configs
  add column if not exists message_debounce_seconds integer not null default 6;

-- -------------------------------------------------------------------------
-- Enqueue-or-extend the per-thread reply job.
--   p_debounce_seconds = 0 → behaves like the old immediate enqueue.
-- Only a job that is still 'queued' is extendable; a 'running' job is owned by
-- a worker (the claim RPC blocks the thread), so we insert a fresh job that the
-- worker will pick up — and coalesce — after the running one finishes.
-- -------------------------------------------------------------------------
create or replace function public.enqueue_or_extend_messenger_job(
  p_thread_id      uuid,
  p_inbound_msg_id uuid,
  p_user_id        uuid,
  p_debounce_seconds integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_due timestamptz := now() + make_interval(secs => greatest(0, coalesce(p_debounce_seconds, 0)));
  v_job_id uuid;
begin
  -- Extend the newest queued (not-yet-running) job for this thread, sliding its
  -- window forward and pointing it at the latest inbound message. SKIP LOCKED so
  -- we never block on a row a concurrent worker is claiming.
  update public.messenger_jobs j
     set scheduled_at  = v_due,
         inbound_msg_id = p_inbound_msg_id
   where j.id = (
           select c.id
             from public.messenger_jobs c
            where c.thread_id = p_thread_id
              and c.status = 'queued'
              and c.kind = 'inbound_reply'
            order by c.scheduled_at desc, c.id desc
            limit 1
            for update skip locked
         )
  returning j.id into v_job_id;

  if v_job_id is not null then
    return v_job_id;
  end if;

  -- No extendable queued job → insert a new one.
  insert into public.messenger_jobs (thread_id, inbound_msg_id, user_id, scheduled_at)
  values (p_thread_id, p_inbound_msg_id, p_user_id, v_due)
  returning id into v_job_id;

  return v_job_id;
end;
$$;

revoke all   on function public.enqueue_or_extend_messenger_job(uuid, uuid, uuid, integer) from public;
grant execute on function public.enqueue_or_extend_messenger_job(uuid, uuid, uuid, integer) to service_role;
