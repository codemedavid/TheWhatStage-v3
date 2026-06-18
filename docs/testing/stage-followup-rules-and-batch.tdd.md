# Per-stage follow-up rules + one-shot batch + test preview — TDD evidence

Branch: `feat/messenger-operator-sends` · Date: 2026-06-19

## What shipped
1. **Per-stage AI guidance** — `project_stage_sequences` gains `stage_instructions`,
   `do_rules[]`, `dont_rules[]`. Layered into the draft prompt above the per-card
   facts ("How to follow up at this stage"). Global chatbot Do/Don't still apply.
2. **One generation per lead** — the whole sequence is drafted in ONE LLM call on
   the first touch and stored on `project_sequence_runs.drafts` (jsonb). Later
   touches read the stored text (zero LLM calls). Graceful fallback: missing/invalid
   batch entry → live single-step draft → `fallback_message` → built-in default.
3. **Test preview** — `previewStageSequence` drafts the whole sequence for one
   chosen lead from the in-editor config and returns the messages WITHOUT sending
   or persisting. Surfaced in `SequenceConfig.tsx` with a lead picker.

## Files
- `src/lib/sequences/draftPrompt.ts` — extracted shared brain assembly; added
  stage sections + `buildSequenceBatchPrompt` (pure).
- `src/lib/sequences/draft.ts` — NEW: `draftSequenceStep` + `draftSequenceBatch`
  (LLM wrappers, no Supabase/crypto imports → unit-testable). Re-exported by
  `shared.ts`.
- `src/lib/projects/sequences/fire.ts` — `resolveBatchDrafts`: generate-once,
  store, reuse; single-step fallback when a position is missing.
- `src/app/(app)/dashboard/projects/actions/sequences.ts` — persist stage rules;
  `previewStageSequence` + `loadStagePreviewProjects`.
- `_lib/schemas.ts`, `_lib/queries.ts`, `_components/SequenceConfig.tsx`.
- Migration `20260619000000_stage_followup_rules_and_batch.sql` (applied + history
  row recorded at the file-prefix version).

## TDD
- `draftPrompt.test.ts` — 15 pass (added stage-rules + batch-prompt specs; RED→GREEN).
- `draft.test.ts` — 7 pass (batch JSON parse: clean / fenced / partial / blank /
  garbage / throw / key-aliases).
- `projects/sequences/fire.test.ts` — 7 pass (added: generate-once+store+send step 0;
  reuse stored drafts with no LLM call; fall back to single-step when batch lacks a
  position).

## Verification
- `npx tsc --noEmit` — clean.
- `npx vitest run src/lib/sequences src/lib/projects/sequences` — 34 pass.
- `eslint` on all touched files — clean.
- Full `src/lib` run: only failures are inside the unrelated nested
  `WhatStage_worktrees/` checkout (glob artifact), none in this tree.

## Design note (freshness tradeoff)
Pre-generated touches are drafted from the conversation at first-fire time. This is
safe because a run is cancelled when the customer replies
(`cancelActiveProjectSequenceRuns`), so every stored touch is a "no-reply-yet" nudge.
Scope: batch + stage rules apply to the PROJECT engine only; the separate
`lead_sequences` reminder engine is unchanged (still single-step drafting).
