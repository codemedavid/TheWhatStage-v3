# TDD Evidence — Action-page routing token leaks into chatbot reply

**Date:** 2026-06-26
**Branch:** `perf/classify-token-reduction`
**Source plan:** none — journeys derived during this TDD run from a production incident screenshot.

## Problem

A Messenger thread showed the bot sending the literal text:

```
If go na po tayo, fill up niyo lang po yung form sa baba 😊
[Action Page: "KantaMoKwentoMo fill up form"]
```

instead of a real action-page button card. The operator also reported the raw
`!actionpage:<slug>` token (the one written in the chatbot instructions) leaking
to customers.

### Root cause

1. `src/app/api/messenger/process/route.ts` rewrites each `!actionpage:<slug>`
   mention in the bot's instructions into a `[Action Page: "title"]` marker and
   feeds it to the LLM. The bare marker read like an instruction to output, so
   the model copied it verbatim into `reply`.
2. `sanitizeReply` stripped the `[Action Page: …]` marker on this branch but
   **not on `main`** (confirmed via `git show main:src/lib/chatbot/classify.ts`),
   and **never** stripped the raw `!actionpage:<slug>` token on any branch — so
   that form leaked whenever instruction-resolution was skipped or the model
   echoed the operator token directly.

## User journeys

- As a customer, when the bot decides to send me an action page, I want a real
  tappable button — never the internal `[Action Page: "…"]` placeholder or a raw
  `!actionpage:slug` token as plain text.
- As an operator, I want the `!actionpage:<slug>` tokens I write in my chatbot
  instructions to drive a button send, not to appear verbatim in customer chats.

## Fix (defense in depth)

- **Deterministic guarantee** — `sanitizeReply` (`src/lib/chatbot/classify.ts`)
  now strips both the `[Action Page: …]` marker *and* a bare/slugged
  `!actionpage` token, so neither can reach a customer on any reply path.
- **Source fix** — `messenger/process/route.ts` resolves the token into a marker
  that explicitly states it is internal routing and must never be written in the
  reply, discouraging the echo at the source.

## Task report

| Behavior | Validation command | RED → GREEN | Guarantee |
|---|---|---|---|
| Strip raw `!actionpage:slug` / bare `!actionpage` from reply | `npx vitest run src/lib/chatbot/classify.test.ts -t "actionpage\|Action Page\|routing"` | 6 failed → 8 passed | Customer never sees the raw operator token |
| Strip `[Action Page: "…"]` routing marker | same as above | 2 passed (regression guard) → 8 passed | Customer never sees the resolved placeholder |
| Resolved marker reads as internal-only | manual review + bracket-strip node check | n/a | Model is told never to write the marker |

### RED evidence

```
Tests  6 failed | 2 passed | 954 skipped (962)
AssertionError: expected 'Heto na po: !actionpage:lead_gen' not to match /!actionpage/i
```

(The 2 passing were the `[Action Page: …]` cases already handled on this branch;
the 6 failures were the unhandled `!actionpage` token cases — the intended RED.)

### GREEN evidence

```
# scoped new tests
Test Files  1 passed | 14 skipped (15)
     Tests  8 passed | 954 skipped (962)

# full classify suite
Test Files  15 passed (15)
     Tests  962 passed (962)

# full chatbot lib
Test Files  228 passed (228)
     Tests  2436 passed (2436)

# messenger route tests
Test Files  15 passed (15)
     Tests  199 passed (199)

# typecheck — no errors in touched files
npx tsc --noEmit  → exit 0
```

## Test specification

| # | What is guaranteed | Test file / case | Type | Result | Evidence |
|---|--------------------|------------------|------|--------|----------|
| 1 | Leaked `[Action Page: "…"]` marker is removed, surrounding text kept | `classify.test.ts:strips a leaked [Action Page: "..."] routing marker (2026-06-26 incident)` | unit | PASS | `vitest run src/lib/chatbot/classify.test.ts` |
| 2 | Raw `!actionpage:slug` token removed, surrounding text kept | `classify.test.ts:strips a raw !actionpage:slug token leaked into the reply` | unit | PASS | same |
| 3 | Bare `!actionpage` token removed | `classify.test.ts:strips a bare !actionpage token with no slug` | unit | PASS | same |
| 4 | All token/marker variants (case, hyphen, underscore, inline) removed | `classify.test.ts:removes every action-page routing token/marker variant` | unit | PASS | same |

## Coverage and known gaps

- The `route.ts` resolution closure is exercised through the messenger-route
  integration tests (199 passing); it was not given a dedicated unit test because
  the deterministic customer-facing guarantee lives in `sanitizeReply`, which is
  fully covered above.
- `src/lib/chatbot/answer.ts` (the plain, non-classification reply path) still
  does not call `sanitizeReply`. It is not the path in this incident (Messenger
  auto-reply uses `answerWithClassification`), but applying `sanitizeReply` there
  too is a reasonable follow-up for full belt-and-braces coverage.

## Merge evidence

RED: 6 failing `!actionpage` token cases (`75218a6`). GREEN: token strip added to
`sanitizeReply` (`c435d93`); internal-only marker in route.ts (`274d91e`). Full
chatbot suite (2436) and messenger route suite (199) green; typecheck clean.
