-- =========================================================================
-- Per-step enable/disable for project follow-up sequences.
--
-- Operators want to turn a single touch OFF without deleting it (keep the
-- instruction/manual/fallback text to re-enable later). A disabled step is
-- still PERSISTED — it keeps its position row — but every CONSUMER of the
-- sequence (the firing worker, stage seeding, and the no-send preview) filters
-- to enabled steps and RE-INDEXES positions to a contiguous 0..M-1 range so the
-- run's `next_step_idx` ↔ batch-draft `position` invariant holds. Editing a
-- stage's steps mid-run invalidates each in-flight run's cached drafts
-- (clearStageRunDrafts) so it re-batches against the new layout on the next tick.
--
-- Additive + backfilled with a default so existing rows (and in-flight runs)
-- behave exactly as before: every current step is enabled.
-- =========================================================================

alter table public.project_stage_sequence_steps
  add column if not exists enabled boolean not null default true;

comment on column public.project_stage_sequence_steps.enabled is
  'When false, the step is kept in the editor but skipped by the firing worker, '
  'stage seeding, and the test preview. Disabled steps still occupy a position '
  'row; consumers filter to enabled and re-index positions before firing.';
