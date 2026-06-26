# TDD Evidence — Inbox "Needs reply" qualifying filter

**Source plan:** none — journeys derived during this TDD run from the bug report.

## Problem

The Inbox **Needs reply** tab listed every Messenger thread with an unread or
missed message, including cold inbound the bot still owns. Requirement: only show
a waiting conversation when it is *real, owned work* — the lead has an active
(non-archived) project, has submitted an action page, **or** the operator has
personally taken over the chat. Everything else stays hidden.

"Took over" maps to `messenger_threads.bot_paused_until`: it is stamped whenever
an operator sends a manual reply (`leads/actions/messenger.ts`), and while the
stamp is in the future the bot is paused and the human is handling the thread.

## User journeys

- As an operator, I want the Needs-reply feed to surface only conversations tied
  to a project, a submission, or my own takeover, so cold bot-handled chats don't
  bury the people actually waiting on me.
- As an operator, I want the sidebar Inbox badge and the tab chip to match that
  filtered feed, so the count never promises more than the list shows.

## Task report

| Behavior | Validation command | RED → GREEN | Guarantee |
|----------|--------------------|-------------|-----------|
| Qualifier helpers (`hasActiveProject`, `isBotTakenOver`, `qualifiesForNeedsReply`) | `npx vitest run …/inbox/_lib/rows.test.ts` | 12 new tests `qualifiesForNeedsReply is not a function` (RED) → 41 passed (GREEN) | A waiting thread surfaces iff it has an active project, a submission, or an unexpired operator takeover |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | No project/submission/takeover ⇒ excluded | `rows.test.ts:qualifiesForNeedsReply > excludes a waiting thread with no project…` | unit | PASS |
| 2 | Archived-only project ⇒ excluded | `rows.test.ts:… excludes a thread whose only project is archived` | unit | PASS |
| 3 | Active project ⇒ included | `rows.test.ts:… includes a thread with an active project` | unit | PASS |
| 4 | Lead submission ⇒ included | `rows.test.ts:… includes a thread whose lead has a submission` | unit | PASS |
| 5 | Unexpired operator takeover ⇒ included | `rows.test.ts:… includes a thread the operator has taken over` | unit | PASS |
| 6 | Expired takeover ⇒ excluded | `rows.test.ts:… excludes a thread whose operator takeover has expired` | unit | PASS |
| 7 | `hasActiveProject` ignores titles, only archived_at | `rows.test.ts:hasActiveProject` | unit | PASS |
| 8 | `isBotTakenOver` null/expired/unparseable ⇒ false | `rows.test.ts:isBotTakenOver` | unit | PASS |

## Wiring

- `queries.ts` adds `NEEDS_REPLY_SELECT` (pulls `bot_paused_until` +
  `action_page_submissions(id)`), a shared `scanWaitingThreads` helper that
  filters candidates through `qualifiesForNeedsReply`, and routes both
  `fetchNeedsReply` and `countNeedsReply` through it so feed and badge agree.
- The filter runs in JS because the qualifying condition is an OR across three
  relations (thread column + projects + submissions) PostgREST can't express in
  one query; the waiting working set is tiny, so a single bounded scan
  (`NEEDS_REPLY_SCAN_CAP = 300`) covers both feed and count.

## Coverage / known gaps

- `npx vitest run src/app/(app)/dashboard/inbox` → 41 passed. `npx tsc --noEmit`
  → no inbox errors.
- `scanWaitingThreads` itself (Supabase wiring) is integration-tested only via
  the pure predicate; no Supabase mock added — consistent with the existing
  inbox tests, which cover the pure view-model layer.
- Pagination beyond `NEEDS_REPLY_SCAN_CAP` is out of scope (matches the existing
  "load more later" note in the file).
