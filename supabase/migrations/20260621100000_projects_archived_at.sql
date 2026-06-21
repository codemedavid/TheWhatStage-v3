-- Archive support for project cards. A project is "archived" (hidden from the
-- kanban board) when archived_at is non-null. Archived projects still count in
-- every aggregate — their value/headcount stays in the stage and KPI totals —
-- they are only filtered out of the board's card rendering. Soft state distinct
-- from deletion: Delete still hard-removes the row.
alter table public.projects
  add column if not exists archived_at timestamptz;

-- Partial index over the active set — the board's default query filters on
-- archived_at is null, and active projects are the common path.
create index if not exists projects_active_by_stage_idx
  on public.projects (user_id, stage_id)
  where archived_at is null;
