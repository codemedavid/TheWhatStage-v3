# TDD Evidence — Virtual Submission Mode operator toggle

**Task:** Add an operator-facing UI toggle for `virtual_submission_mode` (the chat-implied submissions setting).
**Source plan:** none — derived during this TDD run (follow-up to the virtual-submissions feature, PR #15).
**Branch:** `feat/analytics-cross-stage`

## User journey

> As an operator, I want to choose how the bot reacts to chat proceed-intent (off / suggest / auto) from the chatbot settings page, so that I can control whether chat-implied submissions are recorded and whether they advance the lead's stage — without editing the database.

## RED → GREEN

| Stage | Commit | Evidence |
|---|---|---|
| RED | `4a4c3ef` | `vitest src/lib/chatbot/config.test.ts` → **2 failed / 11 passed**: "writes a valid mode" and "coerces an invalid mode" failed (field not persisted); "omits when absent" already passed (never written). |
| GREEN | `088e0c0` | same target → **13 passed**. Full chatbot suite **2374 passed**. `tsc --noEmit` clean. |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | `upsertChatbotConfig` writes a valid mode to the row | `config.test.ts › writes a valid mode to the row` | unit | PASS |
| 2 | An invalid mode is coerced to the default `suggest` | `config.test.ts › coerces an invalid mode to the default (suggest)` | unit | PASS |
| 3 | The column is omitted when the caller doesn't supply a mode (existing setting preserved) | `config.test.ts › omits the column entirely when the mode is not provided` | unit | PASS |
| 4 | Mode coercion accepts only off/suggest/auto, else `suggest` | `config.test.ts` (existing `coerceVirtualSubmissionMode` coverage) | unit | PASS |

## Implementation
- `config.ts` — `ChatbotConfigInput.virtualSubmissionMode?` (optional, accepts raw form string); `upsertChatbotConfig` conditionally writes `virtual_submission_mode` (coerced) only when supplied.
- `dashboard/chatbot/actions.ts` — `saveChatbotConfig` reads `virtualSubmissionMode` from the form.
- `dashboard/chatbot/_components/ConfigForm.tsx` — "Chat-implied submissions" `<select>` (suggest/auto/off), `defaultValue={initial.virtualSubmissionMode}`.

## Coverage / gaps
- Core persistence + coercion fully unit-tested (RED→GREEN). The server action and the `<select>` markup are thin glue (no new logic) covered by `tsc`; no E2E added for this one-control change.
- The DB column + CHECK already exist on remote (migration `20260622000000`), so no schema work here.
