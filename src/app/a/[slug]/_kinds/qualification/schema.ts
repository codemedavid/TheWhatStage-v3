import { z } from 'zod'

export const QuestionKind = z.enum(['single_choice', 'multi_choice', 'short_text', 'rating'])
export type QuestionKind = z.infer<typeof QuestionKind>

export const OptionSchema = z.object({
  label: z.string().min(1).max(200),
  value: z.string().min(1).max(200),
  score: z.number().optional(),
})
export type QualificationOption = z.infer<typeof OptionSchema>

export const QuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string().min(1).max(500),
  kind: QuestionKind,
  required: z.boolean().default(false),
  weight: z.number().default(1),
  options: z.array(OptionSchema).optional(),
  rating_max: z.number().int().min(3).max(10).optional(),
  min_rating_to_pass: z.number().int().optional(),
})
export type QualificationQuestion = z.infer<typeof QuestionSchema>

export const ScoringSchema = z.object({
  mode: z.enum(['rule_based', 'manual_review']),
  threshold: z.number().optional(),
  qualified_outcome: z.string().optional(),
  disqualified_outcome: z.string().optional(),
})
export type QualificationScoring = z.infer<typeof ScoringSchema>

export const OutcomeMatchSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('score_at_least'), value: z.number() }),
  z.object({ kind: z.literal('score_below'), value: z.number() }),
  z.object({ kind: z.literal('manual_review') }),
  z.object({
    kind: z.literal('answer_equals'),
    question_id: z.string().min(1),
    value: z.union([z.string(), z.number(), z.boolean()]),
  }),
  z.object({
    kind: z.literal('answer_includes'),
    question_id: z.string().min(1),
    value: z.string().min(1),
  }),
])
export type QualificationOutcomeMatch = z.infer<typeof OutcomeMatchSchema>

const OutcomeUuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)

export const OutcomeActionSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  outcome: z.string().min(1).max(40),
  match: OutcomeMatchSchema,
  to_stage_id: OutcomeUuidSchema.nullable().default(null),
  messenger_text: z.string().max(640).default(''),
  attach_action_page_id: OutcomeUuidSchema.nullable().default(null),
  attach_cta_label: z.string().max(50).default(''),
  public_message: z.string().max(2000).default(''),
})
export type QualificationOutcomeAction = z.infer<typeof OutcomeActionSchema>

export const ThemeSchema = z.object({
  background_color: z.string().default('#FFFFFF'),
  accent_color: z.string().default('#059669'),
  button_text_color: z.string().default('#FFFFFF'),
})
export type QualificationTheme = z.infer<typeof ThemeSchema>

export const IntroSchema = z
  .object({
    headline: z.string().max(200).optional(),
    body: z.string().max(2000).optional(),
  })
  .optional()

export const OutroSchema = z
  .object({
    qualified_message: z.string().max(2000).optional(),
    disqualified_message: z.string().max(2000).optional(),
    pending_message: z.string().max(2000).optional(),
  })
  .optional()

export const QualificationConfigSchema = z.object({
  theme: ThemeSchema,
  progress_bar: z.boolean().default(true),
  questions: z.array(QuestionSchema).default([]),
  scoring: ScoringSchema,
  outcomes: z.array(OutcomeActionSchema).default([]),
  intro: IntroSchema,
  outro: OutroSchema,
})
export type QualificationConfig = z.infer<typeof QualificationConfigSchema>

export function defaultQualificationOutcomes(
  scoring: QualificationScoring,
): QualificationOutcomeAction[] {
  const threshold = scoring.threshold ?? 1
  const qualified = scoring.qualified_outcome || 'qualified'
  const disqualified = scoring.disqualified_outcome || 'disqualified'
  return [
    {
      id: 'qualified',
      label: 'Qualified',
      outcome: qualified,
      match: { kind: 'score_at_least', value: threshold },
      to_stage_id: null,
      messenger_text: '',
      attach_action_page_id: null,
      attach_cta_label: '',
      public_message: '',
    },
    {
      id: 'disqualified',
      label: 'Not qualified',
      outcome: disqualified,
      match: { kind: 'score_below', value: threshold },
      to_stage_id: null,
      messenger_text: '',
      attach_action_page_id: null,
      attach_cta_label: '',
      public_message: '',
    },
    {
      id: 'pending_review',
      label: 'Needs review',
      outcome: 'pending_review',
      match: { kind: 'manual_review' },
      to_stage_id: null,
      messenger_text: '',
      attach_action_page_id: null,
      attach_cta_label: '',
      public_message: '',
    },
  ]
}

export const DEFAULT_QUALIFICATION_CONFIG: QualificationConfig = {
  theme: {
    background_color: '#FFFFFF',
    accent_color: '#059669',
    button_text_color: '#FFFFFF',
  },
  progress_bar: true,
  questions: [],
  scoring: {
    mode: 'rule_based',
    threshold: 1,
    qualified_outcome: 'qualified',
    disqualified_outcome: 'disqualified',
  },
  outcomes: defaultQualificationOutcomes({
    mode: 'rule_based',
    threshold: 1,
    qualified_outcome: 'qualified',
    disqualified_outcome: 'disqualified',
  }),
  intro: { headline: '', body: '' },
  outro: {
    qualified_message: '',
    disqualified_message: '',
    pending_message: '',
  },
}

/** Parse, falling back to defaults on any validation failure. */
export function parseQualificationConfig(raw: unknown): QualificationConfig {
  const normalize = (candidate: QualificationConfig): QualificationConfig => ({
    ...candidate,
    outcomes:
      candidate.outcomes.length > 0
        ? candidate.outcomes
        : defaultQualificationOutcomes(candidate.scoring),
  })

  const result = QualificationConfigSchema.safeParse(raw)
  if (result.success) return normalize(result.data)
  // Try a partial merge so partially-valid configs at least keep questions.
  if (raw && typeof raw === 'object') {
    const merged = { ...DEFAULT_QUALIFICATION_CONFIG, ...(raw as Record<string, unknown>) }
    const second = QualificationConfigSchema.safeParse(merged)
    if (second.success) return normalize(second.data)
  }
  return DEFAULT_QUALIFICATION_CONFIG
}

/** Per-question answer, keyed by question id on the wire. */
export const AnswerSchema = z.union([
  z.string(), // short_text or single_choice value
  z.array(z.string()), // multi_choice values
  z.number(), // rating
])
export type QualificationAnswer = z.infer<typeof AnswerSchema>

export const AnswersMapSchema = z.record(z.string(), AnswerSchema)
export type QualificationAnswers = z.infer<typeof AnswersMapSchema>
