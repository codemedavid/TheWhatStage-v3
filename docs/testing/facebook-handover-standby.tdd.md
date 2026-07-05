# TDD Evidence — Facebook Handover Protocol (standby take-control)

**Date:** 2026-07-05
**Branch:** main (working tree)

## Problem / source

The page "Web Negosyo" (fb_page_id `596614693524838`) was connected with a valid
token and subscribed to `messages`, yet the bot never replied. Live Meta API +
DB probing showed:

- 0 threads/messages in our DB despite active customer conversations on Meta.
- `messaging_feature_status.msgr_multi_app: true` — multiple apps on the page.
- `thread_owner` for active threads split ~50/50 between our app **ChatBot**
  (`2386809585109609`) and a competing chatbot **BMX Gen AI Chatbot**
  (`622851382610562`); a live "Messenger automatically created a transfer
  request" system message confirmed the Handover Protocol is active.

Root cause: on multi-app pages, only the thread **owner** receives normal
`messages` webhooks. Inbound for threads we don't own arrives on the
`entry.standby[]` channel, which our webhook ignored entirely. There was no
handover handling anywhere in the codebase.

Meta exposes no API to declare an app the permanent primary receiver (UI-only,
and hidden in New Pages Experience), so the fix is to **seize thread control**
(`take_thread_control`) when a standby message arrives, then reply normally.

## User journeys

- As a business whose page already runs another chatbot, when a customer
  messages me, WhatStage should take over the conversation and reply.
- As the page owner, WhatStage must not steal a thread it won't answer (paused /
  inactive owner) — that would leave the customer with no reply from anyone.

## Task report / guarantees

| # | Guaranteed | Test | Type | Result |
|---|-----------|------|------|--------|
| 1 | `takeThreadControl` POSTs `/me/take_thread_control` with `{recipient:{id}}` + page token | `src/lib/facebook/messenger-handover.test.ts` | unit | PASS |
| 2 | `takeThreadControl` throws on Graph rejection | same | unit | PASS |
| 3 | A standby message takes control (decrypted token + PSID) then enqueues the reply | `route.test.ts > standby > takes thread control then enqueues` | integration | PASS |
| 4 | Standby echoes are ignored — no take, no enqueue | `route.test.ts > standby > ignores standby echoes` | integration | PASS |
| 5 | Inactive/paused owner: thread is NOT stolen, no enqueue | `route.test.ts > standby > does not steal the thread when owner not active` | integration | PASS |
| 6 | take_thread_control failure is best-effort — reply still enqueued | `route.test.ts > standby > still enqueues when take fails` | integration | PASS |

RED evidence: before implementation, `npx vitest run` → 4 failed (import of
`takeThreadControl` missing + `mocks.takeThreadControl` never called).
GREEN evidence: after implementation → `Test Files 16 passed`, `Tests 204 passed`.
Typecheck (`tsc --noEmit`) and `eslint` on changed files: clean (one pre-existing
unused-var warning in an untouched test).

## Changes

- `src/lib/facebook/messenger.ts` — new `takeThreadControl()`; added
  `messaging_handovers` to `SUBSCRIBED_FIELDS`.
- `src/app/api/webhooks/facebook/route.ts` — parse `entry.standby[]`; new
  `handleStandby()` (lookup → active-owner gate → take control → delegate to
  `handleEvent`).

## Known gaps / follow-ups

- No `request_thread_control` fallback when we're a pure secondary receiver and
  `take` is rejected; evidence shows we can take here, so deferred (YAGNI).
- Two-bot contention: BMX can grab threads back → occasional double reply until
  BMX is detached at its source (Business Portfolio / prior agency dashboard).
- `messaging_handovers` subscription only applies after the page re-subscribes
  (next Save/reconnect); standby delivery itself works with the existing
  `messages` subscription.
- Not yet verified live in production (requires deploy).
