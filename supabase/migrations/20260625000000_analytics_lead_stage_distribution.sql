-- =========================================================================
-- Lead current-stage distribution — per-tenant RPC.
--
-- Powers the "Where your leads are now" panel on /dashboard/analytics. Unlike
-- analytics_lead_funnel (a MONOTONIC "reached or beyond" funnel that relies on
-- each pipeline stage's `kind` to exclude off-ramps and mark the won terminal),
-- this returns the count of leads CURRENTLY sitting in each stage — exactly what
-- the kanban board column shows. It never reads `kind`, so it stays accurate for
-- the common case where a tenant's custom columns all default to kind='nurture'
-- (no won/lost classification), which made the funnel treat "Lost"/"Unqualified"
-- as forward progress and badly inflated "reached Won".
--
-- Cohort = leads CREATED in the Asia/Manila date range (+ optional
-- source/campaign), consistent with the rest of the analytics suite. Every
-- pipeline stage is returned in board (position) order, including zero-count
-- stages, so the panel mirrors the board left-to-right.
-- =========================================================================
create or replace function public.analytics_lead_stage_distribution(
  p_from     date default null,
  p_to       date default null,
  p_source   text default null,
  p_campaign uuid default null
)
returns table (
  stage_id   uuid,
  name       text,
  kind       text,
  "position" int,
  lead_count bigint
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'forbidden: authentication required' using errcode = '42501';
  end if;
  return query
  with cohort as (
    select l.id, l.stage_id
    from public.leads l
    where l.user_id = auth.uid()
      and (p_from is null or (l.created_at at time zone 'Asia/Manila')::date >= p_from)
      and (p_to   is null or (l.created_at at time zone 'Asia/Manila')::date <= p_to)
      and (p_source   is null or l.source = p_source)
      and (p_campaign is null or l.campaign_id = p_campaign)
  )
  select s.id, s.name, s.kind, s.position,
         (select count(*) from cohort c where c.stage_id = s.id)::bigint
  from public.pipeline_stages s
  where s.user_id = auth.uid()
  order by s.position;
end;
$$;

-- Callable by any signed-in user; self-scopes to auth.uid() with RLS as backup.
revoke all on function public.analytics_lead_stage_distribution(date, date, text, uuid) from public, anon;
grant execute on function public.analytics_lead_stage_distribution(date, date, text, uuid) to authenticated;
