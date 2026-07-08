# TDD Evidence — Proactive `pages_utility_messaging` scope warning

## Source plan

No `*.plan.md`. Journeys derived during this TDD run from a user report: the
Templates tab showed *"Your Facebook app needs the pages_utility_messaging
permission… Affected templates stay in Draft."* User confirmed they need
**out-of-window utility messages** and opted in to a proactive scope-check
warning.

## Diagnosis (why this is not a "make templates submit" code fix)

Out-of-window utility templates **require** Meta to grant `pages_utility_messaging`
on the page token. The app already:

- requests the scope in the consent URL (`oauth.ts` `SCOPES`),
- detects the code-200 permission error structurally (`messenger-templates.ts`),
- keeps the row as Draft and offers reset/re-submit (`templates/actions.ts`).

No code can make Meta accept a template when the permission was never granted.
The real fix is **reconnecting the page** to re-mint a token that carries the
permission (Dev Mode: immediate for app admins/testers; Live Mode: App Review).
This change makes that gap **visible at connect time** instead of only surfacing
when a template submit later fails.

## User journeys

1. As an operator, when I connect a page and Facebook withholds
   `pages_utility_messaging`, I want to be told immediately, so I know
   out-of-window templates won't work and that I must reconnect / get App Review.
2. As an operator whose grant is fine, I should see no false warning.
3. A failed permissions read must never block an otherwise-successful connect.

## Task report

- **`fetchGrantedPermissions`** — reads `/me/permissions` and returns the set of
  permissions whose `status === 'granted'` (declined ones excluded).
  - RED: `TypeError: fetchGrantedPermissions is not a function`
  - GREEN: `npx vitest run src/lib/facebook/oauth.test.ts` → 111 passed.
  - Guarantees: declined permissions are not treated as granted; token is sent to
    `/me/permissions`.
- **`isUtilityMessagingGranted`** — pure predicate over the granted set.
  - Guarantees: true only when `pages_utility_messaging` is present.
- **Callback wiring** — best-effort check after token exchange; redirects with
  `?warn=utility_messaging_missing`; a thrown permissions read is swallowed so
  connect still succeeds. Verified via `tsc --noEmit` (clean) + full FB suite.
- **`WarnBanner`** — renders the reconnect/App-Review guidance on the settings page.

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|--------------------|------|------|--------|----------|
| 1 | Only `granted` permissions are returned; `declined` excluded | `oauth.test.ts:returns only the granted permissions from /me/permissions` | unit | PASS | `vitest run src/lib/facebook/oauth.test.ts` |
| 2 | Token is passed to `/me/permissions` | `oauth.test.ts:sends the token to /me/permissions` | unit | PASS | same |
| 3 | Utility messaging reported granted only when present | `oauth.test.ts:reports utility messaging as granted only when present in the granted set` | unit | PASS | same |

## Coverage and known gaps

- Full FB suite green (`vitest run src/lib/facebook`); `tsc --noEmit` clean.
- **Gap:** the callback route handler and `WarnBanner` are wired but not unit-tested
  (route handler has heavy session/supabase/cookie deps); the testable decision
  logic lives in the two covered `oauth` helpers. Manual check: reconnect a page
  while declining `pages_utility_messaging` → settings shows the warning.
- This feature **diagnoses**; it does not grant the permission. Making templates
  actually submit still requires the Meta-side reconnect / App Review.

## Merge evidence (RED → GREEN)

- RED: `test: add reproducer for FB granted-permission scope check` — 3 failing
  (symbols undefined).
- GREEN: `fix: detect withheld pages_utility_messaging permission at connect` —
  111 passed.
- Wiring: `feat: warn on FB connect when utility-messaging permission withheld`.
