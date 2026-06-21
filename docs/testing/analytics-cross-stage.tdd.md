# TDD Evidence — Analytics cross-stage + redesign

**Date:** 2026-06-21
**Branch:** `feat/analytics-cross-stage`
**Source plan:** none — journeys derived during this TDD run from the user request
("Lead stage → project stage ratio filter" + full UI/UX overhaul + period
comparison, export, drill-down, stage breakdowns).

## User journeys

1. As a sales manager, I want to pick a lead stage and a project stage and see
   what % of leads that reached the first also reached the second, so I know how
   qualified leads convert to won deals.
2. As a manager, I want each KPI compared to the previous equal-length period.
3. As an analyst, I want to export the lead→project cross-tab as CSV.
4. As a manager, I want to drill from a number into the actual leads behind it.
5. As an operator, I want a clearer, more polished, more usable dashboard.

## Task report

| Behaviour | Validation command | RED | GREEN |
|-----------|--------------------|-----|-------|
| Pure metrics (period, delta, crosstab lookup, CSV) | `npx vitest run src/lib/analytics` | 13 new tests failed — functions undefined (compile-time RED) | 28/28 pass |
| Cross-tab RPC correctness | live tenant replay via Supabase SQL | n/a | monotonic: lead totals 654→…→10; per-project numerator decreases; Qualified→Won = 33/389 |
| Type safety of new wrappers/components | `npx tsc --noEmit` | — | exit 0 |
| Lint of changed surface | `npx eslint <analytics dirs>` | — | exit 0 |

The RED gate (Step 3) was satisfied at compile time: the new tests referenced
`previousPeriod`, `computeDelta`, `formatDelta`, `crosstabLookup`, `toCsv` before
they existed, so the suite failed to resolve them (13 failures). They then passed
after implementation (Step 5).

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | `previousPeriod` returns the immediately-preceding equal-length range; null for all-time/inverted | `metrics.test.ts > previousPeriod` | unit | PASS |
| 2 | `computeDelta` gives abs+pct+direction; null pct when baseline is 0 | `metrics.test.ts > computeDelta` | unit | PASS |
| 3 | `formatDelta` renders signed %, "New" (no baseline), "No change" (flat) | `metrics.test.ts > formatDelta` | unit | PASS |
| 4 | `crosstabLookup` finds a cell and derives pct + ratio; zeros when absent | `metrics.test.ts > crosstabLookup` | unit | PASS |
| 5 | `toCsv` joins rows and RFC-4180-escapes commas/quotes/newlines | `metrics.test.ts > toCsv` | unit | PASS |

## Coverage and known gaps

- `npm test` is `vitest run`; scope to `src/lib/analytics` (a bare run also picks
  up failing tests from nested `WhatStage_worktrees/*`).
- Pure analytics math is fully unit-tested. SQL RPCs are validated by live-tenant
  replay (not a unit test — they gate on `auth.uid()`).
- **Not automated:** React component rendering and the drill-down server action
  (no component/E2E test was added this pass). Follow-up: Playwright E2E for the
  explorer + drill-down modal.
- **Intentional data limitation:** "time-in-stage" was deliberately NOT built —
  `lead_stage_events` is incomplete (manual kanban moves bypass it), so the
  stage-level breakdown ships as value-contribution-per-stage (solid current-stage
  data) instead. See memory `analytics-incomplete-stage-event-log`.

## Merge evidence

Checkpoint commits on `feat/analytics-cross-stage`:
- `a1f64c9` test+feat: pure metrics (RED 13 fail → GREEN 28 pass)
- `a052e0b` feat: cross-tab / drill-down / stage-value RPCs + wrappers
- `4544eb7` feat: full dashboard redesign + explorer/export/drill-down/breakdown
