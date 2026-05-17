-- =========================================================================
-- Lead Silent Auto Follow-Up: per-thread schedule of timed nudges fired after
-- a lead goes silent. Cancelled on any new lead inbound; reseeded if gates
-- still pass. Touchpoints at 5m, 1h, 5h, 8h, 12h, 18h, 24h after last inbound.
-- =========================================================================

-- 1. Extend messenger_jobs.kind enum check to include followup_send.
alter table public.messenger_jobs
  drop constraint if exists messenger_jobs_kind_check;

alter table public.messenger_jobs
  add constraint messenger_jobs_kind_check
  check (kind in ('inbound_reply', 'agent_campaign_send', 'reminder_fire', 'followup_send'));

-- 2. lead_followup_schedules — one active row per thread at a time.
create table public.lead_followup_schedules (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id)              on delete cascade,
  lead_id      uuid not null references public.leads(id)            on delete cascade,
  thread_id    uuid not null references public.messenger_threads(id) on delete cascade,
  page_id      uuid not null references public.facebook_pages(id)   on delete cascade,

  started_at   timestamptz not null,
  next_offset_idx smallint not null default 0
    check (next_offset_idx between 0 and 6),
  next_run_at  timestamptz not null,

  status text not null default 'pending'
    check (status in ('pending','running','done','cancelled','failed')),

  conversation_kind text not null
    check (conversation_kind in ('generic','real')),

  lead_inbound_count_at_seed smallint not null default 0,
  job_id     uuid references public.messenger_jobs(id) on delete set null,
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One active schedule per thread.
create unique index uniq_active_followup_per_thread
  on public.lead_followup_schedules (thread_id)
  where status in ('pending','running');

-- Worker claim path.
create index idx_followup_due
  on public.lead_followup_schedules (next_run_at)
  where status = 'pending';

-- Lookup by user (for dashboards / debugging).
create index idx_followup_user
  on public.lead_followup_schedules (user_id, status, next_run_at desc);

alter table public.lead_followup_schedules enable row level security;

create policy "lead_followup_schedules_owner_rw" on public.lead_followup_schedules
  for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- updated_at trigger
create or replace function public.touch_lead_followup_schedules_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger lead_followup_schedules_touch_updated_at
  before update on public.lead_followup_schedules
  for each row execute function public.touch_lead_followup_schedules_updated_at();

-- 3. Schedule the followups-tick cron (every minute).
do $$
declare
  job_id bigint;
begin
  for job_id in
    select jobid from cron.job where jobname = 'whatstage-followups-tick'
  loop
    perform cron.unschedule(job_id);
  end loop;
end $$;

select cron.schedule(
  'whatstage-followups-tick',
  '* * * * *',
  $$select app_private.invoke_cron_route('/api/cron/followups-tick', 10000);$$
);
