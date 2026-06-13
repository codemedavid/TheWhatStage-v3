-- =========================================================================
-- Admin audit log (WS2): an append-only trail of every superadmin mutation
-- (status changes, tier changes, usage adjustments, cap overrides, …).
--
-- Writes happen via the service-role admin client from superadmin-gated routes
-- (the same trusted-server pattern as the usage ledger) — there is deliberately
-- NO insert/update/delete RLS policy. Superadmins may READ the trail via
-- current_role() (the existing JWT role gate from 20260428000000_auth_profiles).
--
-- actor_id / target_user_id are stored as bare uuids (no FK cascade) so the audit
-- trail survives even if the referenced user is later deleted.
-- =========================================================================

create table public.admin_audit_log (
  id             bigint generated always as identity primary key,
  actor_id       uuid not null,
  actor_email    text,
  action         text not null,          -- e.g. 'user.status.set', 'user.tier.set', 'usage.adjust', 'usage.cap.set'
  target_user_id uuid,
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index admin_audit_log_target_idx  on public.admin_audit_log (target_user_id, created_at desc);

alter table public.admin_audit_log enable row level security;

-- Superadmins read the trail; no one writes through RLS (service role only).
create policy "admin audit readable by superadmin"
  on public.admin_audit_log for select
  using (public.current_role() = 'superadmin');
