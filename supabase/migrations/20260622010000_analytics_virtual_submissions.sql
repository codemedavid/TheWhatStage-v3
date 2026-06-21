-- =========================================================================
-- Analytics: segment chat-implied ("virtual") submissions.
--
-- Virtual submissions (meta->>'virtual' = 'true', written by the chatbot when
-- it detects proceed-intent without a form fill — see virtual-submission.ts)
-- land in action_page_submissions and therefore already flow into the headline
-- analytics counts. The product decision is to SEGMENT them, not blend them:
-- the dashboard reports real form submissions in the headline and surfaces
-- chat-implied ones as a distinct "Chat-implied" metric.
--
-- This migration adds a `virtual_submissions` column to analytics_overview and
-- analytics_timeseries. total_submissions is intentionally LEFT UNCHANGED (=
-- all submissions) so existing consumers are not silently altered; the dashboard
-- derives "form submissions = total - virtual". Changing a function's output
-- columns requires DROP + CREATE (CREATE OR REPLACE cannot change the signature).
-- Re-runnable: DROP ... IF EXISTS guards a history reconcile.
-- =========================================================================

drop function if exists public.analytics_overview(date, date, text, uuid);

create function public.analytics_overview(
  p_from     date default null,
  p_to       date default null,
  p_source   text default null,
  p_campaign uuid default null
)
returns table (
  total_leads              bigint,
  total_projects           bigint,
  total_submissions        bigint,
  virtual_submissions      bigint,
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
    select s.id, s.lead_id, s.action_page_id, s.meta
    from public.action_page_submissions s
    where s.user_id = auth.uid()
      and (p_from is null or (s.created_at at time zone 'Asia/Manila')::date >= p_from)
      and (p_to   is null or (s.created_at at time zone 'Asia/Manila')::date <= p_to)
  )
  select
    (select count(*) from cohort)::bigint,
    (select count(*) from proj)::bigint,
    (select count(*) from subs)::bigint,
    (select count(*) from subs where (meta->>'virtual') = 'true')::bigint,
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

drop function if exists public.analytics_timeseries(date, date, text, uuid);

create function public.analytics_timeseries(
  p_from     date default null,
  p_to       date default null,
  p_source   text default null,
  p_campaign uuid default null
)
returns table (
  day                 date,
  leads               bigint,
  projects            bigint,
  submissions         bigint,
  virtual_submissions bigint
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
    select (created_at at time zone 'Asia/Manila')::date as day, 1 as is_lead, 0 as is_proj, 0 as is_sub, 0 as is_virtual
    from cohort
    union all
    select (p.created_at at time zone 'Asia/Manila')::date, 0, 1, 0, 0
    from public.projects p
    where p.user_id = auth.uid()
      and (p_from is null or (p.created_at at time zone 'Asia/Manila')::date >= p_from)
      and (p_to   is null or (p.created_at at time zone 'Asia/Manila')::date <= p_to)
      and ((p_source is null and p_campaign is null) or p.lead_id in (select id from cohort))
    union all
    select (s.created_at at time zone 'Asia/Manila')::date, 0, 0, 1,
           case when (s.meta->>'virtual') = 'true' then 1 else 0 end
    from public.action_page_submissions s
    where s.user_id = auth.uid()
      and (p_from is null or (s.created_at at time zone 'Asia/Manila')::date >= p_from)
      and (p_to   is null or (s.created_at at time zone 'Asia/Manila')::date <= p_to)
  )
  select e.day, sum(e.is_lead)::bigint, sum(e.is_proj)::bigint, sum(e.is_sub)::bigint, sum(e.is_virtual)::bigint
  from events e
  group by e.day
  order by e.day;
end;
$$;
