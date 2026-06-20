-- =========================================================================
-- Leads & revenue analytics — per-tenant RPCs.
--
-- Powers the /dashboard/analytics page. Mirrors the admin analytics RPCs
-- (migration 20260611000500) in shape, but these are PER-TENANT: every
-- function is SECURITY INVOKER and self-scopes to `auth.uid()`, so RLS on the
-- underlying tables is a second line of defence. Date bounds are Asia/Manila
-- calendar days (matching the rest of the app); NULL bounds mean "unbounded"
-- (the `all` range preset). p_source / p_campaign optionally narrow the LEAD
-- cohort (and the projects derived from it) — submissions are top-of-funnel and
-- are not campaign-attributed, so they stay date-scoped only.
--
-- Conversion semantics ("reached a stage") are MONOTONIC and position-based:
-- a lead/project is counted at every forward stage up to and including the
-- furthest one it ever touched (current stage OR any *_stage_events row). This
-- is robust to the fact that manual kanban moves (moveLead/bulkMoveLeads) update
-- stage_id WITHOUT writing an event — the current stage is always included, so
-- the furthest-reached rung is correct even when intermediate events are absent.
-- Side-stages (lost / objection / dormant) are EXCLUDED from the forward ladder
-- and surfaced separately (e.g. lost_projects), so they never distort the funnel.
-- =========================================================================

-- ---- Indexes for tenant-wide event aggregation -------------------------
-- The event tables were indexed only by (lead_id|project_id, created_at) for a
-- single entity's timeline. Analytics joins events for the whole tenant, so add
-- user-scoped indexes for the cohort joins below.
create index if not exists lead_stage_events_user_lead_idx
  on public.lead_stage_events (user_id, lead_id);
create index if not exists lead_stage_events_user_to_stage_idx
  on public.lead_stage_events (user_id, to_stage_id);
create index if not exists project_stage_events_user_project_idx
  on public.project_stage_events (user_id, project_id);
create index if not exists project_stage_events_user_to_stage_idx
  on public.project_stage_events (user_id, to_stage_id);

-- ---- Scalar KPIs (one row) ---------------------------------------------
create or replace function public.analytics_overview(
  p_from     date default null,
  p_to       date default null,
  p_source   text default null,
  p_campaign uuid default null
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
        where p.user_id = auth.uid() and p.origin_submission_id = s.id))::bigint,
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
  p_from     date default null,
  p_to       date default null,
  p_source   text default null,
  p_campaign uuid default null
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

-- ---- Lead stage journey (monotonic forward funnel) ---------------------
-- Cohort = leads CREATED in range (+ optional source/campaign). For each forward
-- pipeline stage (kind entry|qualifying|nurture|decision|won), counts distinct
-- leads whose furthest forward rung (current stage OR any to_stage event) is at
-- or beyond it — a monotonically non-increasing funnel by design.
create or replace function public.analytics_lead_funnel(
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
  rank          int,
  leads_reached bigint
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
  forward as (
    select s.id, s.name, s.kind, s.position,
           (row_number() over (order by s.position) - 1)::int as rank
    from public.pipeline_stages s
    where s.user_id = auth.uid()
      and s.kind in ('entry', 'qualifying', 'nurture', 'decision', 'won')
  ),
  touched as (
    select c.id as lead_id, f.rank
    from cohort c
    join forward f on f.id = c.stage_id
    union
    select e.lead_id, f.rank
    from public.lead_stage_events e
    join cohort c on c.id = e.lead_id
    join forward f on f.id = e.to_stage_id
    where e.user_id = auth.uid()
  ),
  maxrank as (
    select t.lead_id, max(t.rank) as max_rank
    from touched t
    group by t.lead_id
  )
  select f.id, f.name, f.kind, f.position, f.rank,
         (select count(*) from maxrank m where m.max_rank >= f.rank)::bigint
  from forward f
  order by f.rank;
end;
$$;

-- ---- Lead -> project stage (monotonic, projects forward ladder) --------
-- For each forward project stage (kind null|open|won, ordered by position; lost
-- excluded as an off-ramp), counts distinct projects (whose lead is in the
-- cohort when a source/campaign filter is active) that reached it. Pair with
-- analytics_overview.total_leads for the "leads per project" ratio.
create or replace function public.analytics_lead_to_project(
  p_from     date default null,
  p_to       date default null,
  p_source   text default null,
  p_campaign uuid default null
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
      and (p_from is null or (p.created_at at time zone 'Asia/Manila')::date >= p_from)
      and (p_to   is null or (p.created_at at time zone 'Asia/Manila')::date <= p_to)
      and ((p_source is null and p_campaign is null) or p.lead_id in (select id from cohort))
  ),
  forward as (
    select s.id, s.name, s.kind, s.position,
           (row_number() over (order by s.position) - 1)::int as rank
    from public.project_stages s
    where s.user_id = auth.uid()
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
-- For each forward project stage, counts distinct submissions (created in range)
-- whose originated project (projects.origin_submission_id) reached it. Coverage
-- (submissions that spawned any project) is in analytics_overview.
create or replace function public.analytics_submission_to_project(
  p_from date default null,
  p_to   date default null
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
  ),
  forward as (
    select ps.id, ps.name, ps.kind, ps.position,
           (row_number() over (order by ps.position) - 1)::int as rank
    from public.project_stages ps
    where ps.user_id = auth.uid()
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

-- ---- Grants ------------------------------------------------------------
-- Callable by any signed-in user; each function self-scopes to auth.uid() and
-- RLS on the underlying tables backs that up. Not reachable by anon.
revoke all on function public.analytics_overview(date, date, text, uuid)            from public, anon;
revoke all on function public.analytics_timeseries(date, date, text, uuid)          from public, anon;
revoke all on function public.analytics_lead_funnel(date, date, text, uuid)         from public, anon;
revoke all on function public.analytics_lead_to_project(date, date, text, uuid)     from public, anon;
revoke all on function public.analytics_submission_to_project(date, date)           from public, anon;
grant execute on function public.analytics_overview(date, date, text, uuid)            to authenticated;
grant execute on function public.analytics_timeseries(date, date, text, uuid)          to authenticated;
grant execute on function public.analytics_lead_funnel(date, date, text, uuid)         to authenticated;
grant execute on function public.analytics_lead_to_project(date, date, text, uuid)     to authenticated;
grant execute on function public.analytics_submission_to_project(date, date)           to authenticated;
