# TDD Evidence — Per-page `pages_utility_messaging` detection

**Branch:** `fix/fb-utility-scope-warning`
**Date:** 2026-07-19
**Source plan:** none — journeys derived during this TDD run from the reported
symptom ("template submit review fails on just the *Kanta Mo Kwento Mo* page
with: *Your Facebook app needs the pages_utility_messaging permission*").

## Problem

`pages_utility_messaging` gates the Message Templates API. It is granted **per
page**, not per app: Meta grants it immediately to app admins/testers/developers
but withholds it for other owners' pages until App Review passes. So a submit
succeeds on the operator's own pages and fails on a client page — exactly the
single-page failure reported.

`/me/permissions` (the existing connect-time check) is **user-token scoped** and
cannot answer this per page. The only reliable per-page signal is probing the
templates endpoint with that page's own token and reading Meta's response.

## User journeys

1. As an operator, when I connect/save a page whose token cannot use utility
   messaging, I want the settings page to flag that specific page, so I learn
   the gap before a template submit fails with code 200.
2. As an operator with a page that *can* use utility messaging, I want no false
   warning on it.
3. As the connect flow, a permission probe that errors for an unrelated reason
   (bad token, network) must never assert a false "missing" and must never
   block the save.

## Task report

### Core unit — `probePageUtilityMessaging`

- **Summary:** New `probePageUtilityMessaging({ fbPageId, pageAccessToken })` in
  `src/lib/facebook/messenger-templates.ts` does a cheap `GET
  /{pageId}/message_templates?limit=1` and maps the outcome to
  `'ok' | 'missing' | 'unknown'`. Never throws.
- **Validation command:** `npx vitest run src/lib/facebook/messenger-templates.test.ts`
- **RED evidence:** `TypeError: probePageUtilityMessaging is not a function` —
  4 new tests failed, 4 existing passed (compile/reference RED; the new tests
  exercise a not-yet-implemented export).
- **GREEN evidence:** `Test Files 1 passed (1) / Tests 8 passed (8)`.
- **Guaranteed:** 2xx → `ok`; Meta permission error (code 200 / HTTP 403) →
  `missing`; any other Graph error (e.g. code 190) → `unknown`; a thrown/rejected
  fetch → `unknown`. Probe issues a `limit=1` read.

### Wiring — persist + surface

- **Summary:** Added nullable `facebook_pages.utility_messaging_ok`
  (migration `20260630000000`). `savePagesForm` probes each selected page
  best-effort in the existing `Promise.allSettled` loop and caches
  `ok→true / missing→false / unknown→null`. Settings page selects the column;
  `ConnectedView` renders a red per-page warning when the flag is `false`.
- **Validation command:** `npx tsc --noEmit` (exit 0) and
  `npx vitest run src/lib/facebook/` (111 files / 1108 tests passed).
- **Guaranteed:** the flag round-trips connect → DB → settings UI; only
  `false` (a confirmed withheld permission) shows the warning — `null`
  (unknown) and `true` stay silent, so a probe failure never nags the operator.

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|--------------------|------|------|--------|----------|
| 1 | Successful templates read → `ok` (and probe uses `limit=1`) | `messenger-templates.test.ts:probePageUtilityMessaging › returns "ok"…` | unit | PASS | `vitest run …messenger-templates.test.ts` |
| 2 | Meta code 200 / 403 → `missing` | `…› returns "missing" when Meta reports the permission error` | unit | PASS | same |
| 3 | Non-permission Graph error → `unknown` (no false "missing") | `…› returns "unknown" for a non-permission Graph error` | unit | PASS | same |
| 4 | Network throw → `unknown` (never blocks caller) | `…› returns "unknown" when the network call throws` | unit | PASS | same |

## Coverage & known gaps

- The core decision logic (unit 1–4) is fully covered.
- **Intentional gap:** `savePagesForm` persistence and the `ConnectedView` badge
  are verified by `tsc` + manual reasoning, not an automated test — the server
  action is tightly coupled to Supabase/session and the project has no existing
  harness for it (consistent with the sibling `savePagesForm` code, which is
  also untested). Follow-up if desired: an integration test with a mocked
  supabase client asserting the `utility_messaging_ok` update per probe result.
- The flag is refreshed only on connect/save. A page whose App Review status
  changes later is re-flagged on the next reconnect, not continuously.

## Checkpoint commits (this task, on `fix/fb-utility-scope-warning`)

- `57366da` test: add reproducer for per-page utility-messaging probe (RED)
- `9ac3c38` feat: probePageUtilityMessaging for per-page permission detection (GREEN)
- `3c08267` feat: flag connected pages missing pages_utility_messaging (wiring + migration + UI)
