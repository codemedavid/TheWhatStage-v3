import type { SupabaseClient } from '@supabase/supabase-js'
import {
  HfRouterLlm,
  buildPrompt,
  createEmbedder,
  retrieve,
} from '@/lib/rag'
import { getChatbotConfig, type ChatbotConfig } from './config'
import { loadPrimaryGoalInstruction } from './primary-goal'
import { selectMediaForReply, type SelectedMediaAsset } from '@/lib/media/selector'
import { buildMediaContextBlock } from '@/lib/media/prompt'
import { paymentEnumBlock as buildPaymentEnumBlock } from '@/lib/chatbot/payment-enum'

export type AnswerHistory = { role: 'user' | 'assistant'; content: string }[]

export interface AnswerResult {
  text: string
  sourceTitles: string[]
  media: SelectedMediaAsset[]
}

export interface CampaignPersonaOverride {
  persona?: string
  doRules?: string[]
  dontRules?: string[]
  /** Free-form instruction from the lead's active funnel — injected as the primary goal. */
  funnelInstruction?: string
  /** Resolved instructions override — !actionpage:slug tokens substituted with page titles. */
  instructions?: string
}

export interface AnswerOptions {
  /** When the supabase arg is a service-role admin client (no auth.uid()),
   *  set this to 'match_knowledge_hybrid_service' so retrieval bypasses the
   *  user-auth-scoped RPC. */
  rpcName?: string
  /** When the lead is assigned to a campaign with personality_mode='custom',
   *  pass the campaign's persona/rules here to override the default chatbot config. */
  campaignPersona?: CampaignPersonaOverride
  /** Rolling summary of older turns beyond the history window. Injected into the
   *  system prompt so the bot retains context from early in long conversations. */
  conversationSummary?: string
  /** Pre-rendered, closed-world snapshot of this lead's bookings, orders,
   *  qualification, and form submissions. Appended to the system prompt so the
   *  bot can answer "when is my booking?"-style questions without hallucinating.
   *  Empty string when the lead has no records. */
  leadContextBlock?: string
  /** Full name of the lead (e.g. from Facebook profile). Only the first name
   *  is injected into the prompt so the bot can address the customer naturally. */
  leadName?: string
  /** Preloaded chatbot config. When supplied, callers skip the per-call
   *  getChatbotConfig fetch — used by the Messenger worker to dedupe the
   *  chatbot_configs read across the reply pipeline. */
  preloadedConfig?: ChatbotConfig
}

/**
 * Run the full RAG pipeline for a single user turn and return the complete reply.
 * Used by the Messenger worker (non-streaming). The /api/chatbot/test route
 * still streams via the same lib pieces directly.
 */
