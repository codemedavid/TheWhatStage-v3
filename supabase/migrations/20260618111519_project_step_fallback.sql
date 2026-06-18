-- Per-step fallback message for project follow-up sequences.
--
-- The step worker drafts each touch with the small follow-up model
-- (src/lib/sequences/shared.ts). That model occasionally returns an empty
-- completion (notably for non-English / Tagalog instructions); previously the
-- whole run was terminally failed with 'empty message' and the touch was
-- silently dropped. This column lets the operator author a safe fallback line
-- per step that is sent verbatim when the draft is empty or errors, so a
-- follow-up touch is never lost. Nullable: when blank, the engine uses a
-- generic built-in default instead.
alter table public.project_stage_sequence_steps
  add column if not exists fallback_message text
  check (fallback_message is null or char_length(fallback_message) <= 2000);
