-- Stamp `last_inbound_at` the moment an inbound message is persisted.
--
-- Until now the column was written ONLY by the async reply worker
-- (/api/messenger/process), several seconds — or, on a muted thread with
-- auto-classify off, NEVER — after the webhook stored the customer's message.
-- Every reader treats `last_inbound_at` as "when did the customer last write",
-- and the 24h Messenger window is derived from it, so the lag made a fresh
-- conversation look out-of-window: an operator replying within a minute of the
-- customer got escalated to the HUMAN_AGENT tag and, on pages Meta hasn't
-- approved for it, rejected outright (subcode 2018276).
--
-- The counter bump already runs once per unique inbound message (deduped on
-- messenger_messages.fb_message_id upstream), so folding the stamp into the
-- same UPDATE costs nothing and makes the window accurate at delivery time.
create or replace function public.increment_thread_counters(
  p_thread_id uuid,
  p_preview   text
)
returns void
language sql
volatile
security invoker
set search_path = public
as $$
  update public.messenger_threads
  set unread_count         = unread_count + 1,
      missed_count         = missed_count + 1,
      last_message_at      = now(),
      last_inbound_at      = now(),
      last_message_preview = p_preview
  where id = p_thread_id;
$$;

-- Supabase default privileges grant EXECUTE on new functions to anon &
-- authenticated DIRECTLY (not via PUBLIC), so revoke from the roles explicitly.
revoke all on function public.increment_thread_counters(uuid, text) from public, anon, authenticated;
grant execute on function public.increment_thread_counters(uuid, text) to service_role;
