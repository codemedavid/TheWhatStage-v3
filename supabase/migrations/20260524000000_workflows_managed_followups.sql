-- ---------------------------------------------------------------------------
-- Auto-managed workflows: lets a feature (e.g. booking-page editor) own a
-- workflow row and regenerate it from feature config. `manually_edited` flips
-- to true when a user saves edits via the workflow editor; the feature UI
-- then refuses to overwrite without explicit "Reset & take over".
-- ---------------------------------------------------------------------------

alter table public.workflows
  add column if not exists managed_kind text,
  add column if not exists managed_source_id uuid,
  add column if not exists manually_edited boolean not null default false;

alter table public.workflows
  drop constraint if exists workflows_managed_kind_check;

alter table public.workflows
  add constraint workflows_managed_kind_check
  check (managed_kind is null or managed_kind in ('booking_followups'));

drop index if exists workflows_managed_unique;
create unique index workflows_managed_unique
  on public.workflows (managed_kind, managed_source_id)
  where managed_kind is not null;
