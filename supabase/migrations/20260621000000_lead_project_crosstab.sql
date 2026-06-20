-- =========================================================================
-- Lead-stage -> project-stage cross-tab analytics (per-tenant).
--
-- Extends the leads analytics suite (migration 20260620140000) with the
-- cross-funnel the dashboard's "Lead → Project" explorer needs: of the leads
-- that reached a given pipeline stage (e.g. "Qualified"), how many went on to
-- reach a given project stage (e.g. "Won")?
--
-- Same MONOTONIC, position-based "reached a stage" semantics as the rest of the
-- suite: a lead/project counts at every forward rung up to and including the
-- furthest one it ever touched (current stage_id OR any *_stage_events row), so
-- the numbers are robust to manual kanban moves that update stage_id without
-- writing an event. Side-stages (lost / dormant / objection) are excluded from
-- the forward ladders. Every function is SECURITY INVOKER and self-scopes to
-- auth.uid(); RLS on the base tables is the second line of defence.
-- =========================================================================

-- ---- Lead stage x project stage cross-tab ------------------------------
-- Returns one row per (forward lead stage) x (forward project stage). `leads`
-- is the count of distinct cohort leads whose furthest lead stage >= lead_rank
-- AND whose best project's furthest stage >= project_rank. `lead_stage_total`
-- is the count reaching lead_rank regardless of any project — the conversion
-- denominator. Leads with no project contribute to lead_stage_total but never
-- to `leads` (their proj_max is NULL).
create or replace function public.analytics_lead_project_crosstab(
  p_from     date default null,
  p_to       date default null,
  p_source   text default null,
  p_campaign uuid default null
)
returns table (
  lead_stage_id     uuid,
  lead_stage_name   text,
  lead_kind         text,
  lead_rank         int,
  lead_stage_total  bigint,
  project_stage_id  uuid,
  project_stage_name text,
  project_kind      text,
  project_rank      int,
  leads             bigint
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
  ),
  lead_forward as (
    select s.id, s.name, s.kind, s.position,
           (row_number() over (order by s.position) - 1)::int as rank
    from public.pipeline_stages s
    where s.user_id = auth.uid()
      and s.kind in ('entry', 'qualifying', 'nurture', 'decision', 'won')
  ),
  lead_touched as (
    select c.id as lead_id, lf.rank
    from cohort c
    join lead_forward lf on lf.id = c.stage_id
    union
    select e.lead_id, lf.rank
    from public.lead_stage_events e
    join cohort c on c.id = e.lead_id
    join lead_forward lf on lf.id = e.to_stage_id
    where e.user_id = auth.uid()
  ),
  lead_max as (
    select t.lead_id, max(t.rank) as lead_rank
    from lead_touched t
    group by t.lead_id
  ),
  proj as (
    select p.id, p.lead_id, p.stage_id
    from public.projects p
    where p.user_id = auth.uid()
      and p.lead_id in (select id from cohort)
      and (p_from is null or (p.created_at at time zone 'Asia/Manila')::date >= p_from)
      and (p_to   is null or (p.created_at at time zone 'Asia/Manila')::date <= p_to)
  ),
  proj_forward as (
    select s.id, s.name, s.kind, s.position,
           (row_number() over (order by s.position) - 1)::int as rank
    from public.project_stages s
    where s.user_id = auth.uid()
      and (s.kind is distinct from 'lost')
  ),
  proj_touched as (
    select pr.id as project_id, pr.lead_id, pf.rank
    from proj pr
    join proj_forward pf on pf.id = pr.stage_id
    union
    select pr.id, pr.lead_id, pf.rank
    from proj pr
    join public.project_stage_events e on e.project_id = pr.id and e.user_id = auth.uid()
    join proj_forward pf on pf.id = e.to_stage_id
  ),
  proj_lead_max as (
    select pt.lead_id, max(pt.rank) as proj_max
    from proj_touched pt
    group by pt.lead_id
  ),
  lead_agg as (
    select lm.lead_id, lm.lead_rank, plm.proj_max
    from lead_max lm
    left join proj_lead_max plm on plm.lead_id = lm.lead_id
  )
  select
    lf.id, lf.name, lf.kind, lf.rank,
    (select count(*) from lead_agg la where la.lead_rank >= lf.rank)::bigint,
    pf.id, pf.name, pf.kind, pf.rank,
    (select count(*) from lead_agg la
       where la.lead_rank >= lf.rank and la.proj_max >= pf.rank)::bigint
  from lead_forward lf
  cross join proj_forward pf
  order by lf.rank, pf.rank;
end;
$$;

