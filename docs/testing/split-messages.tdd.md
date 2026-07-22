# TDD Evidence: Human-like Split Messages

**Source plan**: inline `/ecc:plan` (approved in-session) — "add a split message feature… act like a human cutting messages into new message… must be enable/disable-able".
**Branch**: `fix/fb-utility-scope-warning`
**Date**: 2026-07-21

## User journeys

1. As a bot operator, I want the bot to break its reply into a couple of natural
   bubbles (greeting/acknowledgement first, then the follow-up question), so the
   conversation feels human instead of one long paragraph.
2. As an operator, I want to turn this behavior ON or OFF per tenant, so I can
   opt in without changing anyone else's bot. **Off must be identical to today.**
3. As the system, when split is on I want each bubble to arrive paced with a
   typing indicator, one DB row per bubble, without duplicating on retry of a
   fully-completed send.

## Task report

### Task 1 — `segmentReply` human-like splitter (pure)
- Deterministic, zero-LLM splitter: statements group into a bubble; each question
  gets its own bubble; guards cap bubble count and merge ultra-short interjections.
- RED: `npx vitest run src/lib/chatbot/reply-segments.test.ts` → module missing / 2 failing on min-length threshold.
- GREEN: after lowering `DEFAULT_MIN_BUBBLE_CHARS` to 5 and simplifying the merge → **10 passed**.
- Guarantees: the core example splits into `["Hello po bossing! Salamat sa message.", "Ano po name ng business niyo?"]`; no non-whitespace content dropped; bubble cap collapses overflow into the last bubble.

### Task 2 — config plumbing + toggle persistence
- Added `split_messages_enabled` / `split_max_bubbles` to `chatbot_configs`
  (migration `20260701000000`, applied to remote via idempotent `add column if not exists`),
  `ChatbotConfigRow`, `ChatbotConfig`, `DEFAULT_CHATBOT_CONFIG` (default OFF / 3),
  `rowToConfig` (clamped 2..5), and `setSplitMessageSettings`.
- RED→GREEN: `npx vitest run src/lib/chatbot/split-config.test.ts` → 3 failed → **4 passed**.

### Task 3 — paced multi-bubble sender
- `sendMessengerTextSequence` sends bubbles in order with `typing_on` + a
  length-scaled `bubbleDelayMs` (clamped 800–2200ms) before every bubble after
  the first; returns one part per delivered bubble; each bubble still runs
  through `splitMessengerText` for the 2000-char safety net.
- RED→GREEN: `npx vitest run src/lib/facebook/messenger-sequence.test.ts` → 5 failed → **5 passed** (fixed one test mock to account for the inter-chunk typing call).

### Task 4 — wire into send path + worker
- `sendOutbound` text payload gains optional `segments`; 2+ → paced sequence,
  else single send. Returns `parts[]`.
- Worker (`process/route.ts`) gates on `config.splitMessagesEnabled`, calls
  `segmentReply(reply, { maxBubbles })`, and persists **one `messenger_messages`
  row per bubble**. Job-level `outbound_text_fb_id` still guards a fully
  completed send from re-sending on retry (same accepted tradeoff as the
  pre-existing >2000-char path for a mid-sequence failure).
- Validation: `npx tsc --noEmit` clean; `npx vitest run src/app/api/messenger/process` → **199 passed**.

### Task 5 — operator on/off UI
- `GET/PUT /api/chatbot/split-settings` (zod-validated, auth-gated, mirrors
  `debounce-settings`) + `SplitMessagesForm` toggle mounted on the chatbot page.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Greeting/ack splits from the trailing question (core example) | `reply-segments.test.ts` | unit | PASS |
| 2 | Each question gets its own bubble; no content dropped | `reply-segments.test.ts` | unit | PASS |
| 3 | Bubble count capped; overflow merges into last bubble | `reply-segments.test.ts` | unit | PASS |
| 4 | Ultra-short interjection ("Ok.") never spams as its own bubble | `reply-segments.test.ts` | unit | PASS |
| 5 | Config defaults OFF; legacy rows read as disabled; cap clamped 2..5 | `split-config.test.ts` | unit | PASS |
| 6 | Bubbles sent in order; one part returned per bubble | `messenger-sequence.test.ts` | unit | PASS |
| 7 | typing_on + a paced wait before every bubble after the first | `messenger-sequence.test.ts` | unit | PASS |
| 8 | Oversized bubble still split under the 2000-char limit | `messenger-sequence.test.ts` | unit | PASS |
| 9 | HUMAN_AGENT tag carried onto every text bubble | `messenger-sequence.test.ts` | unit | PASS |
| 10 | `bubbleDelayMs` scales with length, clamped [800,2200] | `messenger-sequence.test.ts` | unit | PASS |

## Coverage / known gaps

- Full affected run: `npx vitest run src/lib/chatbot src/lib/facebook src/lib/messenger src/app/api/messenger/process` → **4171 passed / 393 files**. `npx tsc --noEmit` and `eslint` on changed files clean.
- Enable/disable guarantee: when OFF, the worker builds `segments = [reply]`, so `sendOutbound` takes the single-send branch — byte-for-byte the prior behavior.
- Gaps / follow-ups:
  - No automated test for the `/api/chatbot/split-settings` route (mirrors the untested `debounce-settings` route); covered by the shared `setSplitMessageSettings` unit path and manual verification.
  - Mid-sequence send failure re-sends from the top on retry (duplicated leading bubbles) — the same accepted tradeoff the pre-existing >2000-char path documents; true per-bubble resume was deliberately out of scope.
  - Live single-thread Messenger send to confirm pacing feel is still owed (manual).
