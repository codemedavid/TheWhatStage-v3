-- =========================================================================
-- Lead follow-up sequences: a sequence attached directly to a LEAD (independent
-- of any project stage). The user defines an ordered list of touchpoints
-- (delay + AI instruction) on the lead, then enrolls the lead to start it. A
-- cron-driven worker fires each step by drafting via the existing follow-up
-- agent (the lead's active-project AI instructions, if any, + the step
-- instruction) and sending through the existing Messenger outbound + policy
-- path. One active run per lead; re-enrolling cancels any prior active run.
--
-- Mirrors the project-sequence tables (20260618000100_project_sequences.sql)
-- but anchored to lead_id instead of a project stage. Sends reuse
-- src/lib/sequences/shared.ts, shared with the project sequence worker.
-- =========================================================================

-- 1. Allow messenger_jobs to carry lead-sequence sends (extends the kind check
--    that the project-sequence migration last set).
alter table public.messenger_jobs
  drop constraint if exists messenger_jobs_kind_check;

alter table public.messenger_jobs
  add constraint messenger_jobs_kind_check
  check (kind in (
    'inbound_reply', 'agent_campaign_send', 'reminder_fire',
    'followup_send', 'project_sequence_send', 'lead_sequence_send'
  ));

-- 2. lead_sequences — one optional sequence config per lead.
create table public.lead_sequences (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  lead_id    uuid not null references public.leads(id) on delete cascade,
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id)
);

create index lead_sequences_user_idx
  on public.lead_sequences (user_id);

-- 3. lead_sequence_steps — ordered touchpoints. delay_minutes is the offset
--    from the enrollment anchor (cumulative from sequence start), not from the
--    previous step.
create table public.lead_sequence_steps (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  sequence_id   uuid not null references public.lead_sequences(id) on delete cascade,
  position      smallint not null check (position between 0 and 19),
  delay_minutes integer not null check (delay_minutes between 0 and 525600),
  instruction   text not null check (char_length(instruction) between 1 and 2000),
  channel       text not null default 'messenger' check (channel in ('messenger')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (sequence_id, position)
);

create index lead_sequence_steps_sequence_idx
  on public.lead_sequence_steps (sequence_id, position);

-- 4. lead_sequence_runs — runtime state. Mirrors project_sequence_runs.
--    thread_id is nullable: a lead may have no Messenger thread (e.g. a web
--    form with no PSID); the worker fails such runs gracefully.
create table public.lead_sequence_runs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id)             on delete cascade,
  sequence_id   uuid not null references public.lead_sequences(id)  on delete cascade,
  lead_id       uuid not null references public.leads(id)           on delete cascade,
  thread_id     uuid references public.messenger_threads(id)        on delete set null,

  started_at    timestamptz not null,
  next_step_idx smallint not null default 0 check (next_step_idx between 0 and 20),
  next_run_at   timestamptz not null,

  status text not null default 'pending'
    check (status in ('pending','running','done','cancelled','failed')),

  job_id     uuid references public.messenger_jobs(id) on delete set null,
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One active run per lead.
create unique index uniq_active_lead_sequence_per_lead
  on public.lead_sequence_runs (lead_id)
  where status in ('pending','running');

-- Worker claim path.
create index idx_lead_sequence_due
  on public.lead_sequence_runs (next_run_at)
  where status = 'pending';

-- Dashboard / debugging lookups.
create index idx_lead_sequence_user
  on public.lead_sequence_runs (user_id, status, next_run_at desc);

-- 5. updated_at triggers (reuse the global public.set_updated_at).
create trigger lead_sequences_set_updated_at
  before update on public.lead_sequences
  for each row execute function public.set_updated_at();

create trigger lead_sequence_steps_set_updated_at
  before update on public.lead_sequence_steps
  for each row execute function public.set_updated_at();

create trigger lead_sequence_runs_set_updated_at
  before update on public.lead_sequence_runs
  for each row execute function public.set_updated_at();

-- 6. RLS — per-user owner isolation. The firing worker uses the service-role
--    admin client (bypasses RLS), matching project_sequence_runs.
alter table public.lead_sequences      enable row level security;
alter table public.lead_sequence_steps enable row level security;
alter table public.lead_sequence_runs  enable row level security;

create policy lead_sequences_owner_all on public.lead_sequences
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy lead_sequence_steps_owner_all on public.lead_sequence_steps
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy lead_sequence_runs_owner_all on public.lead_sequence_runs
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 7. Cron: lead-sequences tick (every minute), mirroring the project tick.
do $$
declare
  job_id bigint;
begin
  for job_id in
    select jobid from cron.job where jobname = 'whatstage-lead-sequences-tick'
  loop
    perform cron.unschedule(job_id);
  end loop;
end $$;

select cron.schedule(
  'whatstage-lead-sequences-tick',
  '* * * * *',
  $$select app_private.invoke_cron_route('/api/cron/lead-sequences', 10000);$$
);
