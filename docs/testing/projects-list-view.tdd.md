# TDD Evidence — Projects List View

**Date:** 2026-06-26
**Source plan:** none — journeys derived during this TDD run from a reference screenshot (status-grouped table: Project Name / Client / Description / Deadline / People / Priority, with Kanban·List·Calendar tabs).

## Decisions

- **No DB changes.** The board has no `deadline` or `priority` column, so the List view *derives* both from existing data: Deadline = `updated_at`; Priority = stage kind (Won/Lost) or value bands for open projects.
- **View switcher = Kanban + List only.** Calendar deferred (separate, larger feature). Choice persists in the URL via `?view=list` (`kanban` is the default and stays out of the URL).

## User journeys

1. As an operator, I want to switch the projects board between a Kanban and a List view, so I can scan deals as a dense table.
2. As an operator, I want the List view grouped by stage with collapsible sections and per-stage totals, so I can focus on one stage at a time.
3. As an operator, I want each row to show client, description, last-touched date, the lead avatar, and a priority badge, and to open the existing project drawer on click.
4. As an operator, I want to create a project into a specific stage from its group header.

## Task report

| Behavior | Validation command | Result | Guarantee |
|---|---|---|---|
| `formatListDate` renders a short date and degrades to `—` on empty/invalid input | `npx vitest run …/_lib/list-view.test.ts` | RED→GREEN (3 tests) | Deadline column never shows "Invalid Date". |
| `deriveProjectPriority` maps won/lost → outcome badge, open → High/Medium/Low by value, null value/kind handled | same | RED→GREEN (7 tests) | Priority badge is deterministic and total. |
| Full projects suite unaffected | `npx vitest run "src/app/(app)/dashboard/projects/"` | 80 passed | No regression in existing board/stats/toolbar logic. |
| Types + lint clean | `npx tsc --noEmit` (scoped grep), `npx eslint <new files>` | 0 errors | New components type-check and lint clean. |

- RED evidence: first `vitest run` failed to import `./list-view` (module absent) — the intended missing-implementation signal.
- GREEN evidence: after implementing `_lib/list-view.ts`, all 10 helper tests passed.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Valid ISO → "Jun 8, 2025"-style label | `list-view.test.ts:formatListDate › formats a valid ISO date` | unit | PASS |
| 2 | Empty/invalid date → `—` | `list-view.test.ts:formatListDate › returns an em dash …` | unit | PASS |
| 3 | Won/Lost stage → outcome badge regardless of value | `list-view.test.ts:deriveProjectPriority › reports Won/Lost …` | unit | PASS |
| 4 | Open project value bands → High/Medium/Low | `list-view.test.ts:deriveProjectPriority › reports High/Medium/Low …` | unit | PASS |
| 5 | Null value / null stage kind handled | `list-view.test.ts:deriveProjectPriority › treats a missing …` | unit | PASS |

## Coverage & known gaps

- Pure helpers (`list-view.ts`) are fully unit-covered. The two new client components (`ProjectListView.client.tsx`, `ProjectViews.client.tsx`) are presentational wrappers over already-tested primitives (`splitStageProjects`, `ProjectDrawer`, `UnreadBadge`) and were not given component tests in this pass.
- **Follow-up owed:** live browser verification of the List view (rendering, group collapse, view switch, drawer open) — not run here (requires an authenticated session). Priority/Deadline are heuristic stand-ins; revisit if real `deadline`/`priority` columns are ever added.
