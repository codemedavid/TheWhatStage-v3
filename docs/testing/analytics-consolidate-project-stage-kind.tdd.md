# TDD Evidence — Consolidate analytics project-stage axis by kind

**Date:** 2026-06-27
**Branch:** main
**Source plan:** none — journeys derived during this TDD run from the user's report
(screenshot showing the Analytics project-stage dropdown with ~43 entries, of which
6 were duplicate "Won").

## Problem

Each project/workspace defines its own `project_stages`, so a tenant's table holds
many rows named "Won", "Proposal", etc. The analytics RPCs ranked every row
individually via `row_number() over (order by position)`, so the Lead→Project
explorer and the project funnels showed **one rung per project stage** — e.g. six
separate "Won" entries — instead of one consolidated metric.

## User journeys

1. As an owner, I want a single "Won" metric aggregating all won stages across
   every project, so I see one source of truth.
2. As an owner, the project-stage axis everywhere on Analytics (explorer dropdown,
   Lead→Project funnel, Submission→Project funnel, value breakdown) should collapse
   to the curated kinds (Open / Won / Lost), not per-project duplicates.

## Decision

Consolidation strategy = **Group by `kind` (Open / Won / Lost)** (user-selected).
Forward ladder keeps Open(0) + Won(1); lost excluded from ladders, included in the
value breakdown.

## Task report

### Unit layer (CI-runnable, vitest)
Extracted the explorer's private `uniqueStages` dedupe into exported pure helpers
`leadStageRefs` / `projectStageRefs` in `src/lib/analytics/metrics.ts`, and wired
`CrossStageExplorer.tsx` to them.

- **RED:** `npx vitest run src/lib/analytics/metrics.test.ts`
  → `TypeError: projectStageRefs is not a function` (3 failing) — helpers didn't exist.
- **GREEN:** same command → **39 passed**. New test asserts kind-collapsed cells
  yield exactly one `won` rung (`refs.filter(r => r.kind==='won')` has length 1).

### SQL layer (the actual fix) — integration-verified against the live DB
New migration `supabase/migrations/20260627000000_analytics_consolidate_project_stage_kind.sql`:
adds `analytics_project_kind_rank` / `analytics_project_kind_label` (single source
of truth) and redefines the 5 project-stage RPCs to group the project axis by kind.
Monotonic "reached a rung = touched any stage of that kind or beyond" preserved.

Verified by calling the live RPCs as the affected tenant
(`set_config('request.jwt.claims', …)` + `set local role authenticated`):

| Guarantee | Before (RED) | After (GREEN) |
|---|---|---|
| crosstab distinct project rungs | 43 | **2** (Open, Won) |
| crosstab "Won" rungs | 6 | **1** |
| lead_to_project rungs | per-stage | Open=228, **Won=90** |
| submission_to_project rungs | per-stage | Open=225, Won=90 |
| project_stage_value rungs | per-stage | Open / Won / Lost (one each) |

**Independent correctness cross-check:** distinct projects whose current stage OR any
`project_stage_events.to_stage_id` is a won-kind stage = **90**, equal to the RPC's
`lead_to_project` Won = **90**. Drilldown (`analytics_lead_project_leads(…,0,1,…)`)
returns 87 *lead* rows (fewer than 90 *projects* because some leads own multiple won
projects — expected).

## Test specification

| # | What is guaranteed | Test | Type | Result | Evidence |
|---|--------------------|------|------|--------|----------|
| 1 | Crosstab cells collapse to one project rung per kind (single Won) | `metrics.test.ts > projectStageRefs … single Won rung` | unit | PASS | `vitest run src/lib/analytics/metrics.test.ts` |
| 2 | Lead rungs dedupe by rank, sorted | `metrics.test.ts > leadStageRefs …` | unit | PASS | same |
| 3 | Live crosstab returns exactly 1 Won rung (was 6) | RPC call as tenant | integration | PASS | supabase execute_sql |
| 4 | Won funnel count = true projects-touched-won (90) | RPC vs independent query | integration | PASS | supabase execute_sql |
| 5 | All 4 project-axis RPCs return kind rungs, no errors | RPC calls | integration | PASS | supabase execute_sql |

## Coverage / known gaps

- `npx vitest run src/lib/analytics/` → **45 passed**.
- Full `vitest run src/` → 16853 passed, 34 failed; **none** in
  analytics/metrics/CrossStage (pre-existing failures: action-pages/CAPI etc.).
- The RPCs have no automated CI test (no DB harness in-repo); they are covered by
  the live-DB integration evidence above. The CI-runnable unit tests guard the
  client dedupe contract the SQL now feeds.

## Migration note

Applied via Supabase MCP `apply_migration`, which records a fresh-timestamp history
row that does **not** match the file version `20260627000000` (known repo pattern —
see memory `mcp-migration-version-reconcile` / `projects-feature-migration-state`).
The file is the source of truth; reconcile before any `db push`/`db reset`.
The three funnel/value RPCs changed `stage_id` from `uuid` to `text` (now the kind);
the TS mapping layer already stringifies it, so no client type change was required.
