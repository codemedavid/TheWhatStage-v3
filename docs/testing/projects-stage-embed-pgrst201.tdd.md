# TDD Evidence — Projects PGRST201 ambiguous embed regression

**Date:** 2026-06-26
**Task:** Fix the Server Components render error on Projects management
(`PGRST201 — Could not embed because more than one relationship was found for
'projects' and 'project_stages'`).
**Source:** Bug report (runtime error), not a `*.plan.md`. Journeys derived during this run.

## Root cause

The workspaces migration (`20260626120000_project_workspaces.sql`) added a second
foreign key from `projects` to `project_stages`:

- `projects_stage_id_fkey` — `projects(stage_id) → project_stages(id)` (original)
- `projects_workspace_stage_fk` — `projects(workspace_id, stage_id) → project_stages(workspace_id, id)` (new; keeps a card's workspace aligned with its stage)

With two relationships between the tables, PostgREST can no longer resolve a bare
`project_stages(...)` embed and rejects the **entire** query with `PGRST201`. Every
`.from('projects').select('… project_stages(…) …')` call broke — not only the
projects board, but two chatbot-critical paths and the action-pages submissions view.

## User journeys

1. As a user, I open Projects management and the board renders instead of the
   Server Components error.
2. As the chatbot, I resolve a lead's active project (and its stage) without the
   query throwing, so follow-up alignment keeps working.
3. As a user, I view action-page submissions and see each submission's linked
   project stage.

## Fix

Name the relationship on every projects→stage embed:
`project_stages!projects_stage_id_fkey(...)`. The simple `stage_id` relationship
resolves to the same stage and matches pre-workspaces behavior. Centralized as
`STAGE_EMBED` (`src/lib/projects/stage-embed.ts`) so the four call sites share one
documented, disambiguated token and future embeds can't reintroduce the bug.

Call sites updated:

- `src/lib/agent/loadContext.ts` (bot context — per-lead project instructions)
- `src/lib/projects/active-project.ts` (bot active-project resolution)
- `src/app/(app)/dashboard/action-pages/_lib/queries.ts` (submissions → project)
- `src/app/(app)/dashboard/projects/_lib/queries.ts` (`PROJECT_SELECT`, the board)

## Task report

| Step | Command | Result |
|---|---|---|
| RED | `npx vitest run src/lib/projects/stage-embed-disambiguation.test.ts` | **4 failed** — each call site still had a bare `project_stages(` embed |
| GREEN | same command after fix | **4 passed** |
| Scope guard | `rg -n "[^!a-z_]project_stages\(" src --type ts -g '!*.test.*'` | only the doc comment in `stage-embed.ts`; no remaining bare embeds |
| Typecheck | `npx tsc --noEmit` | exit 0 |
| Related suites | `npx vitest run src/lib/projects src/lib/agent .../projects .../action-pages` | **248 passed (44 files)** |

## Test specification

| # | What is guaranteed | Test file | Type | Result |
|---|--------------------|-----------|------|--------|
| 1 | `loadContext.ts` has no ambiguous `project_stages(` embed | `src/lib/projects/stage-embed-disambiguation.test.ts` | unit (source scan) | PASS |
| 2 | `active-project.ts` has no ambiguous embed | same | unit | PASS |
| 3 | action-pages `queries.ts` has no ambiguous embed | same | unit | PASS |
| 4 | projects `queries.ts` (`PROJECT_SELECT`) has no ambiguous embed | same | unit | PASS |

The regression guard is a **source scan**: the bug is a PostgREST schema-resolution
error that only manifests against the live API with both FKs present, so it cannot
be reproduced by mocked-client unit tests. The scan locks every known embed site to
the FK-qualified form and fails if any reverts to a bare embed.

## Coverage / known gaps

- No automated end-to-end test hits the live PostgREST API. **Recommended manual
  smoke:** load `/dashboard/projects/<workspace>`, send a chatbot message to a lead
  with an active project, and open an action-page submissions view — all should
  render without `PGRST201`.
- A new projects→stage embed in a *new* file would not be covered by the scan list;
  the shared `STAGE_EMBED` constant is the primary defense, the scan is the backstop.

## Out of scope (left untouched)

The working tree also contains in-progress workspaces-UI rework by the user
(`WorkspacesView.client.tsx`, `workspace-view.ts/.test.ts`, edits to `page.tsx`,
`workspaces.ts`, `types.ts`, `globals.css`; `WorkspacesGrid.client.tsx` deleted).
That work is unrelated to this embed fix and was not modified or committed here.
