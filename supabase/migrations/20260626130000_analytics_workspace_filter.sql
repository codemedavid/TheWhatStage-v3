-- =========================================================================
-- Per-workspace analytics filtering.
--
-- Projects now live in workspaces ("project managements", migration
-- 20260626120000): both `projects` and `project_stages` carry a `workspace_id`.
-- The analytics suite (20260620140000 / 20260621000000) predates workspaces and
-- aggregates every workspace together, which crowds the conversion / Won numbers
-- once a user has more than one workspace.
--
-- This migration adds an optional `p_workspace_id uuid` to the SEVEN
-- project-touching RPCs. NULL = all workspaces (the original behaviour); a value
-- scopes the `projects` and `project_stages` CTEs to that one workspace, so e.g.
-- "Won" becomes the combined Won across all projects in the selected workspace.
--
-- Leads and `pipeline_stages` have NO workspace_id (leads are account-level), so
-- the LEAD-side RPCs (analytics_lead_funnel, analytics_lead_stage_distribution)
-- are intentionally left unchanged and stay account-wide. The lead COHORT inside
-- these project RPCs is likewise NOT workspace-filtered — only the project and
-- project-stage rungs are.
--
-- Adding a parameter creates a new overload rather than replacing the function,
-- which would make `function ... is not unique` at call time, so each function is
-- DROPped at its old signature before being recreated. Same MONOTONIC semantics
-- and SECURITY INVOKER / auth.uid() self-scoping as the originals.
-- =========================================================================

drop function if exists public.analytics_overview(date, date, text, uuid);
drop function if exists public.analytics_timeseries(date, date, text, uuid);
drop function if exists public.analytics_lead_to_project(date, date, text, uuid);
drop function if exists public.analytics_submission_to_project(date, date);
drop function if exists public.analytics_lead_project_crosstab(date, date, text, uuid);
drop function if exists public.analytics_lead_project_leads(date, date, text, uuid, int, int, int);
drop function if exists public.analytics_project_stage_value(date, date, text, uuid);

-- Workspace lookups on the project tables for the new predicate.
create index if not exists projects_user_workspace_idx
  on public.projects (user_id, workspace_id);
create index if not exists project_stages_user_workspace_idx
  on public.project_stages (user_id, workspace_id);

-- ---- Scalar KPIs (one row) ---------------------------------------------
create or replace function public.analytics_overview(
  p_from         date default null,
  p_to           date default null,
  p_source       text default null,
  p_campaign     uuid default null,
  p_workspace_id uuid default null
)
returns table (
  total_leads              bigint,
  total_projects           bigint,
  total_submissions        bigint,
  attributed_submissions   bigint,
  submissions_with_project bigint,
  active_action_pages      bigint,
  won_projects             bigint,
  lost_projects            bigint,
  open_projects            bigint,
  project_value_count      bigint,
  project_value_sum        numeric,
  project_value_avg        numeric,
  won_value_sum            numeric,
  open_value_sum           numeric,
  currency_count           bigint
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
    select p.value, p.currency, ps.kind as stage_kind
    from public.projects p
    join public.project_stages ps on ps.id = p.stage_id
    where p.user_id = auth.uid()
      and (p_workspace_id is null or p.workspace_id = p_workspace_id)
      and (p_from is null or (p.created_at at time zone 'Asia/Manila')::date >= p_from)
      and (p_to   is null or (p.created_at at time zone 'Asia/Manila')::date <= p_to)
      and ((p_source is null and p_campaign is null) or p.lead_id in (select id from cohort))
  ),
  subs as (
    select s.id, s.lead_id, s.action_page_id
    from public.action_page_submissions s
    where s.user_id = auth.uid()
      and (p_from is null or (s.created_at at time zone 'Asia/Manila')::date >= p_from)
      and (p_to   is null or (s.created_at at time zone 'Asia/Manila')::date <= p_to)
  )
  select
    (select count(*) from cohort)::bigint,
    (select count(*) from proj)::bigint,
    (select count(*) from subs)::bigint,
    (select count(*) from subs where lead_id is not null)::bigint,
    (select count(*) from subs s where exists (
        select 1 from public.projects p
        where p.user_id = auth.uid()
          and (p_workspace_id is null or p.workspace_id = p_workspace_id)
          and p.origin_submission_id = s.id))::bigint,
    (select count(distinct action_page_id) from subs)::bigint,
    (select count(*) from proj where stage_kind = 'won')::bigint,
    (select count(*) from proj where stage_kind = 'lost')::bigint,
    (select count(*) from proj where stage_kind is null or stage_kind = 'open')::bigint,
    (select count(value) from proj)::bigint,
    (select coalesce(sum(value), 0) from proj)::numeric,
    (select avg(value) from proj)::numeric,
    (select coalesce(sum(value) filter (where stage_kind = 'won'), 0) from proj)::numeric,
    (select coalesce(sum(value) filter (where stage_kind is null or stage_kind = 'open'), 0) from proj)::numeric,
    (select count(distinct currency) filter (where value is not null) from proj)::bigint;
