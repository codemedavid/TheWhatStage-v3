# TDD Evidence — Operator send 500 on policy-blocked messages

**Date:** 2026-06-20
**Branch:** feat/projects-filters-search-stats

## Problem

Sending a manual message from the conversation panel (leads & projects drawers)
produced a production **500** — `An error occurred in the Server Components
render … digest` plus `Failed to load resource: 500` — whenever Meta rejected
the send. The screenshot showed the messages persisted inline as
`Send failed: policy_blocked:human_agent_unapproved`, yet the panel still threw.

## Root cause

`dispatchOperatorSend` (`src/app/(app)/dashboard/leads/actions/messenger.ts`)
persisted the failed message row with its machine-readable `error`, **then
re-threw** (`if (sendError) throw …`). A thrown Server Action surfaces in
production as the opaque "Server Components render" 500. A policy block
(`human_agent_unapproved`, `window`, `optin`, `otn`, `rate_limited`) is an
expected, already-recorded, recoverable outcome — not a server crash.

## Fix

- `dispatchOperatorSend` now returns `SendResult = { ok: true } | { ok: false; error }`
  for recorded send failures instead of throwing. Genuine infrastructure
  failures (no thread, missing page token, DB errors) still throw — they happen
  before the send is attempted and are not recorded.
- `replyAsOperator`, `sendActionPageAsOperator`, `sendAttachmentAsOperator`
  return `Promise<SendResult>`.
- Clients (`ConversationPanel`, `ActionPagePicker`, `AttachmentComposer`) check
  `result.ok` and surface a friendly notice via new `describeSendError` mapper
  (`_lib/send-error.ts`); the inline failed-message bubble now uses the same
  mapper instead of printing the raw code.

## User journeys

1. As an operator, when Meta rejects my manual reply, I see a clear inline
   reason and the panel stays usable — **no 500**.
2. As an operator, a successful send clears the draft and refreshes the thread.
3. As the system, a genuine infra failure (no thread) still throws so it is not
   silently swallowed.

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|--------------------|------|------|--------|----------|
| 1 | Policy-blocked send resolves `{ ok:false, error:'policy_blocked:human_agent_unapproved' }` (no throw), persists the failed row, stamps pause, skips success tail | `messenger.test.ts > returns a recorded failure (no throw) when the FB send is policy-blocked` | unit | PASS | `npx vitest run …/messenger.test.ts` |
| 2 | Successful send resolves `{ ok: true }` | `messenger.test.ts > returns { ok: true } when the send succeeds` | unit | PASS | same |
| 3 | Missing thread still throws | `messenger.test.ts > still throws for genuine infrastructure failures (no thread)` | unit | PASS | same |

## RED → GREEN

- RED: rewrote the prior `.rejects.toThrow()` expectation to the new contract →
  2 failing (`expected undefined to deeply equal { ok: true }`, policy test).
- GREEN: implemented `SendResult`; `Test Files 15 passed (15) · Tests 107 passed (107)`.
- `npx tsc --noEmit` clean; `eslint` clean on all changed files.

## Known gaps

- No component-level test for the new `sendNotice` banner / `describeSendError`
  rendering (mapper is a pure function; UI wiring verified via tsc + lint).
