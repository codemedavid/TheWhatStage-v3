-- Lock down the unread/missed counter RPCs.
-- Supabase default privileges grant EXECUTE on new functions to anon &
-- authenticated DIRECTLY (not via PUBLIC), so the original migration's
-- `REVOKE ... FROM PUBLIC` left those direct grants intact. Revoke from the
-- roles explicitly. Idempotent: safe to re-run, and the original migration now
-- carries the same explicit revokes for fresh resets.

-- Write-path RPC: service_role only.
revoke all on function public.increment_thread_counters(uuid, text) from public, anon, authenticated;
grant execute on function public.increment_thread_counters(uuid, text) to service_role;

-- Nav counter: authenticated only (auth.uid()-scoped); never anon.
revoke all on function public.count_project_unread() from public, anon;
grant execute on function public.count_project_unread() to authenticated;
