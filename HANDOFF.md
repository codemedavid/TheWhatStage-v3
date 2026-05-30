# Pane 1 — Qualification score math (findings C2, C3)

Branch: `autosort/p1-score`

## What changed

Edited only:
- `src/lib/action-pages/handlers/qualification.score.ts`
- `src/lib/action-pages/handlers/qualification.score.test.ts`

### C2 — unbounded raw score, never normalized to 0–100
`scoreQualification` now also computes a deterministic **max possible raw
score** for the config and returns a **normalized 0–100 integer**.

### C3 — multi_choice could dominate / inflate
multi_choice now **caps** each question's contribution at the sum of its
positive option scores: `min(Σ selected, Σ positive) × weight`. This bounds
each question to its declared ceiling and neutralizes duplicate/repeated
values in the answer array (e.g. `['a','a','a']`), which previously inflated
the score.

## New `ScoreResult` shape (exact)

```ts
export interface ScoreResult {
  score: number            // RAW weighted sum — UNCHANGED semantics
  raw: number              // alias of `score`
  max: number              // deterministic max possible raw score, always >= 0
  normalized: number       // 0..100 integer, clamped — safe for leads.score
  missing_required: string[]
}
```

- `score === raw`. **`score` is unchanged** — `qualification-outcomes.ts`
  thresholds and `match` rules (`score_at_least`, `score_below`) still compare
  against the RAW value. Threshold semantics were NOT touched.
- `normalized = max > 0 ? clamp(round(100 * raw / max), 0, 100) : 0`.

### How `max` is computed (per question, summed)
- `single_choice`: `max(0, ...optionScores) × weight`
- `multi_choice`: `(Σ positive option scores) × weight`
- `rating`: `(rating_max ?? 5) × weight` — the `?? 5` mirrors the renderer
  (`Renderer.client.tsx`: `q.rating_max ?? 5`)
- `short_text`: `0`
- Each question's max contribution is floored at `0`, so weight `0`/negative
  and NaN-guarded weight (→ 1) cannot raise the ceiling.

## Integration needed (Pane 3 / submit)

`src/app/api/action-pages/submit/route.ts` (and/or `qualification.ts`) should
persist **`normalized`** into `leads.score` (smallint CHECK 0..100). It is the
only field guaranteed to fit that column. Do NOT store `raw`/`score` there —
it is unbounded.

Note: `qualification.ts` currently puts `evaluated.score` (raw, or null in
manual_review) into `data.score`. `evaluateQualificationOutcome` in
`qualification-outcomes.ts` does not yet surface `normalized`. **Wiring
`normalized` through `EvaluatedOutcome` → handler `data` → submit is left to
integration** (those files are outside this pane's allowed edit set). Suggested
minimal wiring: add `normalized` to `EvaluatedOutcome`, set it from
`scoreQualification(...).normalized` (and `0` in manual_review), then persist
it in submit.

## Tests
`npx vitest run src/lib/action-pages/handlers/qualification.score.test.ts`
→ 29 passed. Covers normalization bounds, multi_choice cap + duplicate
inflation, empty config, ratings (with/without rating_max), negative scores,
weight 0 / NaN, and the raw/score alias.

## Backward compatibility
No public signature broke. `ScoreResult` only gained fields; `score` keeps its
exact prior meaning and value.
