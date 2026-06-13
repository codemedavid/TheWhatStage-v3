-- =========================================================================
-- WS3 — usage_adjustments: an append-only ledger of superadmin corrections to a
-- tenant's metered usage (credits, manual additions, period resets).
--
-- The llm_usage_events ledger is FROZEN (cost computed at write time, never
-- edited). Corrections never touch it — they land here as signed deltas and are
-- summed into the effective usage shown to the tenant + admin. A "reset" is just
-- an adjustment that negates the current period's net to zero.
--
-- Writes are service-role only (from superadmin-gated routes, audited via
-- admin_audit_log). Tenants read their own; superadmins read all.
-- =========================================================================

create table public.usage_adjustments (
  id                bigint generated always as identity primary key,
  user_id           uuid not null references auth.users(id) on delete cascade,
  delta_tokens      bigint not null default 0,    -- signed: negative = credit / reduction
  delta_cost_micros bigint not null default 0,    -- signed; USD * 1e6
  reason            text not null,
  kind              text not null default 'adjust', -- 'adjust' | 'credit' | 'reset'
  actor_id          uuid not null,                -- superadmin who applied it
  created_at        timestamptz not null default now()
);

create index usage_adjustments_user_idx on public.usage_adjustments (user_id, created_at desc);

alter table public.usage_adjustments enable row level security;

create policy "own adjustments read"
  on public.usage_adjustments for select
  using (user_id = auth.uid());
create policy "superadmin adjustments read"
  on public.usage_adjustments for select
  using (public.current_role() = 'superadmin');
