# TDD Evidence — Analytics lead funnel "totally wrong" fix

**Date:** 2026-06-25
**Branch:** (work done on `perf/classify-salvage-reply`; intended for its own branch/PR)
**Trigger:** `/ecc:tdd-workflow` — user: "the current analytics has flaws and unreliable… doesn't give me the real result at all." Clarified to: **Main Analytics dashboard**, **inaccurate vs the real data**, **totally wrong / unusable**.

## Source plan

Journeys derived during this TDD run (no `*.plan.md`). Diagnosis was evidence-based against the live database.

## Root cause (verified against production data)

The `/dashboard/analytics` **KPI cards are accurate** (for tenant `1c1f133e`: leads 1,115, projects 161, won 59, won value ₱44,645 — all match raw table counts). Date filtering is also sound: every `created_at` is `timestamptz`, so `(created_at at time zone 'Asia/Manila')::date` buckets correctly.

The **lead "Stage journey" funnel** (and the cross-stage explorer's lead axis) was garbage. The funnel (`analytics_lead_funnel`) orders stages by **kanban column position** and relies on each stage's `kind` to (a) exclude off-ramps (`lost`/`objection`/`dormant`) and (b) treat `won` as terminal. But:

- `pipeline_stages.kind` DB **default is `'nurture'`** (`20260521000000_pipeline_stage_semantics.sql`).
- The lead stage editor (`StageManager.tsx` → `createStage`) **never sets `kind`** — no UI picker — so every custom column silently becomes `nurture`. (Project stages *do* have a kind picker, which is why project-side numbers are correct.)
- Result for tenant `1c1f133e` (all 11 columns `nurture`): the monotonic funnel counted "Unqualified"/"Lost" as forward progress past "Won" and reported **"286 reached Won"** when only **26** leads are in Won. ~9 of 22 tenants are affected.

## User journeys

1. As an operator, I open Analytics and the lead-stage numbers match the kanban board I actually use.
2. As an operator with a fully-custom (all-`nurture`) board, the lead-stage view is still correct — no setup required.
3. As an operator, the dashboard defaults to a recent window (this week) rather than a stale "this month" default.

## Fix (user chose "Match my kanban board" + default range "this week")

- **New RPC** `analytics_lead_stage_distribution(p_from,p_to,p_source,p_campaign)` — current lead count per pipeline stage, in board order, **not** monotonic, never reads `kind`. Migration `20260625000000_analytics_lead_stage_distribution.sql` (idempotent `create or replace`; applied to remote via MCP).
- **New pure helpers** in `metrics.ts`: `buildStageDistribution` (share + relative bar width, board-ordered) and `stageKindGroup` (won / lost / active for tinting; degrades to `active` for uncurated kinds).
- **New `StageDistribution.tsx`** server component → "Where your leads are now".
- `leads-analytics.ts`: `getLeadStageDistribution`. `page.tsx`: swapped the broken lead funnel for the distribution; dropped the `getLeadFunnel` call (function/RPC left in place, unused).
- **Default range** `month → week` (`schemas.ts`).

## Task report

| Behavior | Validation command | RED | GREEN |
|---|---|---|---|
| `buildStageDistribution` keeps current counts (no monotonic inflation), board order, share/barPct | `npx vitest run src/lib/analytics/metrics.test.ts` | FAIL — `buildStageDistribution` not exported (8 tests) | PASS |
| `stageKindGroup` maps won / off-ramps / uncurated | same | FAIL | PASS |
| `AnalyticsQuery` defaults range to `week` | `npx vitest run .../analytics/_lib/schemas.test.ts` | FAIL — `expected 'month' to be 'week'` (2 tests) | PASS |
| RPC returns the real board (Won=26, Lost=48, Σ=1115), not 286 | `mcp__supabase__execute_sql` (RPC body, tenant `1c1f133e`) | — | PASS (187/285/316/9/32/26/48/48/96/43/25 = 1115) |

RED evidence (combined run): `Tests 10 failed | 29 passed`, e.g. `AssertionError: expected 'month' to be 'week'`.
GREEN evidence: `Test Files 2 passed (2) · Tests 39 passed (39)`.

## Test specification

| # | Guarantee | Test | Type | Result |
|---|---|---|---|---|
| 1 | Stage distribution shows each stage's CURRENT count, not "reached or beyond" | `metrics.test.ts > buildStageDistribution > keeps each stage current count` | unit | PASS |
| 2 | Rows ordered by board position regardless of input order | `…> orders rows by board position` | unit | PASS |
| 3 | `share` = % of cohort; `barPct` relative to largest stage; zero-safe | `…> computes share / barPct / handles empty…` | unit | PASS |
| 4 | `stageKindGroup` won/off-ramp/active mapping | `metrics.test.ts > stageKindGroup` | unit | PASS |
| 5 | Default range is `week`; invalid → `week`; explicit preserved | `schemas.test.ts > AnalyticsQuery` | unit | PASS |

## Coverage / verification

- `npx tsc --noEmit` → exit 0.
- `npx vitest run src/lib/analytics 'src/app/(app)/dashboard/analytics'` → 39 passed.
- Tests scoped to `src/` (bare `vitest` also scans nested fleet worktrees — see project memory).

## Known gaps / follow-ups

- **Cross-stage explorer** (`CrossStageExplorer` / `analytics_lead_project_crosstab`) shares the same root cause: its **lead-stage axis** still uses the monotonic "leads reaching lead stage X" denominator, which is inflated for all-`nurture` tenants. Not in this change's agreed scope ("match the board" doesn't map cleanly onto a cross-tab). Needs its own decision.
- **Durable fix for `kind`**: adding a `kind` picker to the lead stage editor (mirroring project stages) + a backfill would let the *furthest-reached* funnel and the cross-tab become meaningful again. Deferred per user's choice of the board-matching approach.
- RPC correctness validated by reproducing the function body against live data; not covered by an automated DB test (consistent with the rest of the analytics SQL suite).
