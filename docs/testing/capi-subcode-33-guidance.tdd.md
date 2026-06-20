# TDD Evidence — CAPI test event subcode 33 actionable error

**Date:** 2026-06-20
**Branch:** feat/projects-filters-search-stats
**Files:** `src/lib/facebook/capi.ts`, `src/lib/facebook/capi.test.ts`

## Source plan

No `*.plan.md` was provided. Journeys were derived during this TDD run from a
production bug report: the "Send test event" button (and real action-page
submissions) fail with:

> Test event rejected by Meta: Unsupported post request. Object with ID
> '594066603333964' does not exist, cannot be loaded due to missing
> permissions, or does not support this operation. … (subcode 33)

## Diagnosis (root cause)

Graph API **error code 100 / subcode 33** on the CAPI events endpoint
(`POST https://graph.facebook.com/v24.0/{DATASET_ID}/events`) means Meta cannot
resolve the dataset id in the request path with the supplied access token. The
endpoint and the business-messaging payload (`action_source: "business_messaging"`,
`messaging_channel: "messenger"`, `user_data.page_id` + `page_scoped_user_id`)
are **correct** per Meta's docs and the existing subcode handling
(2804064/65/66). Subcode 33 is therefore a **Meta-side configuration problem**,
not a code bug:

- the Dataset ID doesn't exist (e.g. a Page ID or wrong number was pasted), or
- the access token wasn't generated with permission for that dataset, or
- the dataset isn't connected to the Page / ad account in Business settings.

References:
- https://developers.facebook.com/community/threads/934812495415428/ (code 100 subcode 33)
- https://learn.doubletick.io/conversion-api/fix-facebook-conversion-events-error-in-your-doubletick-bot
- https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/

## Change

The only defensible code change: the prior behaviour surfaced Meta's raw,
unactionable string ("Unsupported post request. Object with ID … does not
exist…"). `extractErrorMessage` now detects subcode 33 and returns concrete,
operator-facing remediation steps instead — consistent with the function's
existing goal of making misconfigurations diagnosable from the settings UI.

**This change does not make the test event succeed.** The event still fails
until the dataset/token/permission config is corrected on Meta's side; the new
message now tells the operator exactly what to check.

## Task report

| Behaviour | Validation command | RED | GREEN |
|---|---|---|---|
| Subcode 33 → actionable dataset/permission guidance, not Meta's raw text | `npx vitest run src/lib/facebook/capi.test.ts` | FAIL (returned `Unsupported post request. Object with ID '594066603333964' does not exist…`) | PASS |

RED excerpt:
```
× translates subcode 33 (dataset not found / no permission) into actionable guidance
AssertionError: expected 'Unsupported post request. Object with…' to match /dataset id/i
Test Files  1 failed | 14 passed (15)
Tests  1 failed | 166 passed (167)
```

GREEN excerpt:
```
Test Files  15 passed (15)
Tests  167 passed (167)
```

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Subcode 33 error_message names the Dataset ID, permission, and "connected to this Page", appends "subcode 33", and omits Meta's raw "Unsupported post request" | `src/lib/facebook/capi.test.ts:translates subcode 33 (dataset not found / no permission) into actionable guidance` | unit | PASS |
| 2 | Existing subcode handling (2804065 title/msg), 2xx/4xx logging, network failure, test_event_code, lead hashing — all unchanged | `src/lib/facebook/capi.test.ts` (12 existing) | unit | PASS |

## Coverage and known gaps

- Typecheck: `npx tsc --noEmit` — no errors in `capi.ts`.
- Lint: one pre-existing `@typescript-eslint/no-explicit-any` on the internal
  `Admin` type shim (`from: (table: string) => any`), unrelated to this change.
- Not addressed in code (cannot be — it's a Meta dashboard fix): the actual
  dataset/token/permission misconfiguration that causes subcode 33.
