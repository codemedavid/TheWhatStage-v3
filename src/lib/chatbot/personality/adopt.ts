import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { HfRouterLlm } from '@/lib/rag/llm'
import { ragConfig } from '@/lib/rag/config'
import type { PersonalityTemplate, GeneratedPersonalityConfig } from './types'

// ---------------------------------------------------------------------------
// Output schema — what the LLM must return
// ---------------------------------------------------------------------------
const GeneratedConfigSchema = z.object({
  name: z.string().min(1).max(60),
  persona: z.string().min(20).max(1000),
  instructions: z.string().min(200).max(3000),
  doRules: z.array(z.string().min(5)).min(2).max(8),
  dontRules: z.array(z.string().min(5)).min(2).max(8),
  fallbackMessage: z.string().min(10).max(300),
  suggestedTemperature: z.number().min(0).max(1),
  adaptationNotes: z.string().max(500),
})

// ---------------------------------------------------------------------------
// Business context gathering
// ---------------------------------------------------------------------------
type ActionPageRef = { slug: string; title: string; kind: string; ctaLabel: string | null; isPrimary: boolean }

type BusinessContext = {
  businessName: string
  businessDescription: string
  currency: string
  productSummary: string
  kbSummary: string
  currentInstructions: string
  currentPersona: string
  actionPages: ActionPageRef[]
  actionPagesSummary: string
  primaryActionPageSlug: string | null
  primaryActionPageTitle: string | null
}

type ChatbotConfigRow = {
  persona: string | null
  instructions: string | null
  name: string | null
  primary_action_page_id: string | null
}

type ActionPageRow = {
  id: string
  slug: string
  title: string
  cta_label: string | null
  kind: string
}