export async function answer(
  supabase: SupabaseClient,
  userId: string,
  message: string,
  history: AnswerHistory = [],
  options: AnswerOptions = {},
): Promise<AnswerResult> {
  const baseConfig = options.preloadedConfig ?? (await getChatbotConfig(supabase, userId))
  const cp = options.campaignPersona

  // Resolve the primary goal block: campaign funnelInstruction wins; otherwise
  // fall back to the chatbot's configured primary action page.
  const campaignGoal = cp?.funnelInstruction?.trim()
  const chatbotGoal = campaignGoal
    ? null
    : await loadPrimaryGoalInstruction(supabase, userId)
  const funnelInstruction = campaignGoal || chatbotGoal || undefined

  const config = cp
    ? {
        ...baseConfig,
        ...(cp.persona ? { persona: cp.persona } : {}),
        doRules: [...baseConfig.doRules, ...(cp.doRules ?? [])],
        dontRules: [...baseConfig.dontRules, ...(cp.dontRules ?? [])],
        ...(funnelInstruction ? { funnelInstruction } : {}),
        ...(cp.instructions !== undefined ? { instructions: cp.instructions } : {}),
      }
    : funnelInstruction
      ? { ...baseConfig, funnelInstruction }
      : baseConfig

  const embedder = createEmbedder()
  const paymentBlock = await buildPaymentEnumBlock(supabase, userId, null, null).catch(() => '')
  const llm = new HfRouterLlm()

  const ctx = await retrieve(
    {
      client: supabase,
      embedder,
      rewriteQuery: (q) => llm.rewriteQuery(q),
      rpcName: options.rpcName,
    },
    { userId, query: message },
  )

  const built = buildPrompt({
    userQuery: message,
    buckets: ctx.buckets,
    config,
    maxContext: config.maxContext,
    conversationSummary: options.conversationSummary,
    paymentEnumBlock: paymentBlock,
  })

  // Scan ALL retrieved chunks (including grader-rejected ones) for @asset /
  // #folder references. A standalone slug paragraph often gets a near-zero
  // rerank score and lands in `reject`, which would otherwise hide its image
  // even though the user explicitly attached it in the knowledge doc.
  const refChunks = [
    ...ctx.buckets.useful,
    ...ctx.buckets.ambiguous,
    ...ctx.buckets.reject,
  ]
  const mediaPromise = selectMediaForReply({
    client: supabase,
    embedder,
    userId,
    customerMessage: message,
    retrievedChunks: refChunks,
    rpcName: options.rpcName === 'match_knowledge_hybrid_service' ? 'match_media_assets_service' : 'match_media_assets',
    limit: 4,
  }).catch((err) => {
    console.warn('[chatbot.media] selection failed', err)
    return [] as SelectedMediaAsset[]
  })

  const firstName = options.leadName?.split(' ')[0]?.trim()
  const leadNameBlock = firstName
    ? `# Lead\nThe customer's first name is ${firstName}. Address them by their first name when greeting or when it feels natural.`
    : null

  // Resolve media BEFORE the LLM call so the model can tee up the attached
  // images naturally instead of producing a reply that ignores them.
  const media = await mediaPromise
  const mediaBlock = buildMediaContextBlock(media)

  const system = [built.system, leadNameBlock, options.leadContextBlock?.trim() || null, mediaBlock]
    .filter(Boolean)
    .join('\n\n')

  const t0 = Date.now()
  const completion = await llm.completeWithUsage(
    [
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: built.user },
    ],
    { temperature: config.temperature, maxTokens: 400 },
  )
  logChatbotUsage('chatbot.answer', {
    model: completion.model,
    promptTokens: completion.usage?.promptTokens ?? null,
    completionTokens: completion.usage?.completionTokens ?? null,
    finishReason: completion.finishReason,
    kbChunks: built.contextChunks.length,
    historyTurns: history.length,
    summaryLen: options.conversationSummary?.length ?? 0,
    systemChars: system.length,
    ms: Date.now() - t0,
  })

  const sourceTitles = await resolveSourceTitles(supabase, userId, built.contextChunkIds)
  console.log('[chatbot.answer] media resolved', {
    userId,
    count: media.length,
    slugs: media.map((m) => m.slug),
    refChunkCount: refChunks.length,
  })

  // Anti-hallucination guard: if the model invented a phone number, URL, or
  // email that is NOT present in the retrieved context or system prompt,
  // discard the reply and fall back. Prompt rules alone don't reliably stop
  // the model from fabricating plausible-looking contact details.
  let text = sanitizeReply(completion.text)
  const grounding = [system, ...built.contextChunks.map((c) => c.content), message].join('\n')
  const ungrounded = findUngroundedContacts(text, grounding)
  if (ungrounded.length > 0) {
    console.warn('[chatbot.answer] dropping reply with ungrounded contact details', {
      ungrounded,
      original: text,
    })
    text = config.fallbackMessage
  }

  return { text, sourceTitles, media }
}

/**
 * Find phone numbers, URLs, and email addresses in `reply` that do not appear
 * in `grounding`. Returns the offending strings so they can be logged.
 * Normalises phone formatting (strips spaces, dashes, parens) before
 * comparing so "0917-123-4567" matches "09171234567" in the knowledge base.
 */
export function findUngroundedContacts(reply: string, grounding: string): string[] {
  const normDigits = grounding.replace(/\D/g, '')
  const groundingLower = grounding.toLowerCase()
  const out: string[] = []

  // Phone numbers: 7+ digits, optional + and common separators.
  const phoneRe = /(?:\+?\d[\d\s\-().]{6,}\d)/g
  for (const m of reply.match(phoneRe) ?? []) {
    const digits = m.replace(/\D/g, '')
    if (digits.length >= 7 && !normDigits.includes(digits)) {
      out.push(m.trim())
    }
  }

  // URLs / bare domains. Skip obvious non-claims like "e.g." by requiring
  // a known TLD-ish tail and at least one dot.
  const urlRe = /\b(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}(?:\/[^\s),.;!?]*)?/gi
  for (const m of reply.match(urlRe) ?? []) {
    const host = m
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      .toLowerCase()
    // Ignore filename-looking matches (e.g. "file.json") with no real TLD.
    const tld = host.split('.').pop() ?? ''
    if (tld.length < 2) continue
    if (!groundingLower.includes(host)) {
      out.push(m)
    }
  }

  // Emails.
  const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi
  for (const m of reply.match(emailRe) ?? []) {
    if (!groundingLower.includes(m.toLowerCase())) {
      out.push(m)
    }
  }

  return out
}

