# TDD Evidence — Messenger send reliability (no-send / truncation fixes)

**Date:** 2026-06-19
**Branch:** `feat/messenger-operator-sends`
**Request:** "messaging sometimes doesn't send any messages at all, and sometimes
it's cutting messages on the messenger — find the flaws/bugs and fix them."

Journeys were derived during this TDD run (no `*.plan.md` was supplied).

## User journeys

1. As a lead, when the bot's answer is long, I want to receive the **whole**
   reply (as one or more bubbles) — not a message cut off mid-sentence, and not
   nothing at all.
2. As an operator, when I send a long message from the inbox, I want it to
   **deliver** rather than be silently rejected by Meta.
3. As a lead, when the model briefly fails to produce a reply, I want to receive
   the configured fallback message — never silence.

## Root causes (confirmed by direct reading + a 32-agent adversarial workflow)

| # | Symptom | Root cause | Verdict |
|---|---------|-----------|---------|
| 1 | not sent | `sendMessengerText` sent text verbatim; Meta rejects text >2000 chars wholesale (Graph #100, subcode ~2018048) — the entire send fails and the worker retries it to exhaustion. Hits verbose bot replies **and** arbitrary-length operator pastes. No chunking existed anywhere. | VERIFIED REAL vs HEAD |
| 2 | truncated | Reply `maxTokens` had been cut `1600 → 600/400` as a cost optimization. Replies needing more than ~400 tokens stop at the cap (`finishReason='length'`) and Graph delivers the cut text. | VERIFIED REAL vs HEAD |
| 3 | not sent | When the structured JSON call **and** the plain fallback call both return empty, the worker skipped the turn (`'empty reply'`) → customer gets nothing. | Found + verified by workflow |

## Task report (RED → GREEN)

### Fix 1 — chunk text to the 2000-char limit
- **What:** new pure `splitMessengerText()` (paragraph→line→sentence→word→
  surrogate-safe hard cut, no content loss); `sendMessengerText` now sends
  ordered bubbles and returns the first part's id (keeps the worker's
  `outbound_text_fb_id` idempotency stamp stable).
- **RED:** `npx vitest run src/lib/facebook/messenger-split.test.ts src/lib/facebook/messenger-text.test.ts`
  → both files fail to resolve `./messenger-split` (module absent).
- **GREEN:** same command → **14 passed**.

### Fix 2 — restore a non-truncating reply budget
- **What:** named constants `REPLY_MAX_TOKENS=800` / `REPLY_WITH_STRUCTURE_MAX_TOKENS=1024`
  in `config.ts`, wired into `answer.ts` and the two `classify.ts` reply calls.
  Output is billed per token generated, so a higher ceiling is free on short
  replies and only spends on the turns that need the room. Floor-guard test
  prevents a future cost pass from re-truncating.
- **RED:** `npx vitest run src/lib/chatbot/config.test.ts` → 2 failed
  (`REPLY_MAX_TOKENS` / `REPLY_WITH_STRUCTURE_MAX_TOKENS` undefined).
- **GREEN:** same command → all pass.

### Fix 3 — never go silent
- **What:** `ensureNonEmptyReply(reply, fallbackMessage)` in `reply-guard.ts`;
  worker substitutes the configured fallback before the `'empty reply'` skip.
- **RED:** `npx vitest run src/lib/chatbot/reply-guard.test.ts` → 5 failed
  (`ensureNonEmptyReply` undefined).
- **GREEN:** same command → all pass; worker integration
  (`src/app/api/messenger/process/route.test.ts`) still green.

## Test specification

| # | Guarantee | Test | Type | Result |
|---|-----------|------|------|--------|
| 1 | Text within 2000 chars sends as one request unchanged | `messenger-text.test.ts` | unit | PASS |
| 2 | Text >2000 chars splits into ordered bubbles, each ≤2000, no content lost, returns first id | `messenger-text.test.ts` | unit | PASS |
| 3 | HUMAN_AGENT tag/messaging_type carried on every chunk | `messenger-text.test.ts` | unit | PASS |
| 4 | Splitter prefers paragraph/sentence/word boundaries, hard-splits oversized tokens, never bisects a surrogate pair | `messenger-split.test.ts` (11) | unit | PASS |
| 5 | Reply token budgets stay above the truncation floor; structured > plain | `config.test.ts` | unit | PASS |
| 6 | Empty reply is replaced by the configured fallback; '' only when both empty | `reply-guard.test.ts` (5) | unit | PASS |

## Coverage / verification

- Targeted suites covering every changed module + transitive importers:
  - facebook + messenger: **1454 passed** (incl. submit/leads/followups/sequences/
    reminders/campaign — all funnel through `sendMessengerText`).
  - chatbot: **967 passed**.
  - worker route + reply-guard: **220 passed**.
- `eslint` clean on all touched files.

## Known gaps / notes

- The full `npx vitest run` reports 34 failures, **all inside the nested
  `WhatStage_worktrees/*` fleet worktrees** (independent repo copies that do not
  contain these changes) plus the documented pre-existing CAPI test. Zero
  failures originate from this worktree's `src/`. Vitest's default glob scans
  those sibling worktrees — scope runs to `src/` (or add an `exclude`) to avoid
  the noise.
- Multi-bubble idempotency tradeoff: if a later chunk throws after an earlier one
  delivered, a job retry re-sends the leading bubble (one duplicate). Only the
  rare >2000-char path is affected; strictly better than dropping the reply.
- Not committed — files are staged in the working tree only (see `git status`).
