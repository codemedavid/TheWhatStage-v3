-- Agent bulk preview: make the last-inbound lookup an index seek per thread.
--
-- "loadContext: last inbound lookup failed — canceling statement due to
-- statement timeout". agent_last_inbound_by_thread() ran DISTINCT ON over
-- every message of every thread in the chunk, filtering direction on the
-- heap, and a large audience fires many chunks at once. A partial index on
-- inbound rows plus a LIMIT 1 lateral per thread reads one index entry per
-- thread instead of the whole history.

create index if not exists messenger_messages_inbound_thread_created_idx
  on public.messenger_messages (thread_id, created_at desc)
  where direction = 'inbound';

create or replace function public.agent_last_inbound_by_thread(
  p_thread_ids uuid[]
)
returns table (thread_id uuid, body text)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, last_msg.body
    from unnest(p_thread_ids) as t(id)
    cross join lateral (
      select m.body
        from public.messenger_messages m
       where m.thread_id = t.id
         and m.direction = 'inbound'
       order by m.created_at desc
       limit 1
    ) last_msg;
$$;

revoke all on function public.agent_last_inbound_by_thread(uuid[]) from public;
grant execute on function public.agent_last_inbound_by_thread(uuid[]) to service_role;
