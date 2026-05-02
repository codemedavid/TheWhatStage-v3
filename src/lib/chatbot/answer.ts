import type { SupabaseClient } from '@supabase/supabase-js'
import {
  HfRouterLlm,
  buildPrompt,
  createEmbedder,
  createReranker,
  retrieve,
} from '@/lib/rag'
import { getChatbotConfig } from './config'

export type AnswerHistory = { role: 'user' | 'assistant'; content: string }[]

export interface AnswerResult {
  text: string
  sourceTitles: string[]
}

export interface CampaignPersonaOverride {
  persona?: string
  doRules?: string[]
  dontRules?: string[]
  /** Free-form instruction from the lead's active funnel — injected as the primary goal. */
  funnelInstruction?: string
}

export interface AnswerOptions {
  /** When the supabase arg is a service-role admin client (no auth.uid()),
   *  set this to 'match_knowledge_hybrid_service' so retrieval bypasses the
   *  user-auth-scoped RPC. */
  rpcName?: string
  /** When the lead is assigned to a campaign with personality_mode='custom',
   *  pass the campaign's persona/rules here to override the default chatbot config. */
  campaignPersona?: CampaignPersonaOverride
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
  })

  const text = await llm.complete(
    [
      { role: 'system', content: built.system },
      ...history,
      { role: 'user', content: built.user },
    ],
    { temperature: config.temperature, maxTokens: 1500 },
  )

  const sourceTitles = await resolveSourceTitles(supabase, userId, built.contextChunkIds)
  return { text: text.trim(), sourceTitles }
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
