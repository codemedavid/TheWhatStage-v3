-- =========================================================================
-- WS3 — Superadmin analytics RPCs.
--
-- All read the usage_daily rollup (scales to the whole fleet; refreshed hourly).
-- Each is SECURITY DEFINER and self-checks current_role() = 'superadmin', so they
-- are safe to grant to `authenticated` and call via the normal RLS client (the
-- superadmin's own session) — no service-role client in a component. Date bounds
-- are Asia/Manila calendar days (matching usage_daily.day). An optional p_user
-- narrows any query to one tenant, so the same RPCs power both the fleet Overview
-- and the per-tenant drill-down.
-- =========================================================================

-- Raw-ledger drill-down for the superadmin (recent events for one tenant).
create policy "superadmin events read"
  on public.llm_usage_events for select
  using (public.current_role() = 'superadmin');

-- ---- Fleet / per-tenant totals -----------------------------------------
create or replace function public.admin_usage_totals(
  p_from date, p_to date, p_user uuid default null
)
returns table (
  total_tokens         bigint,
  prompt_tokens        bigint,
  cached_prompt_tokens bigint,
  completion_tokens    bigint,
  cost_micros          bigint,
  event_count          bigint,
  active_tenants       bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() <> 'superadmin' then
    raise exception 'forbidden: superadmin only' using errcode = '42501';
  end if;
  return query
    select
      coalesce(sum(d.total_tokens), 0)::bigint,
      coalesce(sum(d.prompt_tokens), 0)::bigint,
      coalesce(sum(d.cached_prompt_tokens), 0)::bigint,
      coalesce(sum(d.completion_tokens), 0)::bigint,
      coalesce(sum(d.cost_micros), 0)::bigint,
      coalesce(sum(d.event_count), 0)::bigint,
      count(distinct d.user_id)::bigint
    from public.usage_daily d
    where d.day between p_from and p_to
      and (p_user is null or d.user_id = p_user);
end;
$$;

-- ---- Daily trend series -------------------------------------------------
create or replace function public.admin_usage_trend(
  p_from date, p_to date, p_user uuid default null
)
returns table (
  day                  date,
  total_tokens         bigint,
  cached_prompt_tokens bigint,
  completion_tokens    bigint,
  cost_micros          bigint,
  event_count          bigint,
  active_tenants       bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() <> 'superadmin' then
    raise exception 'forbidden: superadmin only' using errcode = '42501';
  end if;
  return query
    select
      d.day,
      sum(d.total_tokens)::bigint,
      sum(d.cached_prompt_tokens)::bigint,
      sum(d.completion_tokens)::bigint,
      sum(d.cost_micros)::bigint,
      sum(d.event_count)::bigint,
      count(distinct d.user_id)::bigint
    from public.usage_daily d
    where d.day between p_from and p_to
      and (p_user is null or d.user_id = p_user)
    group by d.day
    order by d.day;
end;
$$;

-- ---- Breakdown by scope + model ----------------------------------------
create or replace function public.admin_usage_by_scope_model(
  p_from date, p_to date, p_user uuid default null
)
returns table (
  scope                text,
  model                text,
  total_tokens         bigint,
  cached_prompt_tokens bigint,
  completion_tokens    bigint,
  cost_micros          bigint,
  event_count          bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() <> 'superadmin' then
    raise exception 'forbidden: superadmin only' using errcode = '42501';
  end if;
  return query
    select
      d.scope::text,
      d.model,
      sum(d.total_tokens)::bigint,
      sum(d.cached_prompt_tokens)::bigint,
      sum(d.completion_tokens)::bigint,
      sum(d.cost_micros)::bigint,
      sum(d.event_count)::bigint
    from public.usage_daily d
    where d.day between p_from and p_to
      and (p_user is null or d.user_id = p_user)
    group by d.scope, d.model
    order by sum(d.total_tokens) desc;
end;
$$;

-- ---- Per-tenant ranking (with tier, effective cap, adjustments) --------
-- Replaces the old admin_usage_by_tenant(timestamptz) which scanned the live
-- ledger. Now reads the rollup + folds in usage_adjustments and the cap override.
drop function if exists public.admin_usage_by_tenant(timestamptz);

create or replace function public.admin_usage_by_tenant(p_from date, p_to date)
returns table (
  user_id          uuid,
  email            text,
  full_name        text,
  tier             text,
  included_tokens  bigint,
  total_tokens     bigint,
  adj_tokens       bigint,
  effective_tokens bigint,
  cost_micros      bigint,
  event_count      bigint,
  last_active_day  date
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_role() <> 'superadmin' then
    raise exception 'forbidden: superadmin only' using errcode = '42501';
  end if;
  return query
    with usage as (
      select
        d.user_id,
        sum(d.total_tokens)::bigint as total_tokens,
        sum(d.cost_micros)::bigint  as cost_micros,
        sum(d.event_count)::bigint  as event_count,
        max(d.day)                  as last_active_day
      from public.usage_daily d
      where d.day between p_from and p_to
      group by d.user_id
    ),
    adj as (
      select a.user_id, sum(a.delta_tokens)::bigint as adj_tokens
      from public.usage_adjustments a
      where (a.created_at at time zone 'Asia/Manila')::date between p_from and p_to
      group by a.user_id
    )
    select
      p.id,
      p.email,
      p.full_name,
      coalesce(p.subscription_tier::text, 'free'),
      coalesce(p.included_tokens_override, bp.included_tokens),
      coalesce(u.total_tokens, 0)::bigint,
      coalesce(adj.adj_tokens, 0)::bigint,
      (coalesce(u.total_tokens, 0) + coalesce(adj.adj_tokens, 0))::bigint,
      coalesce(u.cost_micros, 0)::bigint,
      coalesce(u.event_count, 0)::bigint,
      u.last_active_day
    from usage u
    join public.profiles p on p.id = u.user_id
    left join public.billing_plans bp on bp.id = coalesce(p.subscription_tier::text, 'free')
    left join adj on adj.user_id = u.user_id
    order by (coalesce(u.total_tokens, 0) + coalesce(adj.adj_tokens, 0)) desc;
end;
$$;

-- Callable by any signed-in user; the in-function current_role() guard is the
-- real gate. Not reachable by anon. Service role bypasses none of this — these
-- are meant to be called via the superadmin's own (RLS) session.
revoke all on function public.admin_usage_totals(date, date, uuid)        from public, anon;
revoke all on function public.admin_usage_trend(date, date, uuid)         from public, anon;
revoke all on function public.admin_usage_by_scope_model(date, date, uuid) from public, anon;
revoke all on function public.admin_usage_by_tenant(date, date)           from public, anon;
grant execute on function public.admin_usage_totals(date, date, uuid)        to authenticated;
grant execute on function public.admin_usage_trend(date, date, uuid)         to authenticated;
grant execute on function public.admin_usage_by_scope_model(date, date, uuid) to authenticated;
grant execute on function public.admin_usage_by_tenant(date, date)           to authenticated;
