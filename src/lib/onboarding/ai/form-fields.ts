import 'server-only'
import { z } from 'zod'
import { HfRouterLlm } from '@/lib/rag'
import type { BusinessBasics } from '@/lib/onboarding/business-basics'
import type { OnboardingLang } from '@/lib/onboarding/types'
import { extractJson, withJsonRetry } from '@/lib/onboarding/ai/json-extract'
import { BlockSchema, type SuggestedBlock } from '@/lib/onboarding/ai/form-fields-shared'

export type { FormFieldKind, SuggestedBlock } from '@/lib/onboarding/ai/form-fields-shared'

const ResponseSchema = z.object({ blocks: z.array(BlockSchema).min(1).max(15) })

function sys(kind: 'form' | 'qualification', lang: OnboardingLang) {
  const lline = lang === 'tl' ? 'I-label sa Tagalog (Taglish OK).' : 'Label in English.'
  if (kind === 'qualification') {
    return [
      'Generate 3-6 qualification questions for a small Filipino business chatbot.',
      'Each question scores the lead\'s fit (decision maker, budget, timeline, need).',
      'Output JSON: { "blocks": [{ "id": string, "type": "field", "key": string, "field_kind": "single_choice", "prompt": string, "label": string, "required": true, "options": [{ "label": string, "value": string }] }] }',
      lline,
    ].join('\n')
  }
  return [
    'Generate 3-6 form fields for a lead-capture form.',
    'Always include full_name (short_text required) and at least one contact (email or phone).',
    'Output JSON: { "blocks": [{ "id": string, "type": "field", "key": string, "label": string, "field_kind": "short_text"|"long_text"|"email"|"phone"|"number", "required": boolean }] }',
    lline,
  ].join('\n')
}

function usr(b: BusinessBasics) {
  return [`Business: ${b.name}`, `Offer: ${b.offer}`, `Audience: ${b.audience}`, `Pain: ${b.pain}`].join('\n')
}

async function callOnce(input: {
  basics: BusinessBasics
  kind: 'form' | 'qualification'
  lang: OnboardingLang
}): Promise<{ blocks: SuggestedBlock[] }> {
  const llm = new HfRouterLlm()
  let raw: string
  try {
    raw = await llm.complete(
      [{ role: 'system', content: sys(input.kind, input.lang) }, { role: 'user', content: usr(input.basics) }],
      { responseFormat: 'json_object', temperature: 0.5, maxTokens: 900 },
    )
  } catch (err) { throw new Error('generation_failed: llm_call', { cause: err }) }
  let parsed: unknown
  try { parsed = extractJson(raw, { kind: 'form_fields' }) } catch { throw new Error('generation_failed: invalid_json') }
  const r = ResponseSchema.safeParse(parsed)
  if (!r.success) throw new Error('generation_failed: schema_mismatch')
  return r.data
}

export async function generateFormFields(input: {
  basics: BusinessBasics
  kind: 'form' | 'qualification'
  lang: OnboardingLang
}): Promise<{ blocks: SuggestedBlock[] }> {
  return withJsonRetry(() => callOnce(input))
}
