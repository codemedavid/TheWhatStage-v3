-- =========================================================================
-- Per-stage follow-up guidance + one-shot batch drafting.
--
-- 1. project_stage_sequences gains optional per-stage AI guidance: free-form
--    `stage_instructions` plus `do_rules`/`dont_rules` arrays. These describe
--    HOW the assistant should communicate / follow up while a card sits in the
--    stage, layered on top of the global chatbot brain and below each card's
--    own ai_instructions. Stage-wide (every card in the stage), never
--    customer-specific.
--
-- 2. project_sequence_runs gains `drafts` (jsonb): the whole sequence drafted
--    in ONE LLM call on the first touch and reused for every later touch, so we
--    spend one generation per lead instead of one per step. Shape:
--    [{ "position": 0, "text": "…" }, ...]. Null until generated; a failed
--    generation leaves it null and the worker falls back per step.
-- =========================================================================

alter table public.project_stage_sequences
  add column if not exists stage_instructions text
    check (stage_instructions is null or char_length(stage_instructions) <= 2000),
  add column if not exists do_rules   text[] not null default '{}',
  add column if not exists dont_rules text[] not null default '{}';

alter table public.project_sequence_runs
  add column if not exists drafts jsonb;
