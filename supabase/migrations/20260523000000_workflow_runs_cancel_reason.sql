alter table public.workflow_runs
  add column if not exists cancel_reason text;