end;
$$;

-- ---- Daily trend (leads / projects / submissions per Manila day) --------
create or replace function public.analytics_timeseries(
  p_from         date default null,
  p_to           date default null,
  p_source       text default null,
  p_campaign     uuid default null,
  p_workspace_id uuid default null
)
returns table (
  day         date,
  leads       bigint,
  projects    bigint,
  submissions bigint
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
    select l.id, l.created_at
    from public.leads l
    where l.user_id = auth.uid()
      and (p_from is null or (l.created_at at time zone 'Asia/Manila')::date >= p_from)
      and (p_to   is null or (l.created_at at time zone 'Asia/Manila')::date <= p_to)
      and (p_source   is null or l.source = p_source)
      and (p_campaign is null or l.campaign_id = p_campaign)
  ),
  events as (
    select (created_at at time zone 'Asia/Manila')::date as day, 1 as is_lead, 0 as is_proj, 0 as is_sub
    from cohort
    union all
    select (p.created_at at time zone 'Asia/Manila')::date, 0, 1, 0
    from public.projects p
    where p.user_id = auth.uid()
      and (p_workspace_id is null or p.workspace_id = p_workspace_id)
      and (p_from is null or (p.created_at at time zone 'Asia/Manila')::date >= p_from)
      and (p_to   is null or (p.created_at at time zone 'Asia/Manila')::date <= p_to)
      and ((p_source is null and p_campaign is null) or p.lead_id in (select id from cohort))
    union all
    select (s.created_at at time zone 'Asia/Manila')::date, 0, 0, 1
    from public.action_page_submissions s
    where s.user_id = auth.uid()
      and (p_from is null or (s.created_at at time zone 'Asia/Manila')::date >= p_from)
      and (p_to   is null or (s.created_at at time zone 'Asia/Manila')::date <= p_to)
  )
  select e.day, sum(e.is_lead)::bigint, sum(e.is_proj)::bigint, sum(e.is_sub)::bigint
  from events e
  group by e.day
  order by e.day;
end;
$$;

-- ---- Lead -> project stage (monotonic, projects forward ladder) --------
create or replace function public.analytics_lead_to_project(
  p_from         date default null,
  p_to           date default null,
  p_source       text default null,
  p_campaign     uuid default null,
  p_workspace_id uuid default null
)
returns table (
  stage_id         uuid,
  name             text,
  kind             text,
  "position"       int,
  rank             int,
  projects_reached bigint
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
    select p.id, p.stage_id
    from public.projects p
    where p.user_id = auth.uid()
      and (p_workspace_id is null or p.workspace_id = p_workspace_id)
      and (p_from is null or (p.created_at at time zone 'Asia/Manila')::date >= p_from)
      and (p_to   is null or (p.created_at at time zone 'Asia/Manila')::date <= p_to)
      and ((p_source is null and p_campaign is null) or p.lead_id in (select id from cohort))
  ),
  forward as (
    select s.id, s.name, s.kind, s.position,
           (row_number() over (order by s.position) - 1)::int as rank
    from public.project_stages s
    where s.user_id = auth.uid()
      and (p_workspace_id is null or s.workspace_id = p_workspace_id)
      and (s.kind is distinct from 'lost')
  ),
  touched as (
    select pr.id as project_id, f.rank
    from proj pr
    join forward f on f.id = pr.stage_id
    union
    select e.project_id, f.rank
    from public.project_stage_events e
    join proj pr on pr.id = e.project_id
    join forward f on f.id = e.to_stage_id
    where e.user_id = auth.uid()
  ),
  maxrank as (
    select t.project_id, max(t.rank) as max_rank
    from touched t
    group by t.project_id
  )
  select f.id, f.name, f.kind, f.position, f.rank,
         (select count(*) from maxrank m where m.max_rank >= f.rank)::bigint
  from forward f
  order by f.rank;
end;
$$;

