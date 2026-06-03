-- Extend the cross-tenant usage aggregation (originally 20260603094412) to also
-- return the tenant's tier and its included-token cap, so the superadmin view can
-- show % of cap. Return shape changes, so drop + recreate.
drop function if exists public.admin_usage_by_tenant(timestamptz);

create function public.admin_usage_by_tenant(p_since timestamptz)
returns table (
  user_id         uuid,
  email           text,
  full_name       text,
  tier            text,
  included_tokens bigint,
  total_tokens    bigint,
  cost_micros     bigint,
  event_count     bigint,
  last_event_at   timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    e.user_id,
    p.email,
    p.full_name,
    coalesce(p.subscription_tier::text, 'free') as tier,
    bp.included_tokens,
    sum(e.total_tokens)::bigint as total_tokens,
    sum(e.cost_micros)::bigint  as cost_micros,
    count(*)::bigint            as event_count,
    max(e.created_at)           as last_event_at
  from public.llm_usage_events e
  left join public.profiles p on p.id = e.user_id
  left join public.billing_plans bp on bp.id = coalesce(p.subscription_tier::text, 'free')
  where e.created_at >= p_since
  group by e.user_id, p.email, p.full_name, p.subscription_tier, bp.included_tokens
  order by sum(e.cost_micros) desc;
$$;

revoke all on function public.admin_usage_by_tenant(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_usage_by_tenant(timestamptz) to service_role;
