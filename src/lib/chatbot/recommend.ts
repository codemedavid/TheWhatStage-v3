import type { SupabaseClient } from '@supabase/supabase-js'
import { formatPrice } from '@/lib/business/pricing'
import type { InventoryStatus, PricingModel } from '@/lib/business/types'
import type { Embedder, Reranker } from '@/lib/rag/hf-client'
import { createEmbedder, createReranker } from '@/lib/rag/factory'

export interface RecommendFilters {
  priceMin?: number | null
  priceMax?: number | null
  tags?: string[]
  includeOutOfStock?: boolean
}

export interface RecommendedProduct {
  id: string
  title: string
  slug: string
  summary: string | null
  description: string | null
  price_amount: number | null
  currency: string
  pricing_model: PricingModel
  price_label: string
  inventory_status: InventoryStatus
  tags: string[]
  cover_image_url: string | null
}

export type RecommendResult =
  | { ok: true; product: RecommendedProduct; confidence: number }
  | {
      ok: false
      reason: 'no_action_page' | 'no_products' | 'no_match' | 'low_confidence'
      bestConfidence?: number
    }

export interface RecommendDeps {
  client: SupabaseClient
  embedder?: Embedder
  reranker?: Reranker
}

export interface RecommendInput {
  userId: string
  actionPageId: string
  query: string
  filters?: RecommendFilters
  /** Reranker score (0–1) below which we refuse to recommend. Default 0.55. */
  confidenceThreshold?: number
  /** Hybrid-search candidate pool. Default 30. */
  candidateLimit?: number
}

interface ActionPageRow {
  id: string
  user_id: string
  kind: string
  config: { product_ids?: string[] } | null
}

interface CandidateRow {
  id: string
  title: string
  slug: string
  summary: string | null
  description: string | null
  price_amount: number | string | null
  currency: string
  pricing_model: PricingModel
  inventory_status: InventoryStatus
  tags: string[] | null
  cover_image_url: string | null
}

interface ChunkHit {
  business_item_id: string | null
  content: string
  rrf_score: number
}

const DEFAULT_THRESHOLD = 0.55
const DEFAULT_CANDIDATE_LIMIT = 30

export async function recommendProduct(
  deps: RecommendDeps,
  input: RecommendInput,
): Promise<RecommendResult> {
  const threshold = input.confidenceThreshold ?? DEFAULT_THRESHOLD

  const { data: pageRow, error: pageErr } = await deps.client
    .from('action_pages')
    .select('id, user_id, kind, config')
    .eq('id', input.actionPageId)
    .eq('user_id', input.userId)
    .maybeSingle<ActionPageRow>()
  if (pageErr) throw new Error(`recommendProduct: load page failed: ${pageErr.message}`)
  if (!pageRow) return { ok: false, reason: 'no_action_page' }

  const curatedIds = pageRow.config?.product_ids ?? []
  if (curatedIds.length === 0) return { ok: false, reason: 'no_products' }

  const candidates = await loadCandidates(deps.client, input.userId, curatedIds, input.filters)
  if (candidates.length === 0) return { ok: false, reason: 'no_products' }

  const candidateIds = candidates.map((c) => c.id)
  const embedder = deps.embedder ?? createEmbedder()
  const reranker = deps.reranker ?? createReranker()

  const qvec = await embedder.embed(input.query)
  const { data: hits, error: rpcErr } = await deps.client.rpc(
    'match_business_items_hybrid_service',
    {
      p_user_id: input.userId,
      p_query_text: input.query,
      p_query_embed: qvec,
      p_item_ids: candidateIds,
      p_match_limit: input.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT,
    },
  )
  if (rpcErr) throw new Error(`recommendProduct: rpc failed: ${rpcErr.message}`)

  const bestPerItem = pickBestChunkPerItem((hits ?? []) as ChunkHit[])
  if (bestPerItem.size === 0) return { ok: false, reason: 'no_match' }

  const rankItems = Array.from(bestPerItem.entries()).map(([itemId, hit]) => ({
    id: itemId,
    text: hit.content,
  }))
  const ranked = await reranker.rank(input.query, rankItems)
  if (ranked.length === 0) return { ok: false, reason: 'no_match' }

  const top = ranked[0]
  if (top.score < threshold) {
    return { ok: false, reason: 'low_confidence', bestConfidence: top.score }
  }

  const winner = candidates.find((c) => c.id === top.id)
  if (!winner) return { ok: false, reason: 'no_match' }

  return { ok: true, product: toRecommendedProduct(winner), confidence: top.score }
}

async function loadCandidates(
  client: SupabaseClient,
  userId: string,
  ids: string[],
  filters: RecommendFilters | undefined,
): Promise<CandidateRow[]> {
  let query = client
    .from('business_items')
    .select(
      'id, title, slug, summary, description, price_amount, currency, pricing_model, inventory_status, tags, cover_image_url',
    )
    .eq('user_id', userId)
    .eq('kind', 'product')
    .eq('status', 'published')
    .eq('rag_enabled', true)
    .in('id', ids)

  if (!filters?.includeOutOfStock) {
    query = query.neq('inventory_status', 'out_of_stock')
  }
  if (filters?.priceMin !== undefined && filters.priceMin !== null) {
    query = query.gte('price_amount', filters.priceMin)
  }
  if (filters?.priceMax !== undefined && filters.priceMax !== null) {
    query = query.lte('price_amount', filters.priceMax)
  }
  if (filters?.tags && filters.tags.length > 0) {
    query = query.overlaps('tags', filters.tags)
  }

  const { data, error } = await query
  if (error) throw new Error(`recommendProduct: load candidates failed: ${error.message}`)
  return (data ?? []) as CandidateRow[]
}

function pickBestChunkPerItem(hits: ChunkHit[]): Map<string, ChunkHit> {
  const out = new Map<string, ChunkHit>()
  for (const h of hits) {
    if (!h.business_item_id) continue
    const cur = out.get(h.business_item_id)
    if (!cur || h.rrf_score > cur.rrf_score) out.set(h.business_item_id, h)
  }
  return out
}

function toRecommendedProduct(row: CandidateRow): RecommendedProduct {
  const price =
    row.price_amount === null || row.price_amount === undefined ? null : Number(row.price_amount)
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    description: row.description,
    price_amount: price,
    currency: row.currency,
    pricing_model: row.pricing_model,
    price_label: formatPrice({
      amount: price,
      currency: row.currency,
      pricingModel: row.pricing_model,
    }),
    inventory_status: row.inventory_status,
    tags: Array.isArray(row.tags) ? row.tags : [],
    cover_image_url: row.cover_image_url,
  }
}
