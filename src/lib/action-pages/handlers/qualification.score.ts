import type {
  QualificationAnswers,
  QualificationConfig,
} from '@/app/a/[slug]/_kinds/qualification/schema'

export interface ScoreResult {
  score: number
  missing_required: string[]
}

/**
 * Pure scoring function. Walks each question, sums weighted scores per answer.
 *
 * Weighting rules:
 *  - single_choice: option.score (default 0) × question.weight
 *  - multi_choice : sum of selected option.score × question.weight
 *  - rating       : numeric value × question.weight
 *  - short_text   : 0 (no automated score)
 */
export function scoreQualification(
  config: QualificationConfig,
  answers: QualificationAnswers,
): ScoreResult {
  let score = 0
  const missing_required: string[] = []

  for (const q of config.questions) {
    const answer = answers[q.id]
    const weight = Number.isFinite(q.weight) ? q.weight : 1

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
        for (const v of values) {
          const opt = (q.options ?? []).find((o) => o.value === v)
          const optScore = opt?.score ?? 0
          score += optScore * weight
        }
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

  return { score, missing_required }
}
