-- =========================================================================
-- Lock down messenger_page_rate_buckets.
--
-- The bucket is read and written only by the service-role campaign worker
-- (see src/lib/messenger/campaignSend.ts). The original agent_followup
-- migration described it as "service_role only; no user RLS" but forgot to
-- enable RLS, so the row contents were reachable through the anon and
-- authenticated keys via PostgREST. Service-role bypasses RLS, so enabling
-- it with no policies locks the table down without breaking the worker.
-- =========================================================================

alter table public.messenger_page_rate_buckets enable row level security;
