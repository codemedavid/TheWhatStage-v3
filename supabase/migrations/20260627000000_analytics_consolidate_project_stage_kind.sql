-- =========================================================================
-- Consolidate the analytics project-stage axis by KIND (single source of truth).
--
-- Each project/workspace defines its OWN project_stages, so a tenant's
-- project_stages table holds many rows named "Won", "Proposal", "Negotiation",
-- etc. The analytics suite (20260621000000 / 20260626130000) ranked every one of
-- those rows individually via `row_number() over (order by position)`, so the
-- "Lead → Project" explorer and the project funnels showed one rung PER PROJECT
-- STAGE — e.g. six separate "Won" entries — instead of one consolidated metric.
--
-- This migration collapses the project-stage axis to the curated `kind`
-- (open / won / lost) so "Won" is a SINGLE aggregate across all projects of the
-- (optionally workspace-scoped) tenant. The forward ladder keeps two rungs —
-- Open (0) and Won (1), lost excluded as before; the value breakdown keeps all
-- three kinds. Lead-side stays per pipeline stage (leads have no such fan-out).
--
-- Same MONOTONIC "reached a rung = touched any stage of that kind or beyond"
-- semantics, SECURITY INVOKER, auth.uid() self-scoping. The three funnel/value
-- functions change their `stage_id` return column from uuid to text (the kind),
-- so they are DROPped and recreated; the two cross-tab functions keep their
-- signatures and use create-or-replace.
-- =========================================================================

-- ---- Single source of truth: project stage kind -> forward rank / label ----
-- open / null -> 0 (Open), won -> 1 (Won), lost -> 2 (Lost, excluded from
-- forward ladders). Immutable so the planner can fold it into scans.
create or replace function public.analytics_project_kind_rank(p_kind text)
returns int
language sql
immutable
as $$
  select case
    when p_kind = 'won'  then 1
    when p_kind = 'lost' then 2
    else 0
  end;
$$;

create or replace function public.analytics_project_kind_label(p_kind text)
returns text
language sql
immutable
as $$
  select case
    when p_kind = 'won'  then 'Won'
    when p_kind = 'lost' then 'Lost'
    else 'Open'
  end;
$$;

-- Canonical lowercase kind for the forward ladder (lost already excluded).
-- Kept inline in each function as `case when kind='won' then 'won' else 'open' end`.

