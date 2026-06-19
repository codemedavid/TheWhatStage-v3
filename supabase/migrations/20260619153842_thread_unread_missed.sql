-- =========================================================================
-- Per-lead unread / missed message tracking for the Projects surface
-- =========================================================================
-- messenger_threads.unread_count already exists but was effectively dead: the
-- webhook only set it to 1 for brand-new lead-less threads and nothing ever
-- reset it. We make it a real per-inbound counter and add a sibling missed_count
-- with different reset semantics:
--   unread_count  -> reset when the team OPENS the conversation or marks read.
--   missed_count  -> running tally; reset ONLY on explicit "Mark as read" (and
--                    zeroed when the lead's project is created, so it counts
--                    forward from the moment the project exists).
-- Resets are plain UPDATEs from the dashboard (RLS-scoped). Only the per-inbound
-- increment needs an RPC, because supabase-js cannot express `col = col + 1`.
-- =========================================================================

alter table public.messenger_threads
  add column if not exists missed_count integer not null default 0,
  add column if not exists last_read_at timestamptz;

-- Atomically bump both counters and refresh the thread tail on a new inbound
-- message. Called by the webhook/worker (service role, bypasses RLS). Security
-- invoker: the service role already has full access; no privilege escalation.
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
      last_message_preview = p_preview
  where id = p_thread_id;
$$;

-- Supabase default privileges grant EXECUTE on new functions to anon &
-- authenticated DIRECTLY (not via PUBLIC), so revoke from the roles explicitly.
-- Write-path RPC: service_role only.
revoke all on function public.increment_thread_counters(uuid, text) from public, anon, authenticated;
grant execute on function public.increment_thread_counters(uuid, text) to service_role;

-- Sum of unread across the caller's threads whose lead has at least one project.
-- Security invoker so RLS scopes both tables to auth.uid(); powers the global
-- nav "messages waiting" counter.
create or replace function public.count_project_unread()
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(t.unread_count), 0)::int
  from public.messenger_threads t
  where t.lead_id is not null
    and exists (
      -- Match owner explicitly so the scope holds even if projects RLS is later
      -- loosened (e.g. team sharing); does not rely on RLS alone.
      select 1 from public.projects p
      where p.lead_id = t.lead_id and p.user_id = t.user_id
    );
$$;

revoke all on function public.count_project_unread() from public, anon;
grant execute on function public.count_project_unread() to authenticated;
