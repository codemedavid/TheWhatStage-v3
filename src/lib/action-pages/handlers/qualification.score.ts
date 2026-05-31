import type {
  QualificationAnswers,
  QualificationConfig,
  QualificationQuestion,
} from '@/app/a/[slug]/_kinds/qualification/schema'

export interface ScoreResult {
  /**
   * RAW weighted sum. Backward-compatible field: outcome thresholds and
   * `match` rules in `qualification-outcomes.ts` compare against this value,
   * so its semantics are intentionally unchanged. Identical to `raw`.
   */
  score: number
  /** Alias of `score` — the raw weighted sum, named explicitly. */
  raw: number
  /**
   * Deterministic maximum achievable raw score for this config. Used to
   * normalize `raw` onto a 0–100 scale. Always >= 0.
   */
  max: number
  /**
   * `raw` projected onto 0–100, rounded to an integer and clamped. Safe to
   * persist into `leads.score` (smallint CHECK 0..100). 0 when `max` is 0.
   */
  normalized: number
  missing_required: string[]
}

/**
 * Default rating ceiling used when a rating question omits `rating_max`.
 * Mirrors the renderer (`Renderer.client.tsx`: `q.rating_max ?? 5`) so the
 * normalization denominator matches what the user actually saw.
 */
const DEFAULT_RATING_MAX = 5

function resolveWeight(q: QualificationQuestion): number {
  return Number.isFinite(q.weight) ? q.weight : 1
}

/**
 * Sum of a multi_choice question's positive option scores (pre-weight). This
 * is the per-question ceiling used both to cap the actual contribution
 * (preventing duplicate-selection inflation, finding C3) and to compute `max`.
 */
function multiChoicePositiveSum(q: QualificationQuestion): number {
  return (q.options ?? []).reduce((sum, o) => sum + Math.max(0, o.score ?? 0), 0)
}

/**
 * Maximum positive contribution a single question can add to the raw score,
 * before weighting. Used to build the normalization denominator.
 */
function questionMaxBase(q: QualificationQuestion): number {
  switch (q.kind) {
    case 'single_choice': {
      // Best you can do is pick the highest-scoring option (or none → 0).
      return Math.max(0, ...(q.options ?? []).map((o) => o.score ?? 0))
    }
    case 'multi_choice': {
      return multiChoicePositiveSum(q)
    }
    case 'rating': {
      const ratingMax =
        Number.isFinite(q.rating_max) && (q.rating_max as number) > 0
          ? (q.rating_max as number)
          : DEFAULT_RATING_MAX
      return ratingMax
    }
    case 'short_text':
    default:
      return 0
  }
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n))

/**
 * Pure scoring function. Walks each question, sums weighted scores per answer,
 * and reports a normalized 0–100 value alongside the raw sum.
 *
 * Weighting rules:
 *  - single_choice: option.score (default 0) × question.weight
 *  - multi_choice : min(Σ selected option.score, Σ positive option.score) × weight
 *                   (the cap bounds each question and neutralizes duplicate
 *                    selections so one question cannot dominate — finding C3)
 *  - rating       : numeric value × question.weight
 *  - short_text   : 0 (no automated score)
 *
 * `max` is the deterministic maximum achievable raw score for the config:
 * Σ over questions of max(0, questionMaxBase × weight). Questions with a
 * non-positive (or NaN-guarded) effective weight contribute 0 to `max`.
 * `normalized = max > 0 ? clamp(round(100 × raw / max), 0, 100) : 0`.
 */
export function scoreQualification(
  config: QualificationConfig,
  answers: QualificationAnswers,
): ScoreResult {
  let score = 0
  let max = 0
  const missing_required: string[] = []

  for (const q of config.questions) {
    const answer = answers[q.id]
    const weight = resolveWeight(q)

    // Accumulate the normalization ceiling for every question, regardless of
    // whether it was answered — `max` describes the config, not the response.
    // Negative/zero weights cannot raise the achievable ceiling.
    max += Math.max(0, questionMaxBase(q) * weight)

    const isMissing =
      answer === undefined ||
      answer === null ||
      (typeof answer === 'string' && answer.trim() === '') ||
      (Array.isArray(answer) && answer.length === 0)

    if (q.required && isMissing) {
      missing_required.push(q.id)
      continue
    }
    if (isMissing) continue

    switch (q.kind) {
      case 'single_choice': {
        if (typeof answer !== 'string') break
        const opt = (q.options ?? []).find((o) => o.value === answer)
        const optScore = opt?.score ?? 0
        score += optScore * weight
        break
      }
      case 'multi_choice': {
        const values = Array.isArray(answer)
          ? answer
          : typeof answer === 'string'
            ? [answer]
            : []
        let sumSelected = 0
        for (const v of values) {
          const opt = (q.options ?? []).find((o) => o.value === v)
          sumSelected += opt?.score ?? 0
        }
        // Cap at the sum of positive options so duplicate or repeated values
        // cannot inflate the contribution beyond the question's real ceiling.
        const capped = Math.min(sumSelected, multiChoicePositiveSum(q))
        score += capped * weight
        break
      }
      case 'rating': {
        const n = typeof answer === 'number' ? answer : Number(answer)
        if (Number.isFinite(n)) {
          score += n * weight
        }
        break
      }
      case 'short_text':
      default:
        // No automated contribution.
        break
    }
  }

  const normalized = max > 0 ? clamp(Math.round((100 * score) / max), 0, 100) : 0

  return { score, raw: score, max, normalized, missing_required }
}
