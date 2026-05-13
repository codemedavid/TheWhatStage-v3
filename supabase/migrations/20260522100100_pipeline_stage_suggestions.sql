create table public.pipeline_stage_suggestions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  stage_id        uuid not null references public.pipeline_stages(id) on delete cascade,
  field           text not null check (field in ('description','entry_signals','exit_signals','required_fields')),
  current_value   jsonb not null,
  proposed_value  jsonb not null,
  reason          text,
  source_refs     jsonb not null default '[]'::jsonb,
  status          text not null default 'pending'
                    check (status in ('pending','accepted','rejected','superseded','stale')),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references auth.users(id)
);

create index pipeline_stage_suggestions_user_pending_idx
  on public.pipeline_stage_suggestions (user_id)
  where status = 'pending';

create index pipeline_stage_suggestions_stage_field_idx
  on public.pipeline_stage_suggestions (stage_id, field)
  where status = 'pending';

create unique index pipeline_stage_suggestions_pending_unique_idx
  on public.pipeline_stage_suggestions (user_id, stage_id, field)
  where status = 'pending';

alter table public.pipeline_stage_suggestions enable row level security;
-- All writes go through the admin client (service role bypasses RLS).
-- The owner_update policy only covers status changes via accept/reject server actions.

create policy pipeline_stage_suggestions_owner_select
  on public.pipeline_stage_suggestions
  for select to authenticated using (user_id = auth.uid());

create policy pipeline_stage_suggestions_owner_update
  on public.pipeline_stage_suggestions
  for update to authenticated using (user_id = auth.uid());

create table public.stage_suggestion_jobs (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  run_at            timestamptz not null,
  last_completed_at timestamptz,
  status            text not null default 'queued'
                      check (status in ('queued','running','idle'))
);

create index stage_suggestion_jobs_due_idx
  on public.stage_suggestion_jobs (run_at)
  where status = 'queued';