/**
 * Strip dashes the model leans on as a tell. " — " becomes ", ", a bare em/en
 * dash becomes a comma. Keeps regular ASCII hyphens untouched.
 */
function sanitizeReply(raw: string): string {
  return raw
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/,\s*,/g, ',')
    .trim()
}

/**
 * Pure predicate for the rolling-summary trigger. Fire when the full thread
 * history exceeds the LLM window (so we'd otherwise be dropping older turns)
 * AND we've crossed the next interval boundary. Extracted so we can unit-test
 * without the supabase + LLM scaffolding around it.
 */
export function shouldRollSummary(
  historyLength: number,
  llmWindow: number,
  intervalTurns: number,
): boolean {
  if (historyLength <= llmWindow) return false
  const overflow = historyLength - llmWindow
  return overflow > 0 && overflow % intervalTurns === 0
}

export type ChatbotUsageScope =
  | 'chatbot.answer'
  | 'chatbot.classify'
  | 'chatbot.answer.fallback'

export interface ChatbotUsageFields {
  model: string
  promptTokens: number | null
  completionTokens: number | null
  finishReason: string | null
  kbChunks: number
  historyTurns: number
  summaryLen: number
  systemChars: number
  ms: number
}

export function logChatbotUsage(scope: ChatbotUsageScope, fields: ChatbotUsageFields): void {
  // Single structured log line; parseable in Vercel/whatever-aggregator.
  console.log(`[${scope}]`, fields)
}

/**
 * Generate a 2-3 sentence summary of the conversation so far.
 * Used to compress older turns into the prompt when history exceeds the window.
 */
export async function summarizeConversation(
  history: AnswerHistory,
  latestUserMsg: string,
  botReply: string,
  existingSummary?: string | null,
): Promise<string> {
  const llm = new HfRouterLlm()
  const lines: string[] = []
  if (existingSummary?.trim()) {
    lines.push(`[Earlier summary: ${existingSummary.trim()}]`, '')
  }
  for (const m of history) {
    lines.push(`${m.role === 'user' ? 'Customer' : 'Bot'}: ${m.content}`)
  }
  lines.push(`Customer: ${latestUserMsg}`, `Bot: ${botReply}`)
  const result = await llm.complete(
    [
      {
        role: 'system',
        content:
          'Summarize the key topics, customer needs, and any commitments discussed in this conversation. Be concise — 2-3 sentences max.',
      },
      { role: 'user', content: lines.join('\n') },
    ],
    { temperature: 0, maxTokens: 200 },
  )
  return result.trim()
}

async function resolveSourceTitles(
  supabase: SupabaseClient,
  userId: string,
  chunkIds: string[],
): Promise<string[]> {
  if (chunkIds.length === 0) return []

  const { data: chunks } = await supabase
    .from('knowledge_chunks')
    .select('id, document_id, faq_id, business_item_id')
    .eq('user_id', userId)
    .in('id', chunkIds)

  if (!chunks || chunks.length === 0) return []

  const docIds = Array.from(
    new Set(chunks.map((c) => c.document_id).filter(Boolean) as string[]),
  )
  const faqIds = Array.from(
    new Set(chunks.map((c) => c.faq_id).filter(Boolean) as string[]),
  )
  const businessItemIds = Array.from(
    new Set(chunks.map((c) => c.business_item_id).filter(Boolean) as string[]),
  )

  const [docsRes, faqsRes, businessItemsRes] = await Promise.all([
    docIds.length
      ? supabase.from('knowledge_documents').select('id, title').in('id', docIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    faqIds.length
      ? supabase.from('knowledge_faqs').select('id, question').in('id', faqIds)
      : Promise.resolve({ data: [] as { id: string; question: string }[] }),
    businessItemIds.length
      ? supabase.from('business_items').select('id, title').in('id', businessItemIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
  ])

  const docTitle = new Map((docsRes.data ?? []).map((d) => [d.id, d.title]))
  const faqTitle = new Map((faqsRes.data ?? []).map((f) => [f.id, f.question]))
  const businessItemTitle = new Map((businessItemsRes.data ?? []).map((i) => [i.id, i.title]))

  const seen = new Set<string>()
  const titles: string[] = []
  for (const c of chunks) {
    const title =
      (c.document_id && docTitle.get(c.document_id)) ||
      (c.faq_id && faqTitle.get(c.faq_id)) ||
      (c.business_item_id && businessItemTitle.get(c.business_item_id)) ||
      null
    if (title && !seen.has(title)) {
      seen.add(title)
      titles.push(title)
    }
  }
  return titles
}
