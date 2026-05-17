import { z } from 'zod'
import type { GeneratedKnowledge } from '@/lib/onboarding/ai/knowledge'
import type { GeneratedFaqs } from '@/lib/onboarding/ai/faqs'
import type { GeneratedBotInstructions } from '@/lib/onboarding/ai/bot-instructions'
import { BlockSchema, type SuggestedBlock } from '@/lib/onboarding/ai/form-fields-shared'
import type { GeneratedPersonality } from '@/lib/onboarding/ai/personality-shared'

/**
 * Page-side guards for generation_jobs.result. Generators validate their own
 * output before writing it, but the JSONB column has no enforced shape and an
 * upstream schema change could land malformed rows in front of a user. These
 * tolerant parsers let pages bail to the "regenerate" state instead of
 * crashing the editor on a missing field.
 */

const KnowledgeResultSchema = z.object({
  sections: z
    .array(
      z.object({
        title: z.string().min(1),
        body: z.string().min(1),
      }),
    )
    .min(1),
})

export function parseKnowledgeResult(v: unknown): GeneratedKnowledge | null {
  const r = KnowledgeResultSchema.safeParse(v)
  return r.success ? (r.data as GeneratedKnowledge) : null
}

const FaqsResultSchema = z.object({
  suggestions: z.array(
    z.object({
      question: z.string().min(1),
      answer: z.string().min(1),
    }),
  ),
})

export function parseFaqsResult(v: unknown): GeneratedFaqs | null {
  const r = FaqsResultSchema.safeParse(v)
  return r.success ? (r.data as GeneratedFaqs) : null
}

const BotInstructionsResultSchema = z.object({
  bot_send_instructions: z.string().min(1),
  recommendation_rules: z.string().min(1),
  required_slots: z.array(z.string()).optional(),
  confidence_threshold: z.number().min(0).max(1).optional(),
})

export function parseBotInstructionsResult(
  v: unknown,
): GeneratedBotInstructions | null {
  const r = BotInstructionsResultSchema.safeParse(v)
  return r.success ? (r.data as GeneratedBotInstructions) : null
}

const PersonalityResultSchema = z.object({
  name: z.string().min(1),
  persona: z.string().min(1),
  do_rules: z.array(z.string()).min(1),
  dont_rules: z.array(z.string()).min(1),
  fallback_message: z.string().min(1),
})

export function parsePersonalityResult(v: unknown): GeneratedPersonality | null {
  const r = PersonalityResultSchema.safeParse(v)
  return r.success ? (r.data as GeneratedPersonality) : null
}

const FormFieldsResultSchema = z.object({
  blocks: z.array(BlockSchema),
})

export function parseFormFieldsResult(v: unknown): { blocks: SuggestedBlock[] } | null {
  const r = FormFieldsResultSchema.safeParse(v)
  return r.success ? r.data : null
}
