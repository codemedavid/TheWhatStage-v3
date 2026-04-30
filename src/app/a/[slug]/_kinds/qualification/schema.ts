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
  intro: IntroSchema,
  outro: OutroSchema,
})
export type QualificationConfig = z.infer<typeof QualificationConfigSchema>

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
  intro: { headline: '', body: '' },
  outro: {
    qualified_message: '',
    disqualified_message: '',
    pending_message: '',
  },
}

/** Parse, falling back to defaults on any validation failure. */
export function parseQualificationConfig(raw: unknown): QualificationConfig {
  const result = QualificationConfigSchema.safeParse(raw)
  if (result.success) return result.data
  // Try a partial merge so partially-valid configs at least keep questions.
  if (raw && typeof raw === 'object') {
    const merged = { ...DEFAULT_QUALIFICATION_CONFIG, ...(raw as Record<string, unknown>) }
    const second = QualificationConfigSchema.safeParse(merged)
    if (second.success) return second.data
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
