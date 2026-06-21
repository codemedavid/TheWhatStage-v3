# TDD Evidence — Fast project archive + read-messages quick actions (on cards)

**Date:** 2026-06-22 · **Branch:** feat/analytics-cross-stage

## Source plan
No `*.plan.md`. Journeys derived during this TDD run from two requests:
1. "When I click a project, show an Archive (green) button plus a Read-messages
   button to read unread messages fast, with good UI/UX."
2. Follow-up: "I want it shown **in the cards, not on the drawer**, to make it
   accessible quickly."

## User journeys
1. As an operator, each board card surfaces a **green Archive** button (revealed
   on hover) so I can declutter the board in one click without opening the drawer.
2. As an operator, when a client has unread/missed messages, the card shows a
   **Read N** button that jumps straight into the conversation and clears the
   badge — no drawer navigation needed.
3. As an operator, the quick buttons must never start a card drag or open the
   drawer by accident (they stop pointer/click propagation).
4. As an operator opening the conversation from a card, the drawer must land on
   the **conversation** tab; a normal card click still lands on **overview**.

## Task report
- **`buildProjectToolbarModel` (pure)** — unchanged from the first iteration;
  now drives the **on-card** buttons (archive label/toggle + read visibility,
  count, variant, label). 8 unit tests, all PASS.
- **`resolveInitialDrawerTab` (pure, new)** — boundary helper that validates the
  requested drawer tab (card Read → 'conversation') and falls back to 'overview'
  for unknown/garbage input.
  - RED: `npx vitest run …/project-toolbar.test.ts` → **4 failed | 8 passed**
    (new resolver undefined) — failure caused by the intended missing function.
  - GREEN: same command → **12 passed**.
- **UI relocation** — reverted the drawer's top toolbar (restored its original
  bottom Archive button), added `initialTab` support to `ProjectDrawer`/`EditBody`
  (via `resolveInitialDrawerTab`), and added `CardQuickActions` (hover-revealed,
  drag-safe) to `ProjectCard`. The card Read button calls `markThreadRead` and
  opens the drawer on the conversation tab; Archive calls `archiveProject`.
  - Verified: `npx tsc --noEmit` clean; `npx eslint <touched files>` exit 0.

## Test specification
| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Active project shows "Archive" | `project-toolbar.test.ts` | unit | PASS |
| 2 | Archived project shows "Unarchive" | `project-toolbar.test.ts` | unit | PASS |
| 3 | Read button hidden when nothing unread/missed | `project-toolbar.test.ts` | unit | PASS |
| 4 | Unread shows red variant + "Read N messages" | `project-toolbar.test.ts` | unit | PASS |
| 5 | Singular wording for one unread | `project-toolbar.test.ts` | unit | PASS |
| 6 | Falls back to missed (amber) when no unread | `project-toolbar.test.ts` | unit | PASS |
| 7 | Unread count preferred over missed | `project-toolbar.test.ts` | unit | PASS |
| 8 | Negative/garbage counts → hidden | `project-toolbar.test.ts` | unit | PASS |
| 9 | Drawer tab defaults to overview when unset | `project-toolbar.test.ts` | unit | PASS |
| 10 | Card Read opens the conversation tab | `project-toolbar.test.ts` | unit | PASS |
| 11 | Every known tab passes through | `project-toolbar.test.ts` | unit | PASS |
| 12 | Unknown/garbage tab → overview | `project-toolbar.test.ts` | unit | PASS |

## Coverage and known gaps
- `npx vitest run src/app/(app)/dashboard/projects/` → 5 files, 37 tests passed.
- `npx tsc --noEmit` clean; eslint clean on touched files.
- Gap: the drag-safe propagation behaviour and hover reveal of `CardQuickActions`
  are DOM/interaction concerns not covered by a render test (the codebase
  convention is pure-function unit tests, no RTL/jsdom harness wired). Behavioural
  logic (button states, tab resolution) is fully covered by the pure helpers.
  Follow-up if E2E is prioritized: Playwright flow for hover-card → Archive
  (card disappears) and hover-card → Read (drawer opens on conversation, badge
  cleared).

## Merge evidence (RED → GREEN)
RED: 4 failing `resolveInitialDrawerTab` tests (function undefined). GREEN: 12/12
toolbar tests pass after implementing the resolver; projects suite 37/37;
typecheck + lint clean. The first iteration's drawer toolbar was reverted in
favour of on-card buttons per the follow-up request.
