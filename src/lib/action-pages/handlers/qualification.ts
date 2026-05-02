import { registerHandler } from '../dispatch'
import {
  AnswersMapSchema,
  parseQualificationConfig,
  type QualificationAnswer,
  type QualificationAnswers,
  type QualificationConfig,
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

interface DisplayAnswer {
  questionId: string
  prompt: string
  kind: string
  value: QualificationAnswer | null
  display: string | string[]
}

function labelForValue(
  value: QualificationAnswer,
  options: QualificationConfig['questions'][number]['options'],
): string {
  if (typeof value === 'number') return String(value)
  if (!options) return typeof value === 'string' ? value : ''
  const opt = options.find((o) => o.value === value)
  return opt?.label ?? (typeof value === 'string' ? value : '')
}

function buildDisplayAnswers(
  config: QualificationConfig,
  answers: QualificationAnswers,
): DisplayAnswer[] {
  return config.questions.map((q) => {
    const raw = answers[q.id]
    let display: string | string[] = '—'
    if (raw !== undefined && raw !== null && raw !== '') {
      if (Array.isArray(raw)) {
        display = raw.map((v) => labelForValue(v, q.options))
      } else if (typeof raw === 'number') {
        display = q.rating_max ? `${raw} / ${q.rating_max}` : String(raw)
      } else {
        display = labelForValue(raw, q.options)
      }
    }
    return {
      questionId: q.id,
      prompt: q.prompt,
      kind: q.kind,
      value: raw ?? null,
      display,
    }
  })
}

registerHandler('qualification', (payload, rawConfig) => {
  const config = parseQualificationConfig(rawConfig)
  const answers = parseAnswers(payload.answers)
  const displayAnswers = buildDisplayAnswers(config, answers)

  if (config.scoring.mode === 'manual_review') {
    return {
      outcome: 'pending_review',
      data: { answers: displayAnswers, score: null },
    }
  }

  const { score, missing_required } = scoreQualification(config, answers)
  const threshold = config.scoring.threshold ?? 0
  const qualifiedOutcome = config.scoring.qualified_outcome ?? 'qualified'
  const disqualifiedOutcome = config.scoring.disqualified_outcome ?? 'disqualified'
  const outcome = score >= threshold ? qualifiedOutcome : disqualifiedOutcome

  const data: Record<string, unknown> = { answers: displayAnswers, score }
  if (missing_required.length > 0) {
    data.meta = { validation_errors: { missing_required } }
  }

  return { outcome, data }
})
