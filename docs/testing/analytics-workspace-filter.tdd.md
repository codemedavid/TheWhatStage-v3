# TDD — Per-workspace analytics filtering

**Branch:** `feat/analytics-workspace-filter`
**Date:** 2026-06-26

## Problem

Projects live in workspaces ("project managements", migration `20260626120000`), but
the analytics suite predates workspaces and aggregates every workspace together. Once a
user has more than one workspace the conversion / Won numbers are crowded — there's no
way to see "Won across all projects in *this* workspace".

## Decision

Add an optional `p_workspace_id uuid` to the **seven project-touching** analytics RPCs.
`NULL` = all workspaces (original behaviour); a value scopes the `projects` and
`project_stages` CTEs to that workspace. The lead-side RPCs
(`analytics_lead_funnel`, `analytics_lead_stage_distribution`) are intentionally left
unchanged — leads and `pipeline_stages` have no `workspace_id`, so they stay
account-wide and the toolbar keeps lead-stage cards global.

Adding a parameter creates a new overload (not a replace), which makes calls ambiguous,
so each function is `drop`ped at its old signature before being recreated.

## Tests (RED → GREEN)

| Test | File | What it locks |
|---|---|---|
| `rpcArgs` never emits `p_workspace_id` | `src/lib/analytics/rpc-args.test.ts` | lead-side RPCs stay account-wide |
| `projectRpcArgs` emits `p_workspace_id` (null when unset, value when set) | same | project RPCs carry the workspace scope |
| `AnalyticsQuery` preserves a valid workspace uuid | `analytics/_lib/schemas.test.ts` | URL param round-trips |
| `AnalyticsQuery` drops a non-uuid workspace | same | bad input falls back safely, never throws |

`npx vitest run src/lib/analytics analytics/_lib/schemas.test.ts` → 48 passed.
`npx tsc --noEmit` → clean. `npm run build` → success.

## Data verification (remote)

Functions self-scope to `auth.uid()` so they can't be invoked as the service role; the
core "Won" predicate was replicated directly against a real tenant with 4 workspaces:

```
won (all workspaces)            = 77
Welcome / JAD / Jeremie / Ibrahim 2 = 76 / 0 / 0 / 1  → sum 77 ✓
```

Per-workspace counts sum to the all-workspaces total, and the split is meaningful
(76 vs 1) — confirming the filter de-crowds without losing or double-counting projects.

`pg_proc` check: all 7 project RPCs have exactly one overload (with `p_workspace_id`);
the 2 lead-side RPCs retain their 4-arg signature — no overload ambiguity.

## Migration apply note

Applied to remote via MCP `execute_sql` (idempotent `drop ... if exists` + recreate), so
the remote has the new functions but **no migration-history row** for file version
`20260626130000` — consistent with the rest of the analytics suite. A `db push`/`reset`
re-runs the file harmlessly.
