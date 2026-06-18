-- =========================================================================
-- Project follow-up sequences: each project_stage can define an ordered list
-- of touchpoints (delay + AI instruction). When a project enters such a stage,
-- a project_sequence_run is seeded; a cron-driven worker fires each step by
-- drafting via the existing follow-up agent (project ai_instructions + step
-- instruction) and sending through the existing Messenger outbound + policy
-- path. One active run per project; cancelled when the project leaves the
-- stage, reaches a won/lost stage, or the customer replies.
-- =========================================================================

-- 1. Allow messenger_jobs to carry project-sequence sends.
alter table public.messenger_jobs
  drop constraint if exists messenger_jobs_kind_check;

alter table public.messenger_jobs
  add constraint messenger_jobs_kind_check
  check (kind in (
    'inbound_reply', 'agent_campaign_send', 'reminder_fire',
    'followup_send', 'project_sequence_send'
  ));

-- 2. project_stage_sequences — one optional sequence config per stage.
create table public.project_stage_sequences (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  stage_id   uuid not null references public.project_stages(id) on delete cascade,
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stage_id)
);

create index project_stage_sequences_user_idx
  on public.project_stage_sequences (user_id);

-- 3. project_stage_sequence_steps — ordered touchpoints. delay_minutes is the
--    offset from the stage-entry anchor (cumulative from sequence start), not
--    from the previous step.
create table public.project_stage_sequence_steps (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  sequence_id   uuid not null references public.project_stage_sequences(id) on delete cascade,
  position      smallint not null check (position between 0 and 19),
  delay_minutes integer not null check (delay_minutes between 0 and 525600),
  instruction   text not null check (char_length(instruction) between 1 and 2000),
  channel       text not null default 'messenger' check (channel in ('messenger')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (sequence_id, position)
);

create index project_stage_sequence_steps_sequence_idx
  on public.project_stage_sequence_steps (sequence_id, position);

-- 4. project_sequence_runs — runtime state. Mirrors lead_followup_schedules.
--    thread_id is nullable: a project's lead may have no Messenger thread (e.g.
--    a web form with no PSID); the worker fails such runs gracefully.
create table public.project_sequence_runs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id)                      on delete cascade,
  project_id    uuid not null references public.projects(id)                 on delete cascade,
  sequence_id   uuid not null references public.project_stage_sequences(id)  on delete cascade,
  stage_id      uuid not null references public.project_stages(id)           on delete cascade,
  lead_id       uuid not null references public.leads(id)                    on delete cascade,
  thread_id     uuid references public.messenger_threads(id)                 on delete set null,

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

-- One active run per project.
create unique index uniq_active_project_sequence_per_project
  on public.project_sequence_runs (project_id)
  where status in ('pending','running');

-- Worker claim path.
create index idx_project_sequence_due
  on public.project_sequence_runs (next_run_at)
  where status = 'pending';

-- Dashboard / debugging lookups.
create index idx_project_sequence_user
  on public.project_sequence_runs (user_id, status, next_run_at desc);

-- 5. updated_at triggers (reuse the global public.set_updated_at).
create trigger project_stage_sequences_set_updated_at
  before update on public.project_stage_sequences
  for each row execute function public.set_updated_at();

create trigger project_stage_sequence_steps_set_updated_at
  before update on public.project_stage_sequence_steps
  for each row execute function public.set_updated_at();

create trigger project_sequence_runs_set_updated_at
  before update on public.project_sequence_runs
  for each row execute function public.set_updated_at();

-- 6. RLS — per-user owner isolation. The firing worker uses the service-role
--    admin client (bypasses RLS), matching lead_followup_schedules.
alter table public.project_stage_sequences      enable row level security;
alter table public.project_stage_sequence_steps enable row level security;
alter table public.project_sequence_runs        enable row level security;

create policy project_stage_sequences_owner_all on public.project_stage_sequences
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy project_stage_sequence_steps_owner_all on public.project_stage_sequence_steps
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy project_sequence_runs_owner_all on public.project_sequence_runs
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 7. Cron: project-sequences tick (every minute), mirroring the followups tick.
do $$
declare
  job_id bigint;
begin
  for job_id in
    select jobid from cron.job where jobname = 'whatstage-project-sequences-tick'
  loop
    perform cron.unschedule(job_id);
  end loop;
end $$;

select cron.schedule(
  'whatstage-project-sequences-tick',
  '* * * * *',
  $$select app_private.invoke_cron_route('/api/cron/project-sequences', 10000);$$
);
