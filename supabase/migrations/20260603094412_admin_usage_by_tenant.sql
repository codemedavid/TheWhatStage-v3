-- Cross-tenant AI usage aggregation for the superadmin view (Phase 2).
-- DB-side GROUP BY over the live ledger so the figure is real-time and scales.
-- SECURITY DEFINER + execute granted to service_role only: it's reachable
-- exclusively through the service-role admin client used by the superadmin
-- page (itself gated on role='superadmin'). Not callable by anon/authenticated.
create or replace function public.admin_usage_by_tenant(p_since timestamptz)
returns table (
  user_id       uuid,
  email         text,
  full_name     text,
  total_tokens  bigint,
  cost_micros   bigint,
  event_count   bigint,
  last_event_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    e.user_id,
    p.email,
    p.full_name,
    sum(e.total_tokens)::bigint as total_tokens,
    sum(e.cost_micros)::bigint  as cost_micros,
    count(*)::bigint            as event_count,
    max(e.created_at)           as last_event_at
  from public.llm_usage_events e
  left join public.profiles p on p.id = e.user_id
  where e.created_at >= p_since
  group by e.user_id, p.email, p.full_name
  order by sum(e.cost_micros) desc;
$$;

revoke all on function public.admin_usage_by_tenant(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_usage_by_tenant(timestamptz) to service_role;
