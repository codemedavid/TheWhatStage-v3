import 'server-only'
import { z } from 'zod'
import { HfRouterLlm } from '@/lib/rag'
import type { BusinessBasics, TonePreset } from '@/lib/onboarding/business-basics'
import type { OnboardingLang } from '@/lib/onboarding/types'
import type { GeneratedPersonality, PersonalitySeeds, VibePreset } from '@/lib/onboarding/ai/personality-shared'

export { VIBE_PRESETS } from '@/lib/onboarding/ai/personality-shared'
export type { GeneratedPersonality, PersonalitySeeds, VibePreset } from '@/lib/onboarding/ai/personality-shared'

const ResponseSchema = z.object({
  name: z.string().trim().min(1).max(60),
  persona: z.string().trim().min(20).max(800),
  do_rules: z.array(z.string().trim().min(1).max(200)).min(2).max(8),
  dont_rules: z.array(z.string().trim().min(1).max(200)).min(2).max(8),
  fallback_message: z.string().trim().min(10).max(300),
})

function vibeLine(v: VibePreset | undefined, tone: TonePreset): string {
  if (!v) return `Tone preset: ${tone}.`
  const map: Record<VibePreset, string> = {
    friendly_kuya_ate: 'Vibe: warm Pinoy kuya/ate energy — uses "po/opo", calls customer "ka", playful.',
    professional_consultant: 'Vibe: calm professional consultant — concise, no slang, never aggressive.',
    hype_closer: 'Vibe: hype closer — confident, energetic, uses urgency without being scammy.',
    calm_expert: 'Vibe: calm expert — explains patiently, technical when needed, never condescending.',
  }
  return map[v]
}

function systemPrompt(lang: OnboardingLang, seeds: PersonalitySeeds, tone: TonePreset): string {
  const langLine =
    lang === 'tl'
      ? 'Sumagot sa Tagalog/Taglish ang `persona`, `do_rules`, `dont_rules`, at `fallback_message`. Yung `name` ay isang short Filipino-friendly name.'
      : 'Reply in English for persona, do_rules, dont_rules, and fallback_message. The name should be short and human (e.g., "Nena", "Kuya Jay").'
  return [
    'You design the personality config for a small Filipino business chatbot.',
    'Output strict JSON with these fields: { "name": string, "persona": string (1-2 paragraphs), "do_rules": string[], "dont_rules": string[], "fallback_message": string }.',
    'Rules should be concrete and behavioral — e.g., "Always confirm address before quoting delivery" or "Never argue about pricing — escalate to owner."',
    'fallback_message is the exact line the bot uses when it does not know — keep it warm and offer to ask the owner.',
    vibeLine(seeds.vibe_preset, tone),
    seeds.greet ? `User-provided opening line guidance: ${seeds.greet}` : '',
    seeds.must_use ? `Must use: ${seeds.must_use}` : '',
    seeds.must_not ? `Must not: ${seeds.must_not}` : '',
    langLine,
  ]
    .filter(Boolean)
    .join('\n')
}

function userPrompt(b: BusinessBasics): string {
  return [
    `Business name: ${b.name}`,
    `Offer: ${b.offer}`,
    `Type: ${b.business_type}`,
    `Audience: ${b.audience}`,
    `Pain solved: ${b.pain}`,
  ].join('\n')
}

function extractJson(raw: string): unknown {
  // Strip code fences like ```json ... ```
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced?.[1] ?? raw).trim()
  // First try the whole string.
  try { return JSON.parse(candidate) } catch { /* fall through */ }
  // Fallback: slice from first { to last } and try again.
  const first = candidate.indexOf('{')
  const last = candidate.lastIndexOf('}')
  if (first !== -1 && last > first) {
    return JSON.parse(candidate.slice(first, last + 1))
  }
  throw new Error('invalid_json')
}

async function callOnce(input: {
  basics: BusinessBasics
  seeds: PersonalitySeeds
  lang: OnboardingLang
}): Promise<GeneratedPersonality> {
  const llm = new HfRouterLlm()
  let raw: string
  try {
    raw = await llm.complete(
      [
        { role: 'system', content: systemPrompt(input.lang, input.seeds, input.basics.tone) },
        { role: 'user', content: userPrompt(input.basics) },
      ],
      { responseFormat: 'json_object', temperature: 0.6, maxTokens: 900 },
    )
  } catch (err) {
    throw new Error('generation_failed: llm_call', { cause: err })
  }
  let parsed: unknown
  try {
    parsed = extractJson(raw)
  } catch {
    throw new Error('generation_failed: invalid_json')
  }
  const r = ResponseSchema.safeParse(parsed)
  if (!r.success) throw new Error('generation_failed: schema_mismatch')
  return r.data
}

export async function generatePersonality(input: {
  basics: BusinessBasics
  seeds: PersonalitySeeds
  lang: OnboardingLang
}): Promise<GeneratedPersonality> {
  try {
    return await callOnce(input)
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    // Retry once on parse / schema failures (transient LLM formatting issues).
    if (msg.includes('invalid_json') || msg.includes('schema_mismatch')) {
      return await callOnce(input)
    }
    throw err
  }
}