export async function gatherBusinessContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<BusinessContext> {
  const [profileResult, itemsResult, kbResult, configResult, actionPagesResult] = await Promise.all([
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
      .select('persona, instructions, name, primary_action_page_id')
      .eq('user_id', userId)
      .maybeSingle<ChatbotConfigRow>(),

    supabase
      .from('action_pages')
      .select('id, slug, title, cta_label, kind')
      .eq('user_id', userId)
      .eq('status', 'published')
      .order('updated_at', { ascending: false })
      .limit(20)
      .returns<ActionPageRow[]>(),
  ])

  const profile = profileResult.data
  const items = itemsResult.data ?? []
  const docs = kbResult.data ?? []
  const config = configResult.data
  const pages = actionPagesResult.data ?? []
  const primaryId = config?.primary_action_page_id ?? null
  const primaryPage = primaryId ? pages.find((p) => p.id === primaryId) ?? null : null

  const actionPageRefs: ActionPageRef[] = pages.map((p) => ({
    slug: p.slug,
    title: p.title,
    kind: p.kind,
    ctaLabel: p.cta_label?.trim() ? p.cta_label.trim() : null,
    isPrimary: p.id === primaryId,
  }))

  const actionPageLines = actionPageRefs.map((p) => {
    const cta = p.ctaLabel ? `, CTA "${p.ctaLabel}"` : ''
    const primaryTag = p.isPrimary ? ' [PRIMARY GOAL]' : ''
    return `- !actionpage:${p.slug} — ${p.title} (${p.kind}${cta})${primaryTag}`
  })

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
    actionPages: actionPageRefs,
    actionPagesSummary: actionPageLines.length
      ? actionPageLines.join('\n')
      : '(no published action pages — instructions must NOT reference !actionpage tokens)',
    primaryActionPageSlug: primaryPage?.slug ?? null,
    primaryActionPageTitle: primaryPage?.title ?? null,
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

Action pages available to send (use these exact !actionpage:slug tokens inside instructions when the flow says to send one):
${ctx.actionPagesSummary}
${ctx.primaryActionPageSlug
  ? `Primary conversion goal: !actionpage:${ctx.primaryActionPageSlug} — "${ctx.primaryActionPageTitle}". The instructions MUST drive qualified conversations toward this page.`
  : 'No primary conversion goal set. If action pages exist above, pick the most relevant one as the conversion endpoint inside the instructions.'}

---

## CONSTRAINTS — YOU MUST FOLLOW THESE EXACTLY
- PRESERVE FROM ARCHETYPE: the core energy, assertiveness level, and signature phrasing pattern
- PRESERVE FROM BUSINESS (hard constraints — never change): the business name "${ctx.businessName}", currency "${ctx.currency}", real product names as listed above
- PRESERVE USER DIRECTIVES: if the current instructions below contain specific rules or language preferences, keep them
- NEVER invent products, prices, or policies not listed above
- NEVER drop grounding/anti-hallucination rules from the DON'T list
- For Filipino businesses, default language note: match the customer's language. When the customer uses Tagalog or Taglish, reply in CONVERSATIONAL TAGLISH (everyday Filipino mixed with English) — never deep/formal Tagalog. Banned register words: "subaybayan", "pinapatakbo", "nagdedesisyon", "nawawala", "pinakamagandang mangyari", "magdesisyon". Use "i-track", "i-run", "mag-decide", "nawawala sa'yo" only sparingly, "ano ang gusto mong mangyari".
- MANDATORY ANTI-LOOP RULES: the generated doRules MUST include a rule like "Before replying, review what the lead already told you and never re-ask an answered question." The generated dontRules MUST include "Never repeat a question already asked, even rephrased" AND "After the lead says 'di ko alam' or 'not sure' twice on the same topic, stop drilling — give a benchmark and pivot to the next stage."

Current user instructions (preserve any specific directives here):
${ctx.currentInstructions || '(none)'}

---

## THE "instructions" FIELD — THIS IS THE MOST IMPORTANT OUTPUT

The "instructions" field is the operational playbook the chatbot follows in every conversation. Treat it like the internal SOP a top human salesperson would carry in their head: a clear flow from first message to converted action, written as a FRAMEWORK — not a script.

It MUST do all of the following:

1. Define the conversation arc as a sequence of stages the AI moves the customer through. Cover at minimum:
   - Open: acknowledge the customer, set tone, and anchor on what THIS business actually offers (use the products listed above — don't run a generic discovery script that ignores them).
   - Discover: ask the right diagnostic questions to understand what the customer actually needs, their context, and what success looks like for them. Phrase the kinds of questions to ask, not the literal questions. The instructions MUST also tell the AI to track what's already been answered each turn and never repeat a question.
   - Qualify: define what "qualified" means for this business (e.g. budget fit, timing, problem-product fit, decision-making power) and how the AI confirms it through the conversation — not via a checklist dump. State a concrete threshold: e.g. "once 3 of the 4 signals are present, move to Take action."
   - Handle "don't know" answers: explicitly instruct that after the lead says "not sure" / "di ko alam" / "wala akong idea" TWICE on the same data point, the AI must stop asking, offer a benchmark estimate ("usually around X"), and pivot to the next stage. This is non-negotiable.
   - Handle friction: how to address hesitation, pricing pushback, comparison shopping, "I'll think about it", without breaking voice.
   - Take action: at the point the customer is qualified and warm, the AI MUST direct them to the action page by emitting the !actionpage token inline. State explicitly which !actionpage:slug to send and what condition triggers it. Use the primary goal page above unless the discovery clearly points to a different listed page. The instructions MUST forbid stacking more discovery questions on a clearly-qualified lead.

2. Explicitly mention !actionpage:<slug> inside the instructions where the action-page send happens. The runtime parses these tokens — without them, no action page gets attached. Use only slugs that appear in the action pages list above. Never invent slugs.

3. Be FRAMEWORK-LEVEL — vague on wording, specific on behavior. Say what the AI should DO at each stage and what signal triggers the next stage. Do NOT include sample customer-facing lines, quoted phrases, or "say X" examples. The voice/archetype already covers tone; instructions cover flow.

4. Tell the AI what qualifies vs. disqualifies a lead for this specific business, and how to gracefully exit unqualified conversations without sending the action page.

5. Be written as directives to the AI itself (second person, imperative). Use short numbered or dashed steps where helpful. Keep grounding intact: pull facts only from the products and knowledge base above.

Length: 200–450 words, hard cap 3000 characters. Dense, scannable, no fluff.

---

## OUTPUT
Return ONLY valid JSON matching this exact schema. No markdown, no explanation outside the JSON.

{
  "name": "string — the assistant's display name (personalized for this business, fits the archetype)",
  "persona": "string — 2-3 sentences, first-person identity statement in the archetype's voice, grounded in this business",
  "instructions": "string — the sales conversation framework described above, including at least one !actionpage:<slug> token if any action pages exist",
  "doRules": ["array of 3-5 DO rules adapted for this business and archetype"],
  "dontRules": ["array of 3-5 DON'T rules including grounding/anti-hallucination and 'never send the action page before the lead is qualified'"],
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
  // Pin the adopt-template flow to OpenRouter explicitly. We cannot rely on
  // ambient HfRouterLlm defaults because in some environments RAG_LLM_BASE_URL
  // is unset and the SDK falls back to the HF router with the wrong key.
  const baseURL = ragConfig.openrouterBaseUrl
  // Read raw env to avoid the HF_TOKEN fallback baked into ragConfig.llmApiKey
  // — sending an HF token to OpenRouter is exactly the 401 we are debugging.
  const token = process.env.RAG_LLM_API_KEY || ragConfig.openrouterApiKey
  if (!token) {
    throw new Error(
      'Personality adoption needs an OpenRouter key. Set RAG_LLM_API_KEY ' +
        '(preferred) or OPENROUTER_API_KEY in your environment, then redeploy.',
    )
  }
  const llm = new HfRouterLlm({ baseURL, token })
  const prompt = buildAdaptationPrompt(template, ctx)

  let raw: string
  try {
    raw = await llm.complete(
      [
        { role: 'system', content: prompt },
        { role: 'user', content: 'Generate the adapted persona JSON now.' },
      ],
      { temperature: 0.5, maxTokens: 2400, responseFormat: 'json_object' },
    )
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string }
    if (e?.status === 401) {
      throw new Error(
        `OpenRouter rejected the adopt-template request (401 Missing/Invalid Authentication). ` +
          `Verify RAG_LLM_API_KEY is a valid OpenRouter key and that ` +
          `RAG_LLM_BASE_URL=${baseURL} is reachable. Original: ${e.message ?? 'no message'}`,
      )
    }
    throw err
  }

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

  return sanitizeActionPageSlugs(result.data, ctx)
}

// Strip any hallucinated !actionpage:<slug> tokens whose slug doesn't match a
// real published action page. The runtime parses these tokens to attach
// buttons; invalid slugs would silently no-op, leaving the AI promising a link
// it can't actually send. If a primary goal exists and all tokens got stripped,
// substitute the primary slug at the end of instructions so the flow still
// converts.
function sanitizeActionPageSlugs(
  cfg: GeneratedPersonalityConfig,
  ctx: BusinessContext,
): GeneratedPersonalityConfig {
  const validSlugs = new Set(ctx.actionPages.map((p) => p.slug))
  if (validSlugs.size === 0) {
    return {
      ...cfg,
      instructions: cfg.instructions.replace(/!actionpage:[a-z0-9][a-z0-9_-]*/gi, '').replace(/[ \t]{2,}/g, ' ').trim(),
    }
  }

  const seen: string[] = []
  let cleaned = cfg.instructions.replace(/!actionpage:([a-z0-9][a-z0-9_-]*)/gi, (match, slug: string) => {
    const lower = slug.toLowerCase()
    if (validSlugs.has(lower)) {
      if (!seen.includes(lower)) seen.push(lower)
      return `!actionpage:${lower}`
    }
    return ''
  }).replace(/[ \t]{2,}/g, ' ').trim()

  if (seen.length === 0 && ctx.primaryActionPageSlug) {
    cleaned = `${cleaned}\n\nWhen the lead is qualified, send the action page by emitting: !actionpage:${ctx.primaryActionPageSlug}`
  }

  return { ...cfg, instructions: cleaned }
}
