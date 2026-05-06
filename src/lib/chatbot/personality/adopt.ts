import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { HfRouterLlm } from '@/lib/rag/llm'
import type { PersonalityTemplate } from './types'
import type { GeneratedPersonalityConfig } from './types'

// ---------------------------------------------------------------------------
// Output schema — what the LLM must return
// ---------------------------------------------------------------------------
const GeneratedConfigSchema = z.object({
  name: z.string().min(1).max(60),
  persona: z.string().min(20).max(1000),
  instructions: z.string().max(2000),
  doRules: z.array(z.string().min(5)).min(2).max(8),
  dontRules: z.array(z.string().min(5)).min(2).max(8),
  fallbackMessage: z.string().min(10).max(300),
  suggestedTemperature: z.number().min(0).max(1),
  adaptationNotes: z.string().max(500),
})

// ---------------------------------------------------------------------------
// Business context gathering
// ---------------------------------------------------------------------------
type BusinessContext = {
  businessName: string
  businessDescription: string
  currency: string
  productSummary: string
  kbSummary: string
  currentInstructions: string
  currentPersona: string
}

export async function gatherBusinessContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<BusinessContext> {
  const [profileResult, itemsResult, kbResult, configResult] = await Promise.all([
    supabase
      .from('business_profiles')
      .select('display_name, description, default_currency')
      .eq('user_id', userId)
      .maybeSingle(),

    supabase
      .from('business_items')
      .select('title, summary, price_amount, currency, kind, tags')
      .eq('user_id', userId)
      .eq('status', 'published')
      .order('updated_at', { ascending: false })
      .limit(20),

    supabase
      .from('knowledge_documents')
      .select('title, content_text')
      .eq('user_id', userId)
      .not('published_at', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(8),

    supabase
      .from('chatbot_configs')
      .select('persona, instructions, name')
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  const profile = profileResult.data
  const items = itemsResult.data ?? []
  const docs = kbResult.data ?? []
  const config = configResult.data

  const productLines = items.map((item: Record<string, unknown>) => {
    const price = item.price_amount
      ? `${item.currency ?? 'PHP'} ${item.price_amount}`
      : 'price varies'
    const tags = (item.tags as string[])?.length ? ` [${(item.tags as string[]).join(', ')}]` : ''
    return `- ${item.title} (${item.kind}, ${price})${tags}: ${item.summary ?? '(no summary)'}`
  })

  const kbLines = docs.map((doc: Record<string, unknown>) => {
    const excerpt = doc.content_text
      ? (doc.content_text as string).slice(0, 200).replace(/\s+/g, ' ').trim()
      : '(no content)'
    return `- ${doc.title}: ${excerpt}…`
  })

  return {
    businessName: profile?.display_name ?? 'this business',
    businessDescription: profile?.description ?? '(no description provided)',
    currency: profile?.default_currency ?? 'PHP',
    productSummary: productLines.length
      ? productLines.join('\n')
      : '(no published products yet)',
    kbSummary: kbLines.length
      ? kbLines.join('\n')
      : '(no knowledge documents yet)',
    currentInstructions: config?.instructions ?? '',
    currentPersona: config?.persona ?? '',
  }
}

// ---------------------------------------------------------------------------
// Build the adaptation prompt
// ---------------------------------------------------------------------------
function buildAdaptationPrompt(
  template: PersonalityTemplate,
  ctx: BusinessContext,
): string {
  return `You are a brand voice translator. Your job is to adapt a voice archetype into a concrete, business-specific chatbot persona.

## VOICE ARCHETYPE: ${template.name}
Inspired by: ${template.inspiredBy}
Essence: ${template.voiceDescriptor}

Sample persona: ${template.samplePersona}
Sample DO rules:
${template.sampleDoRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}
Sample DON'T rules:
${template.sampleDontRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}
Signature phrases: ${template.signaturePhrases.join(' | ')}

---

## BUSINESS CONTEXT
Business name: ${ctx.businessName}
Description: ${ctx.businessDescription}
Currency: ${ctx.currency}

Products/services (published):
${ctx.productSummary}

Knowledge base topics:
${ctx.kbSummary}

---

## CONSTRAINTS — YOU MUST FOLLOW THESE EXACTLY
- PRESERVE FROM ARCHETYPE: the core energy, assertiveness level, and signature phrasing pattern
- PRESERVE FROM BUSINESS (hard constraints — never change): the business name "${ctx.businessName}", currency "${ctx.currency}", real product names as listed above
- PRESERVE USER DIRECTIVES: if the current instructions below contain specific rules or language preferences, keep them
- NEVER invent products, prices, or policies not listed above
- NEVER drop grounding/anti-hallucination rules from the DON'T list
- For Filipino businesses, default language note: match the customer's language (Tagalog/English/Taglish)

Current user instructions (preserve any specific directives here):
${ctx.currentInstructions || '(none)'}

---

## OUTPUT
Return ONLY valid JSON matching this exact schema. No markdown, no explanation outside the JSON.

{
  "name": "string — the assistant's display name (personalized for this business, fits the archetype)",
  "persona": "string — 2-3 sentences, first-person identity statement in the archetype's voice, grounded in this business",
  "instructions": "string — 3-5 specific operational directives, plain sentences, informed by the business context and preserved user directives",
  "doRules": ["array of 3-5 DO rules adapted for this business and archetype"],
  "dontRules": ["array of 3-5 DON'T rules including grounding/anti-hallucination"],
  "fallbackMessage": "string — fallback in the archetype's voice, appropriate for this business's language style",
  "suggestedTemperature": number between 0.0 and 1.0,
  "adaptationNotes": "string — 1-2 sentences describing what you changed and why, for the user to read"
}`
}

// ---------------------------------------------------------------------------
// Main adaptation call
// ---------------------------------------------------------------------------
export async function adaptPersonality(
  template: PersonalityTemplate,
  ctx: BusinessContext,
): Promise<GeneratedPersonalityConfig> {
  const llm = new HfRouterLlm()
  const prompt = buildAdaptationPrompt(template, ctx)

  const raw = await llm.complete(
    [
      { role: 'system', content: prompt },
      { role: 'user', content: 'Generate the adapted persona JSON now.' },
    ],
    { temperature: 0.5, maxTokens: 1200, responseFormat: 'json_object' },
  )

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Adaptation failed: LLM returned invalid JSON. Please try again.')
  }

  const result = GeneratedConfigSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`Adaptation failed: output did not match expected shape. ${result.error.message}`)
  }

  return result.data
}
