# Project Management — Brand/Theme Alignment (TDD Evidence)

**Date:** 2026-06-26
**Scope:** Make the project-management surfaces (`/dashboard/projects/*`) and the
sister Leads board match the site's brand: typography, accent, and paper/surface
colors. Decided with the user: *targeted brand alignment*, applied to *Projects + Leads*.

## Source plan

No `*.plan.md`. Journeys derived during this run from a codebase audit of the two
design systems in `globals.css`.

## The divergence (what was fixed)

| Brand surface (Action Pages / University / Funnels) | Project management (before) |
|---|---|
| `--ws-*` tokens: paper `#FAFAF7`, accent `#1F7A4D` | mounted under `data-leads-root`, `--lead-*`: paper `#faf9f5`, accent `#047857` |
| Instrument Serif display headings (`.apl-hero h1`) | plain extra-bold **sans** headings |
| tokenized surfaces | off-theme hardcoded grays (`#E5E7EB`, `bg-white`, blue "Default" badge) |

Because Projects + Leads both consume the `--lead-*` namespace under
`[data-leads-root]`, retuning those tokens once aligns **both** surfaces.

## User journeys

1. As a user, when I open Projects/Leads, the page chrome (paper, surfaces, accent
   green) matches Action Pages / University so the app feels like one product.
2. As a user, the main page titles ("Projects", a workspace name, "Leads") render in
   the brand display font (Instrument Serif), like every other top-level page.
3. As a user, I never see off-brand grays or a blue "Default" chip in the workspace
   picker / board skeleton.

## Changes

- `src/app/globals.css` — retuned `[data-leads-root]` **light** tokens to the brand
  `--ws-*` values (paper/surface/line/ink/accent/warn/danger/shadow). Dark palette
  left intact (brand is light-only). Added `.lead-display` utility = Instrument Serif
  400, `-0.01em`, matching `.apl-hero h1` / `.ap-head h1`.
- `projects/_components/WorkspacesView.client.tsx` — "Projects" h1 → `.lead-display` 36px.
- `projects/_components/WorkspaceSwitcher.tsx` — board-page workspace title → `.lead-display` 20px.
- `leads/_components/LeadsHeader.tsx` — "Leads" h1 → `.lead-display` 24px.
- `projects/[workspaceId]/page.tsx` — board skeleton grays → `--lead-*` tokens.
- `projects/_components/WorkspacePicker.client.tsx` — portals to `<body>` (outside
  `[data-leads-root]`), so switched hardcoded grays → global `--ws-*` tokens; off-brand
  blue "Default" badge → neutral brand tokens.
- `projects/_components/ProjectStats.tsx` — Won/Value-won green → `--lead-accent`,
  Lost red → `--lead-danger` (were generic `#16a34a` / `#dc2626`).

## Verification

This is a **presentational** change (CSS custom-property values + heading font +
removal of hardcoded colors) with **no new logic branches**. Font rendering and
color token values are not observable in jsdom, and asserting CSS class names would
test implementation details the project testing guide warns against. So it is verified by
regression + static checks rather than new unit tests:

| # | What is guaranteed | Command | Type | Result |
|---|---|---|---|---|
| 1 | Existing projects + leads behaviour unchanged | `npx vitest run src/app/(app)/dashboard/projects src/app/(app)/dashboard/leads` | unit/integration | **PASS — 91 files / 529 tests** |
| 2 | No type errors introduced | `npx tsc --noEmit` | typecheck | **PASS (clean in src/)** |
| 3 | No lint errors in changed files | `npx eslint <6 changed files>` | lint | **PASS (exit 0)** |

Baseline before changes: `npx vitest run src/app/(app)/dashboard/projects` → 10 files / 80 tests PASS.

## Known gaps / not done (intentional)

- **Semantic/categorical colors left as-is**: per-stage-kind badge palette
  (`ProjectListView`, `ProjectBoard`), inline error reds (`#dc2626`) in drawers, and
  success-toast green. These are status/category signals, not brand chrome.
- **Dark mode** of the leads/projects workspace keeps its existing committed palette
  (the brand has no dark spec).
- **Visual confirmation** still recommended: the projects/leads pages require an
  authenticated session, so a logged-in screenshot pass was not run here.