-- ---- Drill-down: leads behind a cross-tab cell -------------------------
-- The actual leads behind a (lead_rank, project_rank) cell. p_project_rank < 0
-- means "no project constraint" (drill into a lead-stage column total). Capped
-- by p_limit; best_project_stage is the name of the furthest project stage the
-- lead's projects reached.
create or replace function public.analytics_lead_project_leads(
  p_from         date default null,
  p_to           date default null,
  p_source       text default null,
  p_campaign     uuid default null,
  p_lead_rank    int  default 0,
  p_project_rank int  default -1,
  p_limit        int  default 100
)
returns table (
  lead_id          uuid,
  lead_name        text,
  source           text,
  created_at       timestamptz,
  project_count    bigint,
  best_project_stage text,
  value_sum        numeric,
  currency         text
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
    select l.id, l.name, l.source, l.created_at, l.stage_id
    from public.leads l
    where l.user_id = auth.uid()
      and (p_from is null or (l.created_at at time zone 'Asia/Manila')::date >= p_from)
      and (p_to   is null or (l.created_at at time zone 'Asia/Manila')::date <= p_to)
      and (p_source   is null or l.source = p_source)
      and (p_campaign is null or l.campaign_id = p_campaign)
  ),
  lead_forward as (
    select s.id, s.kind, s.position,
           (row_number() over (order by s.position) - 1)::int as rank
    from public.pipeline_stages s
    where s.user_id = auth.uid()
      and s.kind in ('entry', 'qualifying', 'nurture', 'decision', 'won')
  ),
  lead_touched as (
    select c.id as lead_id, lf.rank
    from cohort c join lead_forward lf on lf.id = c.stage_id
    union
    select e.lead_id, lf.rank
    from public.lead_stage_events e
    join cohort c on c.id = e.lead_id
    join lead_forward lf on lf.id = e.to_stage_id
    where e.user_id = auth.uid()
  ),
  lead_max as (
    select t.lead_id, max(t.rank) as lead_rank from lead_touched t group by t.lead_id
  ),
  proj as (
    select p.id, p.lead_id, p.stage_id, p.value, p.currency
    from public.projects p
    where p.user_id = auth.uid()
      and p.lead_id in (select id from cohort)
      and (p_from is null or (p.created_at at time zone 'Asia/Manila')::date >= p_from)
      and (p_to   is null or (p.created_at at time zone 'Asia/Manila')::date <= p_to)
  ),
  proj_forward as (
    select s.id, s.name, s.position,
           (row_number() over (order by s.position) - 1)::int as rank
    from public.project_stages s
    where s.user_id = auth.uid() and (s.kind is distinct from 'lost')
  ),
  proj_touched as (
    select pr.id as project_id, pr.lead_id, pf.rank, pf.name
    from proj pr join proj_forward pf on pf.id = pr.stage_id
    union
    select pr.id, pr.lead_id, pf.rank, pf.name
    from proj pr
    join public.project_stage_events e on e.project_id = pr.id and e.user_id = auth.uid()
    join proj_forward pf on pf.id = e.to_stage_id
  ),
  proj_lead as (
    select pt.lead_id,
           max(pt.rank) as proj_max,
           (array_agg(pt.name order by pt.rank desc))[1] as best_stage
    from proj_touched pt
    group by pt.lead_id
  )
  select
    c.id, c.name, c.source, c.created_at,
    (select count(*) from proj p where p.lead_id = c.id)::bigint,
    pl.best_stage,
    (select coalesce(sum(p.value), 0) from proj p where p.lead_id = c.id)::numeric,
    (select max(p.currency) from proj p where p.lead_id = c.id)
  from cohort c
  join lead_max lm on lm.lead_id = c.id
  left join proj_lead pl on pl.lead_id = c.id
  where lm.lead_rank >= p_lead_rank
    and (p_project_rank < 0 or pl.proj_max >= p_project_rank)
  order by c.created_at desc
  limit greatest(p_limit, 0);
end;
$$;

-- ---- Value contribution per project stage ------------------------------
-- Non-monotonic: each project sits in exactly one CURRENT stage. Sum/avg/count
-- of project value per current project stage (lost included so the breakdown is
-- complete), scoped to the lead cohort when a source/campaign filter is active.
create or replace function public.analytics_project_stage_value(
  p_from     date default null,
  p_to       date default null,
  p_source   text default null,
  p_campaign uuid default null
)
returns table (
  stage_id      uuid,
  name          text,
  kind          text,
  "position"    int,
  project_count bigint,
  value_count   bigint,
  value_sum     numeric,
  value_avg     numeric
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
    select l.id
    from public.leads l
    where l.user_id = auth.uid()
      and (p_from is null or (l.created_at at time zone 'Asia/Manila')::date >= p_from)
      and (p_to   is null or (l.created_at at time zone 'Asia/Manila')::date <= p_to)
      and (p_source   is null or l.source = p_source)
      and (p_campaign is null or l.campaign_id = p_campaign)
  ),
  proj as (
    select p.stage_id, p.value
    from public.projects p
    where p.user_id = auth.uid()
      and (p_from is null or (p.created_at at time zone 'Asia/Manila')::date >= p_from)
      and (p_to   is null or (p.created_at at time zone 'Asia/Manila')::date <= p_to)
      and ((p_source is null and p_campaign is null) or p.lead_id in (select id from cohort))
  )
  select
    s.id, s.name, s.kind, s.position,
    (select count(*) from proj p where p.stage_id = s.id)::bigint,
    (select count(p.value) from proj p where p.stage_id = s.id)::bigint,
    (select coalesce(sum(p.value), 0) from proj p where p.stage_id = s.id)::numeric,
    (select avg(p.value) from proj p where p.stage_id = s.id)::numeric
  from public.project_stages s
  where s.user_id = auth.uid()
  order by s.position;
end;
$$;

-- ---- Grants ------------------------------------------------------------
revoke all on function public.analytics_lead_project_crosstab(date, date, text, uuid)               from public, anon;
revoke all on function public.analytics_lead_project_leads(date, date, text, uuid, int, int, int)    from public, anon;
revoke all on function public.analytics_project_stage_value(date, date, text, uuid)                  from public, anon;
grant execute on function public.analytics_lead_project_crosstab(date, date, text, uuid)             to authenticated;
grant execute on function public.analytics_lead_project_leads(date, date, text, uuid, int, int, int) to authenticated;
grant execute on function public.analytics_project_stage_value(date, date, text, uuid)               to authenticated;
