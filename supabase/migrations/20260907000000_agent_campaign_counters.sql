-- Agent campaigns: atomic progress counters + bulk last-inbound lookup.
--
-- 1. agent_campaign_bump(): the worker previously did a read-then-write
--    increment of sent/failed/skipped. With 8+ parallel job runners the
--    increments raced and were lost (a real campaign showed sent=53 while
--    190 message rows were actually 'sent'), so the campaign never reached
--    total and never flipped to 'completed'. This does the increment and the
--    completion check in one statement.
--
-- 2. agent_last_inbound_by_thread(): DISTINCT ON lookup of the newest
--    inbound message body per thread, so preview personalization works for
--    audiences larger than PostgREST max_rows.

create or replace function public.agent_campaign_bump(
  p_campaign_id uuid,
  p_counter     text
)
returns table (total int, sent int, failed int, skipped int, status text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_counter not in ('sent', 'failed', 'skipped') then
    raise exception 'agent_campaign_bump: invalid counter %', p_counter;
  end if;

  return query
  with bumped as (
    update public.agent_campaigns c
       set sent    = c.sent    + (p_counter = 'sent')::int,
           failed  = c.failed  + (p_counter = 'failed')::int,
           skipped = c.skipped + (p_counter = 'skipped')::int
     where c.id = p_campaign_id
     returning c.id, c.total, c.sent, c.failed, c.skipped, c.status
  ),
  completed as (
    update public.agent_campaigns c
       set status       = 'completed',
           completed_at = now()
      from bumped b
     where c.id = b.id
       and c.status in ('sending', 'dispatching')
       and b.sent + b.failed + b.skipped >= b.total
     returning c.status
  )
  select b.total, b.sent, b.failed, b.skipped,
         coalesce((select cp.status from completed cp), b.status)
    from bumped b;
end;
$$;

revoke all on function public.agent_campaign_bump(uuid, text) from public;
grant execute on function public.agent_campaign_bump(uuid, text) to service_role;

create or replace function public.agent_last_inbound_by_thread(
  p_thread_ids uuid[]
)
returns table (thread_id uuid, body text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (m.thread_id) m.thread_id, m.body
    from public.messenger_messages m
   where m.thread_id = any (p_thread_ids)
     and m.direction = 'inbound'
   order by m.thread_id, m.created_at desc;
$$;

revoke all on function public.agent_last_inbound_by_thread(uuid[]) from public;
grant execute on function public.agent_last_inbound_by_thread(uuid[]) to service_role;
