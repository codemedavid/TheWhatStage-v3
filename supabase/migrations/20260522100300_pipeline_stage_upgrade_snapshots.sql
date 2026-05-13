create table public.pipeline_stage_upgrade_snapshots (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  snapshot   jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.pipeline_stage_upgrade_snapshots enable row level security;
-- All writes (insert/upsert/delete) go through the admin client (service role bypasses RLS).
-- Authenticated users only need read access via the policy below.

create policy upgrade_snapshots_owner_select
  on public.pipeline_stage_upgrade_snapshots
  for select to authenticated using (user_id = auth.uid());
