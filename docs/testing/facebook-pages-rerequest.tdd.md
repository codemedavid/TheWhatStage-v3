# TDD Evidence — Facebook page picker only shows one page on re-connect

## Source plan

No `*.plan.md` was supplied. Journeys were derived during this TDD run from the
reported bug: the user added more Facebook Pages, but on returning to
Settings → Facebook the picker only offered one page ("Drive Direct") to connect.

## User journeys

- As a user who manages several Facebook Pages, when I connect Facebook I want
  the picker to list **all** the Pages I manage, so I can choose which to track.
- As a user who **added new Pages after** my first connect, I want a way to
  re-authorize so those newly added Pages become selectable, instead of being
  silently stuck with the Pages I granted the first time.

## Root cause

`buildAuthUrl` (`src/lib/facebook/oauth.ts`) built the OAuth dialog URL without
`auth_type=rerequest`. When a user re-connects an app they have already
authorized, Facebook **skips the page-selection screen** and reuses the
previously granted page set. Pages added after the first connect are therefore
never granted to the app, so `GET /me/accounts` keeps returning only the
original page(s) — exactly the one-page picker the user saw.

The page-fetch and pagination logic in `fetchUserPages` was already correct
(`limit=100` + follows `paging.next`); the missing grant was upstream in consent.

A secondary UX gap: the picker (`page-picker.tsx`) only exposed a re-auth path
in its empty ("No pages found") branch. A user looking at a stale single-page
list had no way to re-trigger OAuth. Added a "Reconnect to grant access" link
pointing at `/api/auth/facebook/start` (which now carries `auth_type=rerequest`).

## Task report

| Behavior | Validation command | RED | GREEN |
|----------|--------------------|-----|-------|
| OAuth URL must request page re-selection | `npx vitest run src/lib/facebook/oauth.test.ts` | `expected null to be 'rerequest'` | PASS |

RED excerpt:
```
FAIL  src/lib/facebook/oauth.test.ts > re-requests page selection so newly added pages can be granted
AssertionError: expected null to be 'rerequest'
```

GREEN excerpt:
```
Test Files  15 passed (15)
     Tests  106 passed (106)
```

## Test specification

| # | What is guaranteed | Test file or command | Type | Result | Evidence |
|---|--------------------|----------------------|------|--------|----------|
| 1 | `buildAuthUrl` sets `auth_type=rerequest` so Facebook re-shows the page picker and newly added Pages can be granted | `src/lib/facebook/oauth.test.ts:re-requests page selection so newly added pages can be granted` | unit | PASS | `npx vitest run src/lib/facebook/oauth.test.ts` |
| 2 | Existing consent-URL fields (scopes, redirect, state, response_type) unchanged | `src/lib/facebook/oauth.test.ts:builds a consent URL with the right scopes and redirect` | unit | PASS | same |

## Follow-up: "No pages found" for Business Portfolio pages

After the `rerequest` fix, the user reconnected, selected the (business-owned)
page they wanted, and landed on **"No pages found"** — `/me/accounts` returned
an empty list.

**Root cause:** `/me/accounts` only lists Pages the user has a *direct personal*
role on. Pages owned by a **Business Portfolio** (Meta Business Suite) are not
returned there. "Drive Direct" appeared originally because of a direct role; the
newly added page is business-owned and so was omitted.

**Fix:** added the `business_management` scope and extended `fetchUserPages` to
also pull pages via `/me/businesses → owned_pages/client_pages`, merging with
`/me/accounts` (deduped by id, `/me/accounts` token wins). The business lookup is
best-effort: a token without `business_management` 4xxs on `/me/businesses` and
must not wipe out the primary results.

### Task report (follow-up)

| Behavior | Validation command | RED | GREEN |
|----------|--------------------|-----|-------|
| Consent URL requests `business_management` | `npx vitest run src/lib/facebook/oauth.test.ts` | `Received: "...pages_utility_messaging"` (no business_management) | PASS |
| Business-portfolio pages merged into picker, deduped | same | `expected [ 'p1' ] to include 'p9'` | PASS |
| Business lookup failure does not drop /me/accounts pages | same | (passed pre-impl; guards regression) | PASS |

### Test specification (follow-up)

| # | What is guaranteed | Test file or command | Type | Result | Evidence |
|---|--------------------|----------------------|------|--------|----------|
| 3 | `buildAuthUrl` requests `business_management` so business-portfolio pages are discoverable | `oauth.test.ts:builds a consent URL with the right scopes and redirect` | unit | PASS | `npx vitest run src/lib/facebook/oauth.test.ts` |
| 4 | `fetchUserPages` merges Business Portfolio pages `/me/accounts` omits, deduped by id | `oauth.test.ts:merges Business Portfolio pages that /me/accounts omits, deduped by id` | unit | PASS | same |
| 5 | A failing business lookup still returns `/me/accounts` pages | `oauth.test.ts:still returns /me/accounts pages when the business lookup fails` | unit | PASS | same |
| 6 | `/me/accounts` pagination still followed across responses | `oauth.test.ts:follows paging.next to fetch all pages across multiple /me/accounts responses` | unit | PASS | same |

## Coverage and known gaps

- Full suite green after the fix: `Test Files 109 passed (109) · Tests 1094 passed (1094)`.
- The added "Reconnect to grant access" link in `page-picker.tsx` is a plain
  anchor to an existing route; not covered by a new automated test (no behavior
  logic, only navigation). Manual verification: clicking it re-runs OAuth, the
  Facebook dialog now re-prompts page selection, and previously-unselected Pages
  appear in the picker.
- Note: the picker is only rendered while `facebook_pages` is empty. A user who
  already saved a page sees `ConnectedView` instead; re-adding more pages from
  that state is a separate follow-up not addressed here.
