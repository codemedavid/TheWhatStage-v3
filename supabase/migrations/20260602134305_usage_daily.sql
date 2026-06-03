-- =========================================================================
-- Usage rollup (Phase 2 of usage-based billing — see USAGE_BILLING_PLAN.md).
--
-- usage_daily is the pre-aggregated table that dashboards + quota checks read,
-- so they never scan the raw llm_usage_events ledger. One row per
-- (tenant, Manila calendar day). Refreshed by rollup_llm_usage_daily(), invoked
-- hourly via pg_cron (next migration).
--
-- Purely additive. Days are bucketed in Asia/Manila so a tenant's "today" lines
-- up with their local day, matching how the rest of the app reasons about time.
-- =========================================================================

create table public.usage_daily (
  user_id      uuid not null references auth.users(id) on delete cascade,
  day          date not null,                 -- Asia/Manila calendar day
  total_tokens bigint not null default 0,
  cost_micros  bigint not null default 0,     -- USD * 1e6
  event_count  integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.usage_daily enable row level security;

-- Tenants read their own daily usage (dashboard). Writes happen only through the
-- security-definer rollup function below / service role — no client write policy.
create policy "own daily usage read"
  on public.usage_daily for select
  using (user_id = auth.uid());

-- -------------------------------------------------------------------------
-- Rollup function: fully recompute every Manila-day that received a ledger
-- event since p_since, then upsert into usage_daily. Recomputing whole days
-- (rather than summing only the new rows) keeps this idempotent and safe to run
-- on any cadence — a partial run can never leave a half-counted day behind.
-- Default window of 2 days comfortably covers an hourly cron plus clock skew.
-- -------------------------------------------------------------------------
create or replace function public.rollup_llm_usage_daily(
  p_since timestamptz default now() - interval '2 days'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  affected integer;
begin
  with touched as (
    select distinct (created_at at time zone 'Asia/Manila')::date as day
    from public.llm_usage_events
    where created_at >= p_since
  )
  insert into public.usage_daily (user_id, day, total_tokens, cost_micros, event_count, updated_at)
  select
    e.user_id,
    (e.created_at at time zone 'Asia/Manila')::date as day,
    sum(e.total_tokens),
    sum(e.cost_micros),
    count(*),
    now()
  from public.llm_usage_events e
  where (e.created_at at time zone 'Asia/Manila')::date in (select day from touched)
  group by e.user_id, (e.created_at at time zone 'Asia/Manila')::date
  on conflict (user_id, day) do update
    set total_tokens = excluded.total_tokens,
        cost_micros  = excluded.cost_micros,
        event_count  = excluded.event_count,
        updated_at   = now();

  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- Only the service role (cron route) may invoke the rollup.
revoke all on function public.rollup_llm_usage_daily(timestamptz) from public, anon, authenticated;
