-- =========================================================================
-- Workflow engine — Step 2: Core schema
--
-- Four tables that power the engine:
--   workflows          — definitions (graph + trigger config)
--   workflow_runs      — one row per active/historical run instance
--   workflow_run_steps — per-node audit log (immutable)
--   workflow_jobs      — execution queue, mirrors messenger_jobs pattern
--
-- Also adds:
--   claim_workflow_jobs()   — atomic per-run claim (like claim_messenger_jobs)
--   enqueue_due_runs()      — moves waiting runs whose timer fired into the job queue
--   Cron schedule           — 1-minute tick that calls enqueue + triggers worker
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Workflow definitions
-- -------------------------------------------------------------------------
create table if not exists public.workflows (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  name       text        not null,
  status     text        not null default 'draft'
             check (status in ('draft','active','paused','archived')),
  trigger    jsonb       not null default '{}',  -- {kind, config}
  graph      jsonb       not null default '{"nodes":[],"edges":[],"start_node_id":null}',
  version    int         not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workflows_user_status_idx
  on public.workflows (user_id, status);

alter table public.workflows enable row level security;

create policy "workflows: owner full access"
  on public.workflows for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "workflows: service_role full access"
  on public.workflows for all to service_role
  using (true) with check (true);

-- -------------------------------------------------------------------------
-- 2. Workflow run instances
-- -------------------------------------------------------------------------
create table if not exists public.workflow_runs (
  id               uuid        primary key default gen_random_uuid(),
  workflow_id      uuid        not null references public.workflows(id) on delete cascade,
  workflow_version int         not null,         -- pinned at start; edits don't affect in-flight runs
  user_id          uuid        not null references auth.users(id) on delete cascade,
  lead_id          uuid        references public.leads(id) on delete set null,
  thread_id        uuid        references public.messenger_threads(id) on delete set null,
  current_node_id  text,
  state            jsonb       not null default '{}',
  status           text        not null default 'running'
                   check (status in ('running','waiting','done','cancelled','failed')),
  next_run_at      timestamptz,                  -- when a wait node should resume
  dedup_key        text        not null,          -- prevents duplicate triggers
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create unique index if not exists workflow_runs_dedup_key_idx
  on public.workflow_runs (dedup_key);

create index if not exists workflow_runs_status_next_run_idx
  on public.workflow_runs (status, next_run_at)
  where status = 'waiting';

create index if not exists workflow_runs_thread_active_idx
  on public.workflow_runs (thread_id)
  where status in ('running','waiting');

create index if not exists workflow_runs_user_id_idx
  on public.workflow_runs (user_id);

alter table public.workflow_runs enable row level security;

create policy "workflow_runs: owner read"
  on public.workflow_runs for select
  using (user_id = auth.uid());

create policy "workflow_runs: service_role full access"
  on public.workflow_runs for all to service_role
  using (true) with check (true);

-- -------------------------------------------------------------------------
-- 3. Per-node audit log (append-only)
-- -------------------------------------------------------------------------
create table if not exists public.workflow_run_steps (
  id          bigserial   primary key,
  run_id      uuid        not null references public.workflow_runs(id) on delete cascade,
  node_id     text        not null,
  node_type   text        not null,
  entered_at  timestamptz not null default now(),
  exited_at   timestamptz,
  decision    text,        -- which edge was taken ('then', 'else', 'on_reply', ...)
  payload     jsonb,       -- node-specific result data (message_id, new_stage, etc.)
  error       text         -- set on node failure; run continues unless executor aborts
);

create index if not exists workflow_run_steps_run_entered_idx
  on public.workflow_run_steps (run_id, entered_at);

alter table public.workflow_run_steps enable row level security;

create policy "workflow_run_steps: owner read via run"
  on public.workflow_run_steps for select
  using (
    exists (
      select 1 from public.workflow_runs r
      where r.id = run_id and r.user_id = auth.uid()
    )
  );

create policy "workflow_run_steps: service_role full access"
  on public.workflow_run_steps for all to service_role
  using (true) with check (true);

-- -------------------------------------------------------------------------
-- 4. Execution job queue
-- -------------------------------------------------------------------------
create table if not exists public.workflow_jobs (
  id           uuid        primary key default gen_random_uuid(),
  run_id       uuid        not null references public.workflow_runs(id) on delete cascade,
  scheduled_at timestamptz not null default now(),
  status       text        not null default 'queued'
               check (status in ('queued','running','done','failed')),
  attempts     int         not null default 0,
  started_at   timestamptz,
  finished_at  timestamptz,
  last_error   text,
  created_at   timestamptz not null default now()
);

create index if not exists workflow_jobs_status_scheduled_idx
  on public.workflow_jobs (status, scheduled_at)
  where status = 'queued';

create index if not exists workflow_jobs_run_id_active_idx
  on public.workflow_jobs (run_id)
  where status in ('queued','running');

alter table public.workflow_jobs enable row level security;

create policy "workflow_jobs: service_role full access"
  on public.workflow_jobs for all to service_role
  using (true) with check (true);

-- -------------------------------------------------------------------------
-- 5. FK: messenger_threads.controlled_by_run_id → workflow_runs
--    Deferred until now because workflow_runs didn't exist at step 0.
-- -------------------------------------------------------------------------
alter table public.messenger_threads
  add constraint messenger_threads_controlled_by_run_id_fkey
  foreign key (controlled_by_run_id)
  references public.workflow_runs(id)
  on delete set null
  not valid;  -- validate asynchronously; existing nulls pass immediately

alter table public.messenger_threads
  validate constraint messenger_threads_controlled_by_run_id_fkey;

-- -------------------------------------------------------------------------
-- 6. Atomic job claim function (mirrors claim_messenger_jobs)
--
-- Returns at most p_limit jobs with distinct run_ids. Uses SKIP LOCKED
-- so two concurrent workers never execute the same run in parallel.
-- Resets stale running jobs (started_at older than p_stale_seconds) first
-- so a crashed worker's job becomes reclaimable.
-- -------------------------------------------------------------------------
create or replace function public.claim_workflow_jobs(
  p_limit         int default 5,
  p_stale_seconds int default 300
)
returns table (id uuid, run_id uuid, attempts int)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Reset stale running jobs.
  update public.workflow_jobs
     set status = 'queued', started_at = null
   where status = 'running'
     and started_at is not null
     and started_at <= now() - make_interval(secs => p_stale_seconds);

  return query
  with picked as (
    select j.id, j.run_id, j.attempts
      from public.workflow_jobs j
     where j.status = 'queued'
       and j.scheduled_at <= now()
       -- One running job per run is the serialization invariant.
       and not exists (
         select 1
           from public.workflow_jobs r
          where r.run_id = j.run_id and r.status = 'running'
       )
     order by j.scheduled_at, j.id
     limit greatest(p_limit, 1)
     for update skip locked
  )
  update public.workflow_jobs j
     set status     = 'running',
         started_at = now()
    from picked p
   where j.id = p.id and j.status = 'queued'
  returning j.id, j.run_id, j.attempts;
end;
$$;

revoke all on function public.claim_workflow_jobs(int, int) from public;
grant execute on function public.claim_workflow_jobs(int, int) to service_role;

-- -------------------------------------------------------------------------
-- 7. Enqueue due waiting runs
--
-- Called by the cron tick. Inserts a workflow_job for every waiting run
-- whose next_run_at has passed, skipping runs that already have a
-- queued/running job (prevents pile-up on slow worker invocations).
-- Returns the number of jobs enqueued.
-- -------------------------------------------------------------------------
create or replace function public.enqueue_due_workflow_runs()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.workflow_jobs (run_id, scheduled_at)
  select wr.id, now()
    from public.workflow_runs wr
   where wr.status = 'waiting'
     and wr.next_run_at is not null
     and wr.next_run_at <= now()
     and not exists (
       select 1
         from public.workflow_jobs j
        where j.run_id = wr.id
          and j.status in ('queued','running')
     );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.enqueue_due_workflow_runs() from public;
grant execute on function public.enqueue_due_workflow_runs() to service_role;

-- -------------------------------------------------------------------------
-- 8. Cron schedule — 1-minute tick
-- -------------------------------------------------------------------------
do $$
declare job_id bigint;
begin
  for job_id in
    select jobid from cron.job where jobname = 'whatstage-workflow-tick'
  loop
    perform cron.unschedule(job_id);
  end loop;
end $$;

select cron.schedule(
  'whatstage-workflow-tick',
  '* * * * *',
  $$select app_private.invoke_cron_route('/api/cron/workflow-tick', 10000);$$
);
