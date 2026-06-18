# TDD Evidence — Projects Follow-up: stop cross-lead leak + use full chatbot brain

**Date:** 2026-06-18/19
**Branch:** `feat/messenger-operator-sends`
**Scope:** `src/lib/sequences/*`, `src/lib/projects/sequences/fire.ts`, `src/lib/leads/sequences/fire.ts`, `SequenceConfig.tsx`, prod data fix.

## Source / reported problem

User: the projects follow-up "follows up the wrong person on the wrong project," ignores the
chatbot AI instructions / rules / knowledge, and an AI instruction added to one card ("Rodstear")
showed up in **every** lead's follow-up.

## Root cause (verified against production data)

1. **Cross-lead leak = data, surfaced by a weak drafter.** The per-stage sequence STEP `instruction`
   is shared by every project in the stage. All 5 steps on stage `c771e2ca…` literally read
   *"Follow up payment for rodstear napasa, na yung draft ng song."* So Jojo's and Raymond's
   `project_sequence_send` jobs drafted messages about "Rodstear" even though their own cards had no
   AI instructions. Confirmed via `messenger_jobs` + `messenger_messages`: the leaking sends were
   `project_sequence_send` jobs whose runs were correctly bound to their own (AI-less) cards — the
   only shared input carrying "Rodstear" was the step text.
2. **Drafter ignored the chatbot brain.** `loadSequenceSendContext` loaded only
   `chatbot_configs.persona`; it dropped `instructions`, `do_rules`, `dont_rules`, and the knowledge
   base that the live chatbot uses. With follow-ups un-grounded, the operator had hardcoded one
   customer's details into the shared step — the leak vector.

## User journeys

- As an operator, when a follow-up step fires, the draft should obey my chatbot's persona, free-form
  instructions, and Do/Don't rules — same as the live bot.
- As an operator, each card's follow-up should use **that card's** AI instructions and the
  conversation — never another customer's details.
- As an operator, follow-ups should be able to pull facts from my knowledge base.

## Task report

| Behavior | Validation command | RED → GREEN | Guaranteed by |
|---|---|---|---|
| Draft prompt includes persona + instructions + Do/Don't rules | `npx vitest run src/lib/sequences/draftPrompt.test.ts` | RED: `Failed to resolve import "./draftPrompt"` → GREEN: 8 passed | `buildFollowupDraftPrompt` |
| Draft prompt includes knowledge-base block | same | RED → GREEN | `buildFollowupDraftPrompt` |
| Per-card `ai_instructions` labeled as authoritative facts for THIS customer | same | RED → GREEN | `buildFollowupDraftPrompt` |
| Anti-leak grounding guard ("only THIS customer", "never mention other customers/projects", "do not invent") | same | RED → GREEN | `buildFollowupDraftPrompt` |
| No fabricated project facts when a card has no `ai_instructions` | same | RED → GREEN | `buildFollowupDraftPrompt` |
| Sparse config emits no `undefined`/`null` text | same | RED → GREEN | `buildFollowupDraftPrompt` |
| Project engine still falls back / maps job status correctly with new ctx + knowledge wiring | `npx vitest run src/lib/projects/sequences` | GREEN: 4 passed (mock updated for `retrieveKnowledge`) | `fire.test.ts` |

### RED evidence (draftPrompt.test.ts, before implementation)
```
Error: Failed to resolve import "./draftPrompt" from "src/lib/sequences/draftPrompt.test.ts".
 Test Files  1 failed (1) | Tests  no tests
```

### GREEN evidence
```
npx vitest run src/lib/sequences src/lib/projects/sequences
 Test Files  3 passed (3) | Tests  17 passed (17)
```
Typecheck: `npx tsc --noEmit` → **0 errors**. Lint on all touched files → clean.

## Implementation summary

- New pure module `src/lib/sequences/draftPrompt.ts` → `buildFollowupDraftPrompt({system,user})`:
  injects persona + instructions + Do/Don't rules + knowledge + the card's own `ai_instructions`
  (labeled authoritative) + conversation, plus an explicit grounding/anti-leak guard.
- `src/lib/sequences/shared.ts`:
  - `loadSequenceSendContext` now loads the full config via `getChatbotConfig` (persona,
    instructions, doRules, dontRules) instead of a bare `persona` select.
  - `draftSequenceStep` delegates prompt assembly to `buildFollowupDraftPrompt`.
  - new `retrieveKnowledge(admin, userId, query)` — best-effort RAG via the service hybrid RPC
    (`match_knowledge_hybrid_service`); returns `''` on no-result/any error so it never blocks a send.
- `projects/sequences/fire.ts` and `leads/sequences/fire.ts` pass the full brain + retrieved
  knowledge into the drafter. Project engine grounds on `run.project_id`'s card (correct per-card);
  lead engine grounds on `resolveActiveProjectContext`.
- `SequenceConfig.tsx`: copy now tells operators step text is stage-wide/generic and per-customer
  specifics belong in each card's AI instructions.

## Data fix (prod, user-approved)

Rewrote the 5 steps of sequence `5949e9a4-6706-40fa-9edf-48ac681c1647` (stage `c771e2ca…`) from the
hardcoded "rodstear" text to generic per-stage goals. This stops the leak immediately even before the
code deploys (the shared step no longer names a customer; AI-less cards get a clean generic touch).

## Known gaps / follow-ups

- No live end-to-end LLM assertion (prompt assembly is unit-tested; the model call is mocked) — the
  anti-leak guard reduces but cannot 100% prevent a model from echoing a name that an operator still
  types into a step. The UX copy + data fix address the authoring side.
- Knowledge retrieval adds one embedding + vector search per touch (best-effort, time-bounded in the
  project engine). Watch cost; see memory `cost-optimization-audit`.
- Pre-existing CAPI vitest failure is unrelated (see memory `preexisting-capi-test-failure`).
