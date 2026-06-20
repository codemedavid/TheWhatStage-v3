# TDD Evidence — In-Project Leads Get Stage-Driven Personality on Live Replies

**Date:** 2026-06-20
**Branch:** main
**Source plan:** inline `/ecc:plan` output (conversational mode) — see session prompt.

## Problem

When a lead already has an active (non-terminal) project, the live Messenger
chatbot still treated them like a cold lead / new inquiry — e.g. it kept asking
the client to re-fill the action page. The per-stage rules
(`project_stage_sequences.stage_instructions / do_rules / dont_rules`) were used
only by the proactive follow-up drafter, never by the live reply path.

## User Journeys

1. As an operator, when a client already in a project messages us, I want the AI
   to talk to them as an in-progress deal (using the stage's rules) instead of a
   new inquiry, so it stops re-asking for info already collected.
2. As an operator, I never want the AI to re-send / re-request an action page the
   client already completed for this project, but I still want it to send a
   genuinely new, relevant page.
3. As a developer, I want the global safety rails (grounding, no fabrication) to
   stay intact — stage rules elevate and guard, they do not fully override.

## Design decisions (confirmed with user)

- **Rule priority:** Elevate + guard (keep global rails; stage rules win conflicts).
- **Action pages:** Stop re-asking/re-sending completed pages; allow new ones.

## Tasks

### Task 1 — Per-stage rules reach the live reply via active-project context
- Extended `ActiveProjectContext` with `stage_instructions`, `stage_do_rules[]`,
  `stage_dont_rules[]`.
- `resolveActiveProjectContext` now selects `stage_id` and best-effort loads the
  stage's `project_stage_sequences` rules.
- `renderProjectContextBlock` rewritten: TOP-PRIORITY header, "not a new inquiry"
  guard, per-stage instructions + DO/DON'T rules, priority-over-general note.
- **Validate:** `npx vitest run src/lib/projects`
  - RED: `renderProjectContextBlock` new-behavior specs failed (guard, stage rules, blank-drop).
  - GREEN: all pass.

### Task 2 — Action-page logic becomes project-aware
- Added `inActiveProject` param to `stageInstructionParts` and to
  `answerWithClassification` options.
- When set (and action pages exist) an `IN-PROGRESS DEAL` guard is added to the
  **volatile tail** (lead-specific → never the cacheable static prefix):
  no re-send/re-ask of completed pages; only set `action_page` for a genuinely
  new need.
- **Validate:** `npx vitest run src/lib/chatbot`
  - RED: `classify-in-project.test.ts` failed (guard absent).
  - GREEN: all pass.

### Task 3 — Wire the flag through the messenger worker
- `loadReplyContext` derives `inActiveProject` from a non-empty project block and
  returns it; `runJob` passes it into `answerWithClassification`.
- **Validate:** `npx tsc --noEmit` (0 errors), `npx eslint <changed>` (clean).

## Test Specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Active project always emits the "not a new inquiry / do NOT re-ask / action page" guard | `src/lib/projects/active-project.test.ts` | unit | PASS |
| 2 | Per-stage instructions + DO/DON'T rules render as priority guidance | `src/lib/projects/active-project.test.ts` | unit | PASS |
| 3 | Stage rule sections omitted when none configured; blank entries dropped | `src/lib/projects/active-project.test.ts` | unit | PASS |
| 4 | Existing render specs (title/stage/value/instructions, null value, blank instr) still hold | `src/lib/projects/active-project.test.ts` | unit | PASS |
| 5 | `inActiveProject` adds the IN-PROGRESS DEAL guard to the volatile tail | `src/lib/chatbot/classify-in-project.test.ts` | unit | PASS |
| 6 | Guard stays OUT of the cacheable static prefix | `src/lib/chatbot/classify-in-project.test.ts` | unit | PASS |
| 7 | No guard when flag false/omitted, or when no action pages exist | `src/lib/chatbot/classify-in-project.test.ts` | unit | PASS |

## Coverage / Results

```
npx vitest run src/lib/projects src/lib/chatbot
Test Files  228 passed (228)
     Tests  2331 passed (2331)

npx tsc --noEmit      → 0 errors
npx eslint <changed>  → clean
```

## Known gaps / notes

- No migration: `project_stage_sequences` rule columns already exist in remote.
- `resolveActiveProjectContext` now issues one extra best-effort query per call;
  the lead-sequence engine (`src/lib/leads/sequences/fire.ts`) shares it and gets
  the extra fields fetched but does not yet use them (no behavior change).
- The worker derives `inActiveProject` from the rendered project block being
  non-empty; `renderProjectContextBlock` returns '' only for a null context, so
  the flag is reliable.
