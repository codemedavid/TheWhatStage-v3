import 'server-only'
import { z } from 'zod'
import { HfRouterLlm } from '@/lib/rag'
import type { BusinessBasics } from '@/lib/onboarding/business-basics'
import type { OnboardingLang } from '@/lib/onboarding/types'
import type { ActionPageKind } from '@/lib/action-pages/kinds'

export interface GeneratedBotInstructions {
  bot_send_instructions: string
  recommendation_rules: string
  required_slots: string[]
  confidence_threshold: number
}

const ResponseSchema = z.object({
  bot_send_instructions: z.string().trim().min(20).max(2000),
  recommendation_rules: z.string().trim().min(20).max(2000),
  required_slots: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  confidence_threshold: z.number().min(0).max(1).default(0.55),
})

function sys(lang: OnboardingLang, kind: ActionPageKind): string {
  const lline = lang === 'tl' ? 'Sumagot sa Tagalog/Taglish — kung paano nagtatanong ang totoong customers.' : 'Reply in English.'
  return [
    `You design when a Filipino business chatbot should send the user's "${kind}" action page.`,
    'Given the business basics, the chosen action page, and the owner\'s description of the ideal conversation flow, produce:',
    '1) bot_send_instructions: natural-language guidance the bot follows for THIS specific page. Concrete triggers ("when X happens, send this"). Include guardrails ("do NOT send before Y").',
    '2) recommendation_rules: stricter conditions when the bot must wait or qualify further before sending. Specific signals/phrases that customers actually say.',
    '3) required_slots: short list of conversation slots the bot should confirm before sending (e.g., "preferred_date", "budget", "address"). Empty array if none.',
    '4) confidence_threshold: 0..1 — how confident the classifier must be before sending. 0.5 default. 0.65 for sensitive conversions.',
    'Output strict JSON only: { "bot_send_instructions": string, "recommendation_rules": string, "required_slots": string[], "confidence_threshold": number }',
    lline,
  ].join('\n')
}

function usr(b: BusinessBasics, page: { title: string; cta_label: string }, flow: string): string {
  return [
    `Business: ${b.name} — ${b.offer}`,
    `Audience: ${b.audience}`,
    `Action page: "${page.title}" (CTA: "${page.cta_label}")`,
    `Owner's ideal flow:`,
    flow,
  ].join('\n')
}

export async function generateBotInstructions(input: {
  basics: BusinessBasics
  goal: ActionPageKind
  action_page: { title: string; cta_label: string }
  flow_description: string
  lang: OnboardingLang
}): Promise<GeneratedBotInstructions> {
  const llm = new HfRouterLlm()
  let raw: string
  try {
    raw = await llm.complete(
      [{ role: 'system', content: sys(input.lang, input.goal) }, { role: 'user', content: usr(input.basics, input.action_page, input.flow_description) }],
      { responseFormat: 'json_object', temperature: 0.5, maxTokens: 900 },
    )
  } catch (err) { throw new Error('generation_failed: llm_call', { cause: err }) }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error('generation_failed: invalid_json') }
  const r = ResponseSchema.safeParse(parsed)
  if (!r.success) throw new Error('generation_failed: schema_mismatch')
  return r.data
}
