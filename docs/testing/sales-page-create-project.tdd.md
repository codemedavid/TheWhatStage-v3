# TDD Evidence: Create Project on sales-page submissions

**Source plan**: inline plan produced via `/ecc:plan` in this session (no `*.plan.md` artifact was written — conversational mode).

## User journey

As a business owner reviewing Sales page submissions, I want to turn a buyer's
submission into a Project (same as I already can from Form/Qualification
submissions), so I can track the deal through my pipeline stages.

## Background

`CreateProjectButton` and `fetchProjectInfoBySubmissionIds` /
`createProjectFromSubmission` are pre-existing, kind-agnostic pieces already
wired into `FormSubmissionsView.tsx` and the generic fallback view. The Sales
kind (`SalesSubmissionsView.tsx` + the `kind === 'sales'` branch of
`page.tsx`) never called them. This change is pure wiring — no new backend
logic.

## Task report

| Task | Summary | Validation | Result |
|---|---|---|---|
| RED | Added `SalesSubmissionsView.test.tsx` asserting the create-project trigger, the existing-project badge, absence when no lead, and a drawer "Project" section | `npx vitest run ".../SalesSubmissionsView.test.tsx"` | 3/4 failed for the intended reason (feature not yet wired); 1/4 (no-lead absence) passed trivially since it was already true |
| GREEN | Wired `fetchProjectInfoBySubmissionIds` into the sales branch of `page.tsx`; added `project` to `SalesSubmissionRow`; rendered `CreateProjectButton` in the card and a new drawer "Project" section; fixed an invalid nested `<button>` by switching the card root from `<button>` to a `role="button"` `<div>` (mirroring `FormSubmissionsView.tsx`) | `npx vitest run ".../SalesSubmissionsView.test.tsx"` | 4/4 passed |
| Regression check | Ran the full action-pages + projects test suite | `npx vitest run src/app/\(app\)/dashboard/action-pages src/app/\(app\)/dashboard/projects` | 250/250 passed across 43 files |
| Typecheck | Verified no type errors introduced | `npx tsc --noEmit -p tsconfig.json` | Clean |
| Lint | Verified touched files are lint-clean | `npx eslint <3 touched files>` | Clean (one pre-existing, unrelated `prefer-const` error in the untouched `catalog` branch of `page.tsx`, left as-is — out of scope) |

## Test specification

| # | What is guaranteed | Test file | Test type | Result | Evidence |
|---|---|---|---|---|---|
| 1 | A submission linked to a lead with no project yet shows a "Create project" trigger on its card | `SalesSubmissionsView.test.tsx:renders a "Create project" trigger…` | unit (RTL) | PASS | `npx vitest run` |
| 2 | A submission already turned into a project shows a linked stage badge (e.g. "Scoping") instead of the create trigger | `SalesSubmissionsView.test.tsx:shows the existing project stage…` | unit (RTL) | PASS | `npx vitest run` |
| 3 | A submission with no linked lead shows neither the create trigger nor a project badge | `SalesSubmissionsView.test.tsx:omits the project action…` | unit (RTL) | PASS | `npx vitest run` |
| 4 | Opening a submission's detail drawer surfaces a "Project" section with its own create-project control | `SalesSubmissionsView.test.tsx:surfaces the project action inside the submission detail drawer` | unit (RTL) | PASS | `npx vitest run` |

## Coverage and known gaps

- `CreateProjectButton` and `fetchProjectInfoBySubmissionIds` themselves are
  not retested here — they're pre-existing, already-integrated pieces with no
  test file anywhere in the repo (including at their original Form/
  Qualification call site); this change only verifies *that* they're now
  correctly wired for the Sales kind, not their own internal behavior.
- `next/navigation`'s `useRouter` is stubbed via `vi.mock` (this repo's first
  RTL test of a component that calls it) rather than mounted under a real
  Next.js app-router context — consistent with this repo's existing
  `vi.mock('next/navigation', …)` convention used in server-action tests.
- No E2E coverage was added; this is UI wiring of an already-shipped, already
  E2E-reachable feature onto one more entry point. Manual verification: not
  performed in-browser this session (no dev server run) — typecheck, lint,
  and the full action-pages/projects unit suite are the validation evidence.

## Merge evidence

Checkpoint commits on `main`:
- `test: add reproducer for sales-page create-project action` (RED)
- `fix: add Create Project action to sales-page submissions` (GREEN — includes the nested-button HTML fix, folded in since the button couldn't render correctly without it)

No refactor commit was needed: the implementation mirrors
`FormSubmissionsView.tsx`'s existing pattern directly with no introduced
duplication beyond what that file already establishes as convention.
