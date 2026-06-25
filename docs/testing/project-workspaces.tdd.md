# TDD Evidence — Multiple project workspaces ("project managements")

**Date:** 2026-06-26
**Branch:** perf/classify-salvage-reply
**Source plan:** `/ecc:plan` conversational plan (this session).

## User journeys

1. As an operator, I want **multiple workspaces**, each with its OWN stages, follow-ups,
   and projects, so I can run different kinds of work on separate boards.
2. As an operator, I want to **create a workspace from scratch** (seeded with default
   stages) **or duplicate** an existing one — copying its stages, sequences, follow-ups,
   and settings, but **not** the projects in it.
3. As an operator, I want to **transfer a project (card) to another workspace** and manage
   it there.
4. As an existing user, all my current stages + projects must land in a default **"Welcome"**
   workspace so nothing moves out from under me.
5. Deleting a workspace must be **blocked until it is empty**, and the default workspace must
   never be deletable.

## Data model

New `project_workspaces` container (one default per user). `project_stages` and `projects`
each gain `workspace_id`. A composite FK `projects(workspace_id, stage_id) →
project_stages(workspace_id, id)` makes it structurally impossible for a card's workspace to
drift from its stage's workspace — the key integrity guarantee that makes transfers safe.
One default STAGE per workspace (partial unique index, was per-user). Migration
`20260626120000_project_workspaces.sql` backfills a Welcome workspace per existing user and
adopts all their stages + projects; a `duplicate_project_workspace` SECURITY INVOKER RPC
clones stages + sequences + steps atomically (no cards/runs/events).

## Routing (lowest-churn topology)

| Path | Role |
|---|---|
| `/dashboard/projects` | Workspaces index (manage/create/duplicate) + `?project=` redirect shim |
| `/dashboard/projects/[workspaceId]` | The Kanban board for one workspace |
| `/dashboard/projects/stages/[stageId]` | Stage detail — **unchanged path** (stageId is globally unique) |

Legacy `/dashboard/projects?project=<id>` deep-links (lead drawer, "Mark as project", stage
leads list) keep working: the index resolves the card's `workspace_id` and 308-redirects to
its board with the drawer open.

## Task report

| Behavior | Validation command | RED → GREEN | Guarantee |
|---|---|---|---|
| Workspace pure rules + data layer | `vitest run _lib/workspaces.test.ts` | Import error (no module) → 13 pass | copy-name cap, delete guard (default + non-empty), summary fold, default-stage fallback, deep-link workspace lookup |
| No regression in touched suites | `vitest run projects src/lib/projects` | 91 pass | board split, stats, toolbar, archive drawer fixtures carry `workspace_id` |

RED evidence: `Failed to resolve import "./workspaces"` — compile-time RED, the tests
reference the not-yet-created `_lib/workspaces.ts`.
GREEN evidence: `Test Files 11 passed (11) / Tests 91 passed (91)`.

## Test specification

