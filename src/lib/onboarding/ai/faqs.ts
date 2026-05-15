import 'server-only'
import { z } from 'zod'
import { HfRouterLlm } from '@/lib/rag'
import type { BusinessBasics } from '@/lib/onboarding/business-basics'
import type { OnboardingLang } from '@/lib/onboarding/types'

export interface GeneratedFaq {
  question: string
  answer: string
}

export interface GeneratedFaqs {
  suggestions: GeneratedFaq[]
}

const ResponseSchema = z.object({
  suggestions: z
    .array(
      z.object({
        question: z.string().min(1).max(300),
        answer: z.string().min(1).max(2000),
      }),
    )
    .min(3)
    .max(10),
})

function systemPrompt(lang: OnboardingLang): string {
  const langLine =
    lang === 'tl'
      ? 'Isulat ang lahat sa Tagalog/Taglish — kung paano nagtatanong ang totoong customers sa Messenger (e.g. "magkano po?", "available pa ba?").'
      : 'Write all FAQs in conversational English — match how real customers ask on Messenger.'
  return [
    'You generate the seed FAQ list for a small Filipino business chatbot.',
    'Given the business basics, produce 5 to 8 high-value FAQs that real customers actually ask before they buy or book.',
    'Cover (when applicable): pricing, availability/stock, delivery/service area, hours, how to order, payment options, returns/guarantees, location.',
    'Keep questions short (≤ 15 words). Answers concrete and specific — invent reasonable defaults if the business basics do not specify (e.g., Mon-Sat 9am-6pm, COD + GCash, free delivery within QC).',
    'Output strict JSON only. Schema: { "suggestions": [ { "question": string, "answer": string }, ... ] }.',
    langLine,
  ].join('\n')
}

function userPrompt(b: BusinessBasics): string {
  return [
    `Business name: ${b.name}`,
    `One-line offer: ${b.offer}`,
    `Business type: ${b.business_type}`,
    `Target audience: ${b.audience}`,
    `Pain solved: ${b.pain}`,
    `Tone preference: ${b.tone}`,
  ].join('\n')
}

export async function generateFaqs(input: {
  basics: BusinessBasics
  lang: OnboardingLang
}): Promise<GeneratedFaqs> {
  const llm = new HfRouterLlm()
  let raw: string
  try {
    raw = await llm.complete(
      [
        { role: 'system', content: systemPrompt(input.lang) },
        { role: 'user', content: userPrompt(input.basics) },
      ],
      { responseFormat: 'json_object', temperature: 0.6, maxTokens: 1200 },
    )
  } catch (err) {
    throw new Error('generation_failed: llm_call', { cause: err })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('generation_failed: invalid_json')
  }

  const result = ResponseSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error('generation_failed: schema_mismatch')
  }
  return result.data
}