-- ---- Submission -> project stage (monotonic) ---------------------------
create or replace function public.analytics_submission_to_project(
  p_from         date default null,
  p_to           date default null,
  p_workspace_id uuid default null
)
returns table (
  stage_id            uuid,
  name                text,
  kind                text,
  "position"          int,
  rank                int,
  submissions_reached bigint
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
  with subs as (
    select s.id
    from public.action_page_submissions s
    where s.user_id = auth.uid()
      and (p_from is null or (s.created_at at time zone 'Asia/Manila')::date >= p_from)
      and (p_to   is null or (s.created_at at time zone 'Asia/Manila')::date <= p_to)
  ),
  sub_proj as (
    select s.id as submission_id, p.id as project_id, p.stage_id
    from subs s
    join public.projects p on p.origin_submission_id = s.id and p.user_id = auth.uid()
    where (p_workspace_id is null or p.workspace_id = p_workspace_id)
  ),
  forward as (
    select ps.id, ps.name, ps.kind, ps.position,
           (row_number() over (order by ps.position) - 1)::int as rank
    from public.project_stages ps
    where ps.user_id = auth.uid()
      and (p_workspace_id is null or ps.workspace_id = p_workspace_id)
      and (ps.kind is distinct from 'lost')
  ),
  touched as (
    select sp.submission_id, f.rank
    from sub_proj sp
    join forward f on f.id = sp.stage_id
    union
    select sp.submission_id, f.rank
    from sub_proj sp
    join public.project_stage_events e on e.project_id = sp.project_id and e.user_id = auth.uid()
    join forward f on f.id = e.to_stage_id
  ),
  maxrank as (
    select t.submission_id, max(t.rank) as max_rank
    from touched t
    group by t.submission_id
  )
  select f.id, f.name, f.kind, f.position, f.rank,
         (select count(*) from maxrank m where m.max_rank >= f.rank)::bigint
  from forward f
  order by f.rank;
end;
$$;

-- ---- Lead stage x project stage cross-tab ------------------------------
create or replace function public.analytics_lead_project_crosstab(
  p_from         date default null,
  p_to           date default null,
  p_source       text default null,
  p_campaign     uuid default null,
  p_workspace_id uuid default null
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
      and (p_workspace_id is null or p.workspace_id = p_workspace_id)
      and p.lead_id in (select id from cohort)
      and (p_from is null or (p.created_at at time zone 'Asia/Manila')::date >= p_from)
      and (p_to   is null or (p.created_at at time zone 'Asia/Manila')::date <= p_to)
  ),
  proj_forward as (
    select s.id, s.name, s.kind, s.position,
           (row_number() over (order by s.position) - 1)::int as rank
    from public.project_stages s
    where s.user_id = auth.uid()
      and (p_workspace_id is null or s.workspace_id = p_workspace_id)
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
create or replace function public.analytics_lead_project_leads(
  p_from         date default null,
  p_to           date default null,
  p_source       text default null,
  p_campaign     uuid default null,
  p_workspace_id uuid default null,
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
      and (p_workspace_id is null or p.workspace_id = p_workspace_id)
      and p.lead_id in (select id from cohort)
      and (p_from is null or (p.created_at at time zone 'Asia/Manila')::date >= p_from)
      and (p_to   is null or (p.created_at at time zone 'Asia/Manila')::date <= p_to)
  ),
  proj_forward as (
    select s.id, s.name, s.position,
           (row_number() over (order by s.position) - 1)::int as rank
    from public.project_stages s
    where s.user_id = auth.uid()
      and (p_workspace_id is null or s.workspace_id = p_workspace_id)
      and (s.kind is distinct from 'lost')
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
create or replace function public.analytics_project_stage_value(
  p_from         date default null,
  p_to           date default null,
  p_source       text default null,
  p_campaign     uuid default null,
  p_workspace_id uuid default null
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
      and (p_workspace_id is null or p.workspace_id = p_workspace_id)
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
    and (p_workspace_id is null or s.workspace_id = p_workspace_id)
  order by s.position;
end;
$$;

-- ---- Grants ------------------------------------------------------------
revoke all on function public.analytics_overview(date, date, text, uuid, uuid)              from public, anon;
revoke all on function public.analytics_timeseries(date, date, text, uuid, uuid)            from public, anon;
revoke all on function public.analytics_lead_to_project(date, date, text, uuid, uuid)       from public, anon;
revoke all on function public.analytics_submission_to_project(date, date, uuid)             from public, anon;
revoke all on function public.analytics_lead_project_crosstab(date, date, text, uuid, uuid) from public, anon;
revoke all on function public.analytics_lead_project_leads(date, date, text, uuid, uuid, int, int, int) from public, anon;
revoke all on function public.analytics_project_stage_value(date, date, text, uuid, uuid)   from public, anon;
grant execute on function public.analytics_overview(date, date, text, uuid, uuid)              to authenticated;
grant execute on function public.analytics_timeseries(date, date, text, uuid, uuid)            to authenticated;
grant execute on function public.analytics_lead_to_project(date, date, text, uuid, uuid)       to authenticated;
grant execute on function public.analytics_submission_to_project(date, date, uuid)             to authenticated;
grant execute on function public.analytics_lead_project_crosstab(date, date, text, uuid, uuid) to authenticated;
grant execute on function public.analytics_lead_project_leads(date, date, text, uuid, uuid, int, int, int) to authenticated;
grant execute on function public.analytics_project_stage_value(date, date, text, uuid, uuid)   to authenticated;