-- =========================================================================
-- 1) Lead -> project stage funnel (monotonic), project axis grouped by kind.
-- =========================================================================
drop function if exists public.analytics_lead_to_project(date, date, text, uuid, uuid);
create function public.analytics_lead_to_project(
  p_from         date default null,
  p_to           date default null,
  p_source       text default null,
  p_campaign     uuid default null,
  p_workspace_id uuid default null
)
returns table (
  stage_id         text,
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
  -- stage_id -> forward kind rank (lost excluded)
  stage_rank as (
    select s.id, public.analytics_project_kind_rank(s.kind) as rank
    from public.project_stages s
    where s.user_id = auth.uid()
      and (p_workspace_id is null or s.workspace_id = p_workspace_id)
      and (s.kind is distinct from 'lost')
  ),
  -- one rung per distinct kind present (Open, Won)
  forward as (
    select distinct
      public.analytics_project_kind_rank(s.kind)  as rank,
      public.analytics_project_kind_label(s.kind) as name,
      case when s.kind = 'won' then 'won' else 'open' end as kind
    from public.project_stages s
    where s.user_id = auth.uid()
      and (p_workspace_id is null or s.workspace_id = p_workspace_id)
      and (s.kind is distinct from 'lost')
  ),
  touched as (
    select pr.id as project_id, sr.rank
    from proj pr
    join stage_rank sr on sr.id = pr.stage_id
    union
    select e.project_id, sr.rank
    from public.project_stage_events e
    join proj pr on pr.id = e.project_id
    join stage_rank sr on sr.id = e.to_stage_id
    where e.user_id = auth.uid()
  ),
  maxrank as (
    select t.project_id, max(t.rank) as max_rank
    from touched t
    group by t.project_id
  )
  select f.kind, f.name, f.kind, f.rank, f.rank,
         (select count(*) from maxrank m where m.max_rank >= f.rank)::bigint
  from forward f
  order by f.rank;
end;
$$;

-- =========================================================================
-- 2) Submission -> project stage funnel (monotonic), project axis by kind.
-- =========================================================================
drop function if exists public.analytics_submission_to_project(date, date, uuid);
create function public.analytics_submission_to_project(
  p_from         date default null,
  p_to           date default null,
  p_workspace_id uuid default null
)
returns table (
  stage_id            text,
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
  stage_rank as (
    select ps.id, public.analytics_project_kind_rank(ps.kind) as rank
    from public.project_stages ps
    where ps.user_id = auth.uid()
      and (p_workspace_id is null or ps.workspace_id = p_workspace_id)
      and (ps.kind is distinct from 'lost')
  ),
  forward as (
    select distinct
      public.analytics_project_kind_rank(ps.kind)  as rank,
      public.analytics_project_kind_label(ps.kind) as name,
      case when ps.kind = 'won' then 'won' else 'open' end as kind
    from public.project_stages ps
    where ps.user_id = auth.uid()
      and (p_workspace_id is null or ps.workspace_id = p_workspace_id)
      and (ps.kind is distinct from 'lost')
  ),
  touched as (
    select sp.submission_id, sr.rank
    from sub_proj sp
    join stage_rank sr on sr.id = sp.stage_id
    union
    select sp.submission_id, sr.rank
    from sub_proj sp
    join public.project_stage_events e on e.project_id = sp.project_id and e.user_id = auth.uid()
    join stage_rank sr on sr.id = e.to_stage_id
  ),
  maxrank as (
    select t.submission_id, max(t.rank) as max_rank
    from touched t
    group by t.submission_id
  )
  select f.kind, f.name, f.kind, f.rank, f.rank,
         (select count(*) from maxrank m where m.max_rank >= f.rank)::bigint
  from forward f
  order by f.rank;
end;
$$;

-- =========================================================================
-- 3) Lead-stage x project-stage cross-tab — project axis grouped by kind.
--    Signature unchanged (project_stage_id stays uuid, now always NULL since a
--    rung spans many stages). Lead axis stays per pipeline stage.
-- =========================================================================
create or replace function public.analytics_lead_project_crosstab(
  p_from         date default null,
  p_to           date default null,
  p_source       text default null,
  p_campaign     uuid default null,
  p_workspace_id uuid default null
)
returns table (
  lead_stage_id      uuid,
  lead_stage_name    text,
  lead_kind          text,
  lead_rank          int,
  lead_stage_total   bigint,
  project_stage_id   uuid,
  project_stage_name text,
  project_kind       text,
  project_rank       int,
  leads              bigint
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
  -- project axis: one rung per distinct kind (Open, Won); lost excluded
  proj_forward as (
    select distinct
      public.analytics_project_kind_rank(s.kind)  as rank,
      public.analytics_project_kind_label(s.kind) as name,
      case when s.kind = 'won' then 'won' else 'open' end as kind
    from public.project_stages s
    where s.user_id = auth.uid()
      and (p_workspace_id is null or s.workspace_id = p_workspace_id)
      and (s.kind is distinct from 'lost')
  ),
  proj_stage_rank as (
    select s.id, public.analytics_project_kind_rank(s.kind) as rank
    from public.project_stages s
    where s.user_id = auth.uid()
      and (p_workspace_id is null or s.workspace_id = p_workspace_id)
      and (s.kind is distinct from 'lost')
  ),
  proj_touched as (
    select pr.id as project_id, pr.lead_id, psr.rank
    from proj pr
    join proj_stage_rank psr on psr.id = pr.stage_id
    union
    select pr.id, pr.lead_id, psr.rank
    from proj pr
    join public.project_stage_events e on e.project_id = pr.id and e.user_id = auth.uid()
    join proj_stage_rank psr on psr.id = e.to_stage_id
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
    null::uuid, pf.name, pf.kind, pf.rank,
    (select count(*) from lead_agg la
       where la.lead_rank >= lf.rank and la.proj_max >= pf.rank)::bigint
  from lead_forward lf
  cross join proj_forward pf
  order by lf.rank, pf.rank;
end;
$$;

-- =========================================================================
-- 4) Drill-down leads behind a cross-tab cell — project rank by kind.
--    p_project_rank is now a kind rank (0 = Open, 1 = Won). best_project_stage
--    becomes the kind label of the furthest rung the lead's projects reached.
-- =========================================================================
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
  lead_id            uuid,
  lead_name          text,
  source             text,
  created_at         timestamptz,
  project_count      bigint,
  best_project_stage text,
  value_sum          numeric,
  currency           text
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
  stage_rank as (
    select s.id,
           public.analytics_project_kind_rank(s.kind)  as rank,
           public.analytics_project_kind_label(s.kind) as name
    from public.project_stages s
    where s.user_id = auth.uid()
      and (p_workspace_id is null or s.workspace_id = p_workspace_id)
      and (s.kind is distinct from 'lost')
  ),
  proj_touched as (
    select pr.id as project_id, pr.lead_id, sr.rank, sr.name
    from proj pr join stage_rank sr on sr.id = pr.stage_id
    union
    select pr.id, pr.lead_id, sr.rank, sr.name
    from proj pr
    join public.project_stage_events e on e.project_id = pr.id and e.user_id = auth.uid()
    join stage_rank sr on sr.id = e.to_stage_id
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

-- =========================================================================
-- 5) Value contribution per project stage — grouped by kind (lost included).
-- =========================================================================
drop function if exists public.analytics_project_stage_value(date, date, text, uuid, uuid);
create function public.analytics_project_stage_value(
  p_from         date default null,
  p_to           date default null,
  p_source       text default null,
  p_campaign     uuid default null,
  p_workspace_id uuid default null
)
returns table (
  stage_id      text,
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
    select public.analytics_project_kind_rank(ps.kind) as rank,
           case when ps.kind = 'won'  then 'won'
                when ps.kind = 'lost' then 'lost'
                else 'open' end as kind_norm,
           p.value
    from public.projects p
    join public.project_stages ps on ps.id = p.stage_id
    where p.user_id = auth.uid()
      and (p_workspace_id is null or p.workspace_id = p_workspace_id)
      and (p_from is null or (p.created_at at time zone 'Asia/Manila')::date >= p_from)
      and (p_to   is null or (p.created_at at time zone 'Asia/Manila')::date <= p_to)
      and ((p_source is null and p_campaign is null) or p.lead_id in (select id from cohort))
  )
  select
    proj.kind_norm,
    public.analytics_project_kind_label(proj.kind_norm),
    proj.kind_norm,
    proj.rank,
    count(*)::bigint,
    count(proj.value)::bigint,
    coalesce(sum(proj.value), 0)::numeric,
    avg(proj.value)::numeric
  from proj
  group by proj.kind_norm, proj.rank
  order by proj.rank;
end;
$$;

-- ---- Grants ------------------------------------------------------------
revoke all on function public.analytics_project_kind_rank(text)  from public, anon;
revoke all on function public.analytics_project_kind_label(text) from public, anon;
grant execute on function public.analytics_project_kind_rank(text)  to authenticated;
grant execute on function public.analytics_project_kind_label(text) to authenticated;

revoke all on function public.analytics_lead_to_project(date, date, text, uuid, uuid)       from public, anon;
revoke all on function public.analytics_submission_to_project(date, date, uuid)             from public, anon;
revoke all on function public.analytics_lead_project_crosstab(date, date, text, uuid, uuid) from public, anon;
revoke all on function public.analytics_lead_project_leads(date, date, text, uuid, uuid, int, int, int) from public, anon;
revoke all on function public.analytics_project_stage_value(date, date, text, uuid, uuid)   from public, anon;
grant execute on function public.analytics_lead_to_project(date, date, text, uuid, uuid)       to authenticated;
grant execute on function public.analytics_submission_to_project(date, date, uuid)             to authenticated;
grant execute on function public.analytics_lead_project_crosstab(date, date, text, uuid, uuid) to authenticated;
grant execute on function public.analytics_lead_project_leads(date, date, text, uuid, uuid, int, int, int) to authenticated;
grant execute on function public.analytics_project_stage_value(date, date, text, uuid, uuid)   to authenticated;
