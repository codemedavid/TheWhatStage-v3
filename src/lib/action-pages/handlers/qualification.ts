import { registerHandler } from '../dispatch'
import {
  AnswersMapSchema,
  parseQualificationConfig,
  type QualificationAnswers,
} from '@/app/a/[slug]/_kinds/qualification/schema'
import { scoreQualification } from './qualification.score'

function parseAnswers(raw: unknown): QualificationAnswers {
  let candidate: unknown = raw
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate)
    } catch {
      return {}
    }
  }
  const parsed = AnswersMapSchema.safeParse(candidate)
  return parsed.success ? parsed.data : {}
}

registerHandler('qualification', (payload, rawConfig) => {
  const config = parseQualificationConfig(rawConfig)
  const answers = parseAnswers(payload.answers)

  if (config.scoring.mode === 'manual_review') {
    return {
      outcome: 'pending_review',
      data: { answers, score: null },
    }
  }

  const { score, missing_required } = scoreQualification(config, answers)
  const threshold = config.scoring.threshold ?? 0
  const qualifiedOutcome = config.scoring.qualified_outcome ?? 'qualified'
  const disqualifiedOutcome = config.scoring.disqualified_outcome ?? 'disqualified'
  const outcome = score >= threshold ? qualifiedOutcome : disqualifiedOutcome

  const data: Record<string, unknown> = { answers, score }
  if (missing_required.length > 0) {
    data.meta = { validation_errors: { missing_required } }
  }

  return { outcome, data }
})
