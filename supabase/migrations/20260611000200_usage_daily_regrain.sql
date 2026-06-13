-- =========================================================================
-- WS3 — Re-grain usage_daily into the analytics backbone.
--
-- The original usage_daily was keyed only (user_id, day) and is currently unread
-- by any live code, so we drop + recreate it at a finer grain
-- (user_id, day, scope, model) carrying the full token breakdown. This single
-- table is now the source for BOTH coarse per-tenant totals (SUM over scope/model)
-- and the scope/model/cache-savings breakdowns the admin analytics need — one
-- source, no drift. Always recomputable from the append-only ledger.
--
-- Asia/Manila day bucketing is preserved. The rollup keeps its whole-touched-day
-- recompute (idempotent on any cadence). Backfilled from the ledger at the end.
-- =========================================================================

drop function if exists public.rollup_llm_usage_daily(timestamptz);
drop table if exists public.usage_daily;

create table public.usage_daily (
  user_id              uuid not null references auth.users(id) on delete cascade,
  day                  date not null,                       -- Asia/Manila calendar day
  scope                public.llm_usage_scope not null,
  model                text not null,
  prompt_tokens        bigint not null default 0,
  cached_prompt_tokens bigint not null default 0,           -- subset of prompt_tokens (cache hits)
  completion_tokens    bigint not null default 0,
  total_tokens         bigint not null default 0,
  cost_micros          bigint not null default 0,           -- USD * 1e6 (estimate until rates verified)
  event_count          integer not null default 0,
  updated_at           timestamptz not null default now(),
  primary key (user_id, day, scope, model)
);

-- (user_id, day) is the PK prefix → per-tenant range scans are covered. Add a day
-- index for fleet-wide (all-tenant) trend/totals queries.
create index usage_daily_day_idx on public.usage_daily (day);

-- BRIN on the ledger's created_at: tiny, ideal for the rollup's time-range scan.
create index if not exists llm_usage_events_created_brin
  on public.llm_usage_events using brin (created_at);

alter table public.usage_daily enable row level security;

-- Tenants read their own daily usage; superadmins read all (admin analytics).
-- Writes happen only through the security-definer rollup / service role.
create policy "own daily usage read"
  on public.usage_daily for select
  using (user_id = auth.uid());
create policy "superadmin daily usage read"
  on public.usage_daily for select
  using (public.current_role() = 'superadmin');

-- -------------------------------------------------------------------------
-- Rollup: recompute every Manila-day touched since p_since, grouped by the new
-- (user, day, scope, model) grain, and upsert. Whole-day recompute keeps it
-- idempotent; the append-only ledger means no (user,day,scope,model) combo ever
-- disappears, so no stale rows accumulate.
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
  insert into public.usage_daily (
    user_id, day, scope, model,
    prompt_tokens, cached_prompt_tokens, completion_tokens, total_tokens,
    cost_micros, event_count, updated_at
  )
  select
    e.user_id,
    (e.created_at at time zone 'Asia/Manila')::date as day,
    e.scope,
    e.model,
    sum(e.prompt_tokens),
    sum(e.cached_prompt_tokens),
    sum(e.completion_tokens),
    sum(e.total_tokens),
    sum(e.cost_micros),
    count(*),
    now()
  from public.llm_usage_events e
  where (e.created_at at time zone 'Asia/Manila')::date in (select day from touched)
  group by e.user_id, (e.created_at at time zone 'Asia/Manila')::date, e.scope, e.model
  on conflict (user_id, day, scope, model) do update
    set prompt_tokens        = excluded.prompt_tokens,
        cached_prompt_tokens = excluded.cached_prompt_tokens,
        completion_tokens    = excluded.completion_tokens,
        total_tokens         = excluded.total_tokens,
        cost_micros          = excluded.cost_micros,
        event_count          = excluded.event_count,
        updated_at           = now();

  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- Only the service role (cron route) may invoke the rollup.
revoke all on function public.rollup_llm_usage_daily(timestamptz) from public, anon, authenticated;

-- Backfill the regrained table from the existing ledger (last 90 days).
select public.rollup_llm_usage_daily(now() - interval '90 days');
