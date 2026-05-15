import 'server-only'
import { z } from 'zod'
import { HfRouterLlm } from '@/lib/rag'
import type { BusinessBasics } from '@/lib/onboarding/business-basics'
import type { OnboardingLang } from '@/lib/onboarding/types'

export interface GeneratedKnowledgeSection {
  title: string
  body: string
}

export interface GeneratedKnowledge {
  sections: GeneratedKnowledgeSection[]
}

const ResponseSchema = z.object({
  sections: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        body: z.string().min(1).max(2000),
      }),
    )
    .min(3)
    .max(7),
})

function systemPrompt(lang: OnboardingLang): string {
  const langInstruction =
    lang === 'tl'
      ? 'Sumagot sa Tagalog (Taglish OK). Conversational, hindi formal.'
      : 'Reply in English. Conversational, not formal.'
  return [
    'You write the seed knowledge base for a small Filipino business chatbot.',
    'Given the business basics, produce 4 to 6 concise sections that the bot can cite when answering customers.',
    'Sections should cover: about the business, what they offer, who it is for, how it works / how to order, pricing approach (if known), and contact / next steps.',
    'Each section: a short title (1-6 words) and a body of 2-4 short sentences. No markdown headers in the body — plain prose.',
    'Output strict JSON only. Schema: { "sections": [ { "title": string, "body": string }, ... ] }.',
    langInstruction,
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

export async function generateKnowledge(input: {
  basics: BusinessBasics
  lang: OnboardingLang
}): Promise<GeneratedKnowledge> {
  const llm = new HfRouterLlm()
  let raw: string
  try {
    raw = await llm.complete(
      [
        { role: 'system', content: systemPrompt(input.lang) },
        { role: 'user', content: userPrompt(input.basics) },
      ],
      { responseFormat: 'json_object', temperature: 0.5, maxTokens: 1200 },
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