| # | What is guaranteed | Test | Result |
|---|--------------------|------|--------|
| 1 | Duplicate copy defaults to "Copy of {name}" | `workspaces.test.ts:prefixes "Copy of"` | PASS |
| 2 | Copy name capped at 60 chars | `workspaces.test.ts:caps the result at the 60-char name limit` | PASS |
| 3 | Default workspace can't be deleted | `workspaces.test.ts:blocks the default workspace` | PASS |
| 4 | Non-empty workspace blocked + names the count | `workspaces.test.ts:blocks a non-empty workspace and names the count` | PASS |
| 5 | Empty non-default workspace deletable | `workspaces.test.ts:allows deleting an empty, non-default workspace` | PASS |
| 6 | Default guard wins even when empty | `workspaces.test.ts:blocks default even when empty` | PASS |
| 7 | Summary folds stages/projects/value per workspace | `workspaces.test.ts:counts stages and projects ... sums non-archived value` | PASS |
| 8 | Empty workspace → zeroed counts, order preserved | `workspaces.test.ts:returns zeroed counts ... preserves order` | PASS |
| 9 | Default-stage resolution uses the flagged default | `workspaces.test.ts:returns the flagged default stage when present` | PASS |
| 10 | Falls back to lowest-position stage when no flag | `workspaces.test.ts:falls back to the lowest-position stage` | PASS |
| 11 | Null when workspace has no stages | `workspaces.test.ts:returns null when the workspace has no stages at all` | PASS |
| 12 | Deep-link resolves a card's workspace | `workspaces.test.ts:returns the card's workspace for the deep-link redirect` | PASS |
| 13 | Null when card missing/not owned | `workspaces.test.ts:returns null when the card is missing or not owned` | PASS |

## Wiring (covered by tsc + next build, manual/remote verification owed)

- `actions/workspaces.ts`: create (seeds default stages), duplicate (RPC), update, delete
  (guarded), reorder, `moveProjectToWorkspace` (lands in dest default stage, cancels old run,
  seeds new, writes a stage event) — all return `ActionResult`/`VoidActionResult`.
- `actions/stages.ts`: `createProjectStage(workspaceId, …)` + per-workspace default-stage
  resolution on delete. `actions/projects.ts`: `createProject` derives `workspace_id` from its
  stage; submission/lead paths use `ensureDefaultWorkspace` + `resolveDefaultStageId`.
- UI: workspaces index grid, board route with `WorkspaceSwitcher`, `WorkspaceSettingsDrawer`
  (create/edit/delete), "Move to workspace" in the project drawer.

## Adversarial review (multi-agent) + fixes

A 5-dimension adversarial review (migration safety · security/RLS · data-flow integrity ·
routing/compat · React/UI) produced 15 findings; all were addressed:

- **Migration** — DDL made idempotent (`if not exists` / `create or replace` / constraint
  do-blocks); backfill join now also matches `user_id` (cross-user stage refs left NULL, not
  silently misplaced); RPC EXECUTE revoked from `public` **and** `anon` (Supabase grants anon by
  default), so only `authenticated` can call it.
- **Integrity** — `moveProjectToWorkspace` now repairs a half-applied transfer on retry via
  `ensureProjectSequenceRun` (seeds only when no active run exists), and the `project_stage_events`
  insert error is captured/logged in both move paths instead of swallowed.
- **Security** — explicit `.eq('user_id', userId)` added to every `projects` mutation
  (update/delete/archive/unarchive/move) as defense-in-depth beside RLS; `createProject` now
  verifies `origin_submission_id` ownership; dead `fetchWorkspacesCached`/`workspacesTag` removed.
- **Routing** — the index forwards legacy filtered-board deep-links (`?q/?sort/?range/?archived`)
  to the default workspace board and strips a stale `?project=`; the board self-heals a `?project=`
  whose card has moved to another workspace.
- **UI** — the switcher surfaces a failed duplicate; the project-drawer workspace transfer is gated
  behind a `confirm()` (native `<select>` could otherwise transfer on an accidental wheel/arrow).

## Coverage / known gaps

- `tsc --noEmit` — clean (0 errors). `next build` — succeeds; all three routes registered.
  `vitest run` (projects + lib/projects) — 84 pass.
- **Migration APPLIED to remote** via `mcp__supabase__apply_migration` (records a history row).
  Post-apply verification on live data: 2 Welcome workspaces (1/user), 0 null `workspace_id`,
  **0 workspace/stage mismatches**, 0 workspaces with >1 default stage, composite FK + RPC present,
  RLS on, `search_path` pinned, `anon` cannot execute the RPC. Pre-apply data was clean
  (0 cross-user stage refs, 0 orphan projects), so the backfill populated every row.
- Gap: server actions (move/duplicate/delete) are validated by tsc + pure/data-layer unit tests +
  adversarial review + live schema checks, not by an automated end-to-end DB test — owed as a quick
  manual pass in the UI (create → duplicate → transfer a card → delete-blocked-until-empty).
