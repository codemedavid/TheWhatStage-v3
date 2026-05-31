# PANE 1 — Qualification score math (findings C2, C3)

## Context
`scoreQualification` returns an unbounded raw weighted sum, never normalized to 0–100, and multi_choice double-counts (each selected option × question weight, no cap). The DB column `leads.score` is `smallint CHECK 0..100`, so the raw value can never be safely stored.

## YOUR FILES (edit ONLY these)
- `src/lib/action-pages/handlers/qualification.score.ts`
- `src/lib/action-pages/handlers/qualification.score.test.ts`

## Do
1. Add a deterministic max-possible-score computation so the result can be normalized. Extend `ScoreResult` with `raw: number`, `max: number`, and `normalized: number` (0–100, integer, clamped). KEEP the existing `score` field returning the RAW sum so `qualification-outcomes.ts` thresholds (which compare against raw) keep working unchanged — do NOT change threshold semantics.
2. Fix C3: cap each multi_choice question's contribution so a question cannot dominate. Use the per-question max = (sum of its positive option scores) × weight when computing `max`; for the actual score keep summing selected options BUT document and test the cap behavior. Pick the simplest correct rule (e.g. multi_choice contributes min(sum_selected, question_max_positive) × weight). Make it deterministic and well-tested.
3. `normalized = max > 0 ? clamp(round(100 * raw / max), 0, 100) : 0`.
4. Handle edge cases: empty questions, all-missing answers, negative option scores, weight 0 or NaN (already guarded), rating with no rating_max.
5. Add thorough tests for: normalization bounds, multi_choice cap, empty config, ratings, ties, negative scores.

## Note for integration (put in HANDOFF.md)
State the exact new `ScoreResult` shape. Pane 3 (submit) will read `normalized` to persist into `leads.score`. Do NOT edit qualification.ts or submit/route.ts.

## HARD RULES (every agent must obey)
- You are ONE of 8 parallel agents fixing the "auto sort leads" subsystem in isolated git worktrees. You will be merged later.
- **ONLY edit the files listed in "YOUR FILES" below.** Do NOT edit, create, or delete any file outside that list. If a fix seems to need another file, STOP and write the need into `HANDOFF.md` in your worktree root instead — the orchestrator will wire it up at integration.
- This repo runs a CUSTOM fork of Next.js. Before using any Next API, read the relevant guide in `node_modules/next/dist/docs/`. Heed deprecation notices.
- Package manager is **npm**. Run ONLY scoped tests: `npx vitest run <your test file>`. Do NOT run `next build`, full `tsc`, `npm install`, or `vitest` (watch). Do NOT touch `package.json` or lockfiles.
- Match surrounding code style. Keep changes minimal and surgical. No drive-by refactors.
- Preserve all existing behavior not explicitly being fixed. Every public function signature you change must keep backward-compat or be noted in HANDOFF.md.
- When done: ensure your scoped tests pass, then `git add -A && git commit -m "<conventional message>"` on your branch. Write a short `HANDOFF.md` summarizing what changed, any new exports other panes/integration need, and any follow-up wiring required.
- Do NOT merge, rebase, switch branches, or touch other worktrees. Stay on your branch.
