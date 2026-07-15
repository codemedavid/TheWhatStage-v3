# TDD Evidence — Facebook soft-disconnect (fix timeout + preserve lead chats)

**Branch:** `fix/fb-utility-scope-warning`
**Date:** 2026-07-15
**Source plan:** none — journeys derived during this TDD run from the reported bug:
"Could not disconnect Facebook. canceling statement due to statement timeout" plus
"when we reconnect the Facebook page we can still chat the leads … related on that page before."

## User journeys

1. As an operator, I want disconnecting a Facebook page to succeed reliably (not time out),
   so that I can disconnect a busy page whose Messenger history is large.
2. As an operator, I want my leads and their chat history preserved through a
   disconnect → reconnect, so that I can keep talking to those leads afterwards.
3. As an operator, while a page is disconnected I want the bot to stop replying,
   so that "disconnect" actually pauses messaging.

## Root cause

`disconnectForm` ran `DELETE FROM facebook_connections WHERE user_id = ?`. Via
`ON DELETE CASCADE` that deletes `facebook_pages → messenger_threads →
messenger_messages` (plus jobs, comments, follow-ups) in one transaction. For a
busy page that is up to millions of rows, exceeding `statement_timeout`
("canceling statement due to statement timeout"). The same cascade destroys the
exact thread/message/lead data needed to keep chatting after reconnect — so both
reported problems share one root cause.

## Fix (pause & preserve)

| Change | File |
|--------|------|
| `disconnected_at timestamptz` column | `supabase/migrations/20260629000000_facebook_soft_disconnect.sql` (applied to remote) |
| Disconnect = one-row UPDATE + best-effort unsubscribe (no cascade) | `src/app/(app)/dashboard/settings/facebook/actions.ts` |
| Reconnect clears `disconnected_at` + re-subscribes preserved pages | `src/app/api/auth/facebook/callback/route.ts` |
| Paused connection renders as not-connected | `src/app/(app)/dashboard/settings/facebook/page.tsx` |
| `unsubscribePageFromWebhook` (DELETE `/me/subscribed_apps`) | `src/lib/facebook/messenger.ts` |

Reconnect reuses the same rows: `facebook_pages.fb_page_id` is unique and
`messenger_threads (page_id, psid)` is unique, so upserting on reconnect attaches
to the existing page/thread rows — all prior leads and messages remain chattable.

## Task report

**RED** — added `src/lib/facebook/messenger-subscribe.test.ts` covering the new
`unsubscribePageFromWebhook` helper (DELETE verb, page token in query, throws on
Graph error). Ran before implementation:

```
$ npx vitest run src/lib/facebook/messenger-subscribe.test.ts
TypeError: unsubscribePageFromWebhook is not a function
Tests  2 failed | 1 passed (3)
```

Failure caused by the intended missing implementation. Committed as `2473fc9`.

**GREEN** — implemented `unsubscribePageFromWebhook` + `deleteJson` helper, then:

```
$ npx vitest run src/lib/facebook/messenger-subscribe.test.ts
Test Files  1 passed (1)
Tests  3 passed (3)
```

Full facebook lib suite + type check after all changes:

```
$ npx vitest run src/lib/facebook
Test Files  111 passed (111)
Tests  1104 passed (1104)

$ npx tsc --noEmit    # no errors
```

Committed as `eda2edc`.

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|--------------------|------|------|--------|----------|
| 1 | `unsubscribePageFromWebhook` issues DELETE `/me/subscribed_apps` with the page token | `messenger-subscribe.test.ts:DELETEs /me/subscribed_apps…` | unit | PASS | `vitest run src/lib/facebook/messenger-subscribe.test.ts` |
| 2 | It throws when Graph rejects the unsubscribe (caller can swallow) | `messenger-subscribe.test.ts:throws when Graph rejects…` | unit | PASS | same |
| 3 | `subscribePageToWebhook` still POSTs `/me/subscribed_apps` (no regression) | `messenger-subscribe.test.ts:POSTs to /me/subscribed_apps…` | unit | PASS | same |
| 4 | No regression across the Facebook lib | 111 files / 1104 tests | unit+integration | PASS | `vitest run src/lib/facebook` |

## Coverage and known gaps

- The migration + soft-disconnect data-preservation behavior is DB-level (cascade
  vs one-row UPDATE) and is not exercised by a unit test — there is no DB harness
  in this project's vitest setup (clients are untyped, no `Database` generic).
  It is verified by construction: the migration applied cleanly to remote
  (column confirmed present), disconnect no longer issues a DELETE, and reconnect
  upserts on the unique keys that preserve page/thread identity.
- The server actions (`disconnectForm`, callback route) call `redirect()` /
  `revalidatePath()` and the Supabase server client; there is no existing test
  harness for them in this repo, so they were validated by type check + manual
  reasoning rather than an automated test. Follow-up worth adding: an integration
  test that seeds a connection+page+thread, disconnects, and asserts the rows
  survive with `disconnected_at` set.

## Merge evidence (for squash)

RED `2473fc9` (reproducer, `unsubscribePageFromWebhook is not a function`) →
GREEN `eda2edc` (implementation, 3/3 then 1104/1104 pass, tsc clean).
