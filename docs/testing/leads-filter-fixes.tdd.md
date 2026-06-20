# TDD Evidence — Leads Management Filter Fixes

**Date:** 2026-06-20
**Scope:** `src/app/(app)/dashboard/leads/**`, migration `20260620002015_leads_last_activity_at`

## Source plan

Journeys derived during this TDD run from the user request: *"fix leads management —
switching the This week / All time filters just keeps refreshing, the dates are not
accurate, and we want to see leads we interacted with today, not only newly created leads."*

## User journeys

1. **As an operator**, when I switch the date-range preset (Today / This week / This month /
   All), the board updates once and settles — it does not refresh endlessly.
2. **As an operator**, the Today / This week / This month windows match my wall clock
   (Asia/Manila), so a lead created at 1am Manila shows under "Today", not yesterday.
3. **As an operator**, a date preset shows leads I *interacted with* in that window
   (a message in or out), not only leads created in it.

## Task report

### 1. Refresh loop (Journey 1)
- **Summary:** `useUrlState.set` depended on `sp` (new identity every navigation), so the
  Toolbar's debounced search effect re-ran after each nav and pushed another
  `router.replace`, causing an endless RSC refetch loop when a filter changed. Stabilized
  `set` via a ref to the latest search params, and guarded the search effect to fire only
  when the typed value differs from the URL.
- **Files:** `_components/_useUrlState.tsx`, `_components/Toolbar.tsx`
- **Validation:** `npx tsc --noEmit` → 0 errors; `npx vitest run src/app/(app)/dashboard/leads` → 423 passed.
- **Guarantee:** `set` keeps a stable identity across navigations; effects depending on it
  no longer self-trigger.

### 2. Date accuracy (Journey 2)
- **Summary:** Day bounds were built as `${day}T00:00:00Z` (UTC) while presets were derived
  from server-local (UTC on Vercel) time. Re-anchored `resolveDateRange` to the Asia/Manila
  calendar and convert day strings to precise UTC instants via new `day-bounds` helpers.
- **Files:** `_lib/date-range.ts`, `_lib/day-bounds.ts` (new)
- **Validation (RED→GREEN):**
  - `day-bounds.test.ts` — RED: module did not exist (compile failure). GREEN after impl.
  - `date-range.test.ts` — added cross-midnight case (`2026-06-19T16:30Z` → Manila `2026-06-20`).
  - `npx vitest run …/_lib/day-bounds.test.ts …/_lib/date-range.test.ts` → pass.
- **Guarantee:** `manilaDayStartIso('2026-06-20') === '2026-06-19T16:00:00.000Z'`;
  presets track the Manila day regardless of process timezone.

### 3. Interacted-today (Journey 3)
- **Summary:** Date filters keyed on `created_at` only. Added denormalized
  `leads.last_activity_at = max(created_at, messenger thread last_message_at)`, maintained by
  an `AFTER INSERT/UPDATE` trigger on `messenger_threads`, and switched all leads date filters
  + CSV export to `last_activity_at`.
- **Files:** migration `20260620002015_leads_last_activity_at.sql`, `_lib/queries.ts`,
  `actions/export.ts`
- **Validation (RED→GREEN):**
  - `queries.test.ts` "fetchLeadsTotal date window" — RED: asserted `last_activity_at` bounds
    while code filtered `created_at` (`expected … to contain ['last_activity_at', …]`). GREEN after impl.
  - Migration applied via Supabase MCP (version `20260620002015`). Backfill: 679 leads,
    472 bumped by activity, 0 nulls.
  - Trigger live-tested in a self-rolling-back `DO` block: thread `last_message_at` advanced →
    lead `last_activity_at` followed (`TRIGGER_OK before=2026-06-17… after=2026-06-23…`).
- **Guarantee:** leads queries surface leads whose conversation moved within the window, not
  only newly-created leads; the denormalized column stays current as threads advance.

## Test specification

| # | What is guaranteed | Test file | Type | Result | Evidence |
|---|--------------------|-----------|------|--------|----------|
| 1 | Manila day → correct UTC instant bounds | `_lib/day-bounds.test.ts` | unit | PASS | `vitest run …/day-bounds.test.ts` |
| 2 | Presets anchor to Manila calendar (incl. cross-midnight) | `_lib/date-range.test.ts` | unit | PASS | `vitest run …/date-range.test.ts` |
| 3 | Leads date filter uses `last_activity_at` + Manila bounds | `_lib/queries.test.ts` | unit | PASS | `vitest run …/queries.test.ts` |
| 4 | Trigger advances `last_activity_at` with thread activity | live `DO` block (MCP) | integration | PASS | rolled-back probe `TRIGGER_OK` |

## Coverage and known gaps

- `npx vitest run src/app/(app)/dashboard/leads` → **78 files / 423 tests passed**.
- `npx tsc --noEmit` → **0 errors**.
- Gaps: the refresh-loop fix is verified by type/behavioral reasoning + full suite, not a
  dedicated DOM render test (would require simulating Next navigation). Sort order still keys
  on `created_at` (unchanged by design); only the date *filter* moved to `last_activity_at`.
