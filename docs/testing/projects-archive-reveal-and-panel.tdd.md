# TDD Evidence — Projects archive reveal fix + per-stage archive panel

**Date:** 2026-06-26
**Branch:** perf/classify-salvage-reply
**Source plan:** none — journeys derived during this TDD run from the user request.

## User journeys

1. As an operator, I want the **"Show archived"** toggle to actually reveal archived
   cards on the board, so I can review set-aside work. (Bug: clicking it did nothing.)
2. As an operator, I want to click a stage's **"N archived"** badge and get a
   **dedicated panel** listing that stage's archived projects, each with Unarchive,
   so I can manage archives without cluttering the board.

## Root cause (journey 1)

The reveal was routed through the URL: toggle → `?archived=1` → server re-render →
`showArchived` prop. That server round-trip did not reliably re-render the page
(the toggle button itself never changed state), so the board never revealed.
The board already fetches **every** project (archived included) — `fetchBoardProjects`
applies no archived filter — so the reveal never needed a server trip.

**Fix:** move the reveal to client state shared by the toolbar and board
(`ArchiveRevealProvider` / `useArchiveReveal`), seeded from `?archived=1` for
deep-links. Toggling is now instant and local.

## Task report

| Behavior | Validation command | RED → GREEN | Guarantee |
|---|---|---|---|
| Client toggle reveals without navigation | `vitest run _useArchiveReveal.test.tsx` | Import error (no module) → 4 pass | Toggle flips reveal in-process; `initial` honors deep-link; throws outside provider |
| Per-stage archive panel | `vitest run StageArchiveDrawer.test.tsx` | Import error (no module) → 6 pass | Lists archived projects, names stage, empty state, Unarchive calls action, row opens project, close fires onClose |

RED evidence: `Failed to resolve import "./_useArchiveReveal"` / `"./StageArchiveDrawer"` —
compile-time RED, the new tests reference not-yet-created implementations.
GREEN evidence: `Test Files 2 passed (2) / Tests 10 passed (10)`.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Reveal hidden by default | `_useArchiveReveal.test.tsx:hides archived cards by default` | unit | PASS |
| 2 | `?archived=1` deep-link reveals on load | `_useArchiveReveal.test.tsx:honors the initial value` | unit | PASS |
| 3 | Toggle flips reveal instantly, no navigation | `_useArchiveReveal.test.tsx:toggles the reveal instantly` | unit | PASS |
| 4 | Misuse outside provider throws | `_useArchiveReveal.test.tsx:throws when used outside the provider` | unit | PASS |
| 5 | Panel lists archived projects + customer | `StageArchiveDrawer.test.tsx:lists each archived project` | component | PASS |
| 6 | Panel heading names the stage | `StageArchiveDrawer.test.tsx:names the stage` | component | PASS |
| 7 | Empty state when no archives | `StageArchiveDrawer.test.tsx:shows an empty state` | component | PASS |
| 8 | Unarchive button calls `unarchiveProject(id)` | `StageArchiveDrawer.test.tsx:unarchives a project` | component | PASS |
| 9 | Row click opens the project | `StageArchiveDrawer.test.tsx:opens a project` | component | PASS |
| 10 | Close button fires onClose | `StageArchiveDrawer.test.tsx:closes when the close button is clicked` | component | PASS |

## Wiring (covered by tsc + lint, manual verification owed)

- `page.tsx` wraps toolbar+board in `ArchiveRevealProvider initial={params.archived}`.
- `ProjectsToolbar` toggle reads/sets `useArchiveReveal()` (no URL write).
- `ProjectBoardClient` reads `showArchived` from context; the stage "N archived"
  badge is now a button that opens `StageArchiveDrawer` for that stage.

## Coverage / known gaps

- `vitest run src/` — full suite green (see run log).
- `tsc --noEmit` — clean for touched files (only pre-existing unrelated `.next`
  validator errors for a messenger route remain).
- Gap: no E2E asserting the live board re-render in a browser session — owed as a
  manual check (toggle reveals; badge opens panel; Unarchive restores).
