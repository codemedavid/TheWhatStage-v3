# TDD Evidence — Sales-style Form & Qualification Submissions View

**Date:** 2026-06-20
**Source plan:** Derived during this TDD run (no `*.plan.md`). Scope confirmed with the
user: redesign the **form** and **qualification** action-page submission views to match
the existing `SalesSubmissionsView`, **including** the slide-in detail drawer.

## User journeys

1. As an admin, I want form/quiz submissions presented like the sales page (warm
   palette, serif headers, stat tiles, filter pills, search) so I can scan them better.
2. As an admin, I want to click a submission and see a detail drawer with the lead, all
   form fields (or quiz answers + score), a project action, and an activity timeline.
3. As an admin, I want to filter form submissions by source (Web/Messenger) and
   qualification responses by outcome, and search across name and field values.
4. As an admin, I want to keep creating/opening a project from a submission, exactly as
   before.

## Task report

The redesign is mostly a visual React component (`FormSubmissionsView.tsx`). The
testable logic — name/source resolution, field & answer extraction, stat computation,
filter building, and filtering/search — was extracted into a pure helper module
(`form-submissions.helpers.ts`) and covered with unit tests first.

- **RED:** wrote `form-submissions.helpers.test.ts` (21 cases) importing a module that
  did not exist yet.
  - Command: `npx vitest run .../form-submissions.helpers.test.ts`
  - Output: `Test Files 1 failed (1)` / `no tests` — transform error: failed to resolve
    import `./form-submissions.helpers` (compile-time RED, intended).
- **GREEN:** implemented `form-submissions.helpers.ts`.
  - Command: `npx vitest run .../form-submissions.helpers.test.ts`
  - Output: `Test Files 1 passed (1)` / `Tests 21 passed (21)`.
- Built `FormSubmissionsView.tsx` (cards + filter pills + search + stat tiles + drawer),
  reusing `CreateProjectButton` so project creation/stage badges/unread counts are
  preserved. Card is a `role="button"` div (not a `<button>`) so the nested project
  button/link is valid; project action stops click propagation so it doesn't open the
  drawer.
- Wired `page.tsx`: `form` and `qualification` kinds now early-return
  `<FormSubmissionsView>`; removed the dead `FormView`/`FormCard`/`QualificationView`/
  `QualificationCard`/`PersonContent` components and the now-unused `OUTCOME_META`,
  `monthStart`, `weekAgo`. `GenericView` still handles other fallback kinds.
- **Typecheck:** `npx tsc --noEmit` — no errors in the changed files (fixed one variance
  issue by making `filterSubmissions` generic over `T extends SubmissionListItem`).
- **Regression:** neighboring `project-info-query.test.ts` — `6 passed`.

## Test specification

| # | What is guaranteed | Test file / case | Type | Result |
|---|--------------------|------------------|------|--------|
| 1 | Source resolves to Messenger when a psid exists, else Web | `form-submissions.helpers.test.ts:submissionSource` | unit | PASS |
| 2 | Display name prefers lead, then messenger, else Anonymous | `:displayName` | unit | PASS |
| 3 | Form fields extracted from `data.fields`, empties skipped, labels humanized | `:extractFormFields` | unit | PASS |
| 4 | Quiz answers map to prompt/value, arrays joined, Qn fallback | `:extractAnswers` | unit | PASS |
| 5 | Score read from `data.score`, null when absent | `:getScore` | unit | PASS |
| 6 | Outcome labels use known map, else humanized | `:formatOutcomeLabel` | unit | PASS |
| 7 | Form stats = Total / This month / This week (injectable now) | `:computeStats (form)` | unit | PASS |
| 8 | Qualification stats = top outcomes + This week | `:computeStats (qualification)` | unit | PASS |
| 9 | Form filters = All/Web/Messenger with counts | `:getFilters` | unit | PASS |
| 10 | Qualification filters = All + per-outcome with counts | `:getFilters` | unit | PASS |
| 11 | Filtering by source/outcome/all + free-text search over name & fields | `:filterSubmissions` | unit | PASS |

`npx vitest run .../form-submissions.helpers.test.ts` → **21 passed**.

## Coverage and known gaps

- Pure helper logic is unit-tested (21 cases). The `FormSubmissionsView` React
  component itself is not unit-tested (visual/interaction layer); its data-shaping logic
  is fully delegated to the tested helpers. No E2E was added in this pass — a Playwright
  flow (open page → filter → open drawer → create project) is a reasonable follow-up.
- Coverage command not run for a single-module threshold; logic module has full
  branch coverage by inspection of the cases above.
