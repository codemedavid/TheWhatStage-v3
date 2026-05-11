import type { SupabaseClient } from '@supabase/supabase-js'
import {
  HfRouterLlm,
  buildPrompt,
  createEmbedder,
  createReranker,
  retrieve,
} from '@/lib/rag'
import { getChatbotConfig } from './config'
import { selectMediaForReply, type SelectedMediaAsset } from '@/lib/media/selector'

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
  /** Lead display name, used by classifier-backed replies to personalize greetings. */
  leadName?: string
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
  const baseConfig = await getChatbotConfig(supabase, userId)
  const cp = options.campaignPersona
  const config = cp
    ? {
        ...baseConfig,
        ...(cp.persona ? { persona: cp.persona } : {}),
        doRules: [...baseConfig.doRules, ...(cp.doRules ?? [])],
        dontRules: [...baseConfig.dontRules, ...(cp.dontRules ?? [])],
        ...(cp.funnelInstruction ? { funnelInstruction: cp.funnelInstruction } : {}),
        ...(cp.instructions !== undefined ? { instructions: cp.instructions } : {}),
      }
    : baseConfig

  const embedder = createEmbedder()
  const reranker = createReranker()
  const llm = new HfRouterLlm()

  const ctx = await retrieve(
    {
      client: supabase,
      embedder,
      reranker,
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

  const system = options.leadContextBlock
    ? `${built.system}\n\n${options.leadContextBlock}`
    : built.system

  const text = await llm.complete(
    [
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: built.user },
    ],
    { temperature: config.temperature, maxTokens: 1500 },
  )

  const [sourceTitles, media] = await Promise.all([
    resolveSourceTitles(supabase, userId, built.contextChunkIds),
    mediaPromise,
  ])
  return { text: text.trim(), sourceTitles, media }
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
