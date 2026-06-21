-- =========================================================================
-- Manual follow-up override per sequence step.
--
-- A stage follow-up step is an AI touch by default: the worker drafts it from
-- the step `instruction` + the project's facts. This adds an OPTIONAL
-- `manual_message`: when an operator types one, it is sent VERBATIM (no LLM) for
-- that touch; when blank/null the step falls back to the existing AI draft path.
-- Nullable with no default, so every existing step stays AI-generated — zero
-- behaviour change on deploy.
-- =========================================================================

alter table public.project_stage_sequence_steps
  add column if not exists manual_message text
    check (manual_message is null or char_length(manual_message) <= 2000);
