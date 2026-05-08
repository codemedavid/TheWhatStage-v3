-- =========================================================================
-- Lead Reminders: bot-detected follow-up requests from customers
-- ("chat me back on May 12", "message me at 12pm")
-- =========================================================================

-- 1. Add reminder_fire to messenger_jobs.kind check.
alter table public.messenger_jobs
  drop constraint if exists messenger_jobs_kind_check;

alter table public.messenger_jobs
  add constraint messenger_jobs_kind_check
  check (kind in ('inbound_reply', 'agent_campaign_send', 'reminder_fire'));

-- 2. lead_reminders — one row per detected follow-up request.
create table public.lead_reminders (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id)            on delete cascade,
  lead_id      uuid not null references public.leads(id)          on delete cascade,
  thread_id    uuid          references public.messenger_threads(id) on delete set null,

  scheduled_at timestamptz not null,
  topic        text not null check (char_length(topic) between 1 and 500),

  status text not null default 'pending'
    check (status in ('pending','sent','resolved','cancelled','snoozed','failed')),

  auto_send    boolean not null default false,
  source_message_id uuid references public.messenger_messages(id) on delete set null,

  -- populated when the worker enqueues a job for this reminder, so we don't
  -- enqueue twice for the same reminder firing.
  job_id       uuid references public.messenger_jobs(id) on delete set null,

  resolved_at     timestamptz,
  resolved_reason text check (resolved_reason in ('topic_addressed','manual','auto_replied')),

  fired_at     timestamptz,
  cancelled_at timestamptz,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index lead_reminders_due_idx
  on public.lead_reminders (user_id, scheduled_at)
  where status = 'pending';

create index lead_reminders_lead_pending_idx
  on public.lead_reminders (lead_id)
  where status = 'pending';

create index lead_reminders_user_status_idx
  on public.lead_reminders (user_id, status, scheduled_at desc);

alter table public.lead_reminders enable row level security;

create policy "lead_reminders_owner_rw" on public.lead_reminders
  for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- updated_at trigger
create or replace function public.touch_lead_reminders_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger lead_reminders_touch_updated_at
  before update on public.lead_reminders
  for each row execute function public.touch_lead_reminders_updated_at();

-- Schedule the reminders-tick cron (every minute).
do $$
declare
  job_id bigint;
begin
  for job_id in
    select jobid from cron.job where jobname = 'whatstage-reminders-tick'
  loop
    perform cron.unschedule(job_id);
  end loop;
end $$;

select cron.schedule(
  'whatstage-reminders-tick',
  '* * * * *',
  $$select app_private.invoke_cron_route('/api/cron/reminders-tick', 10000);$$
);
