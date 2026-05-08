import { describe, expect, it, vi } from 'vitest'
import { recommendProduct } from './recommend'
import type { Embedder, RerankItem, Reranker, RerankResult } from '@/lib/rag/hf-client'

const ACTION_PAGE_ID = '00000000-0000-4000-8000-000000000aa1'
const USER_ID = '00000000-0000-4000-8000-000000000001'
const PROD_A = '00000000-0000-4000-8000-000000000010'
const PROD_B = '00000000-0000-4000-8000-000000000011'

const fakeEmbedder: Embedder = {
  embed: vi.fn(async () => Array(1024).fill(0)),
  embedBatch: vi.fn(async () => []),
}

function makeReranker(scores: Record<string, number>): Reranker {
  return {
    rank: vi.fn(async (_q: string, items: RerankItem[]): Promise<RerankResult[]> =>
      items
        .map((i) => ({ id: i.id, score: scores[i.id] ?? 0 }))
        .sort((a, b) => b.score - a.score),
    ),
  }
}

interface FakeQuery {
  eq: (col: string, val: unknown) => FakeQuery
  in: (col: string, vals: unknown[]) => FakeQuery
  neq: (col: string, val: unknown) => FakeQuery
  gte: (col: string, val: unknown) => FakeQuery
  lte: (col: string, val: unknown) => FakeQuery
  overlaps: (col: string, val: unknown) => FakeQuery
  maybeSingle: () => Promise<{ data: unknown; error: null }>
  then: <T>(resolve: (v: { data: unknown; error: null }) => T) => Promise<T>
}

function makeClient(opts: {
  page: { id: string; user_id: string; kind: string; config: { product_ids: string[] } } | null
  candidates: Array<Record<string, unknown>>
  hits: Array<{ business_item_id: string; content: string; rrf_score: number }>
}) {
  const filters: Array<[string, string, unknown]> = []

  function makeQuery(table: string): FakeQuery {
    const q: FakeQuery = {
      eq(col, val) {
        filters.push([table, col, val])
        return q
      },
      in(col, vals) {
        filters.push([table, col, vals])
        return q
      },
      neq() {
        return q
      },
      gte() {
        return q
      },
      lte() {
        return q
      },
      overlaps() {
        return q
      },
      async maybeSingle() {
        return { data: opts.page, error: null }
      },
      then(resolve) {
        return Promise.resolve({ data: opts.candidates, error: null }).then(resolve)
      },
    }
    return q
  }

  return {
    from(table: string) {
      return {
        select() {
          return makeQuery(table)
        },
      }
    },
    rpc: vi.fn(async () => ({ data: opts.hits, error: null })),
  } as unknown as Parameters<typeof recommendProduct>[0]['client']
}

describe('recommendProduct', () => {
  it('returns top product when reranker confidence clears threshold', async () => {
    const client = makeClient({
      page: {
        id: ACTION_PAGE_ID,
        user_id: USER_ID,
        kind: 'catalog',
        config: { product_ids: [PROD_A, PROD_B] },
      },
      candidates: [
        {
          id: PROD_A,
          title: 'Mini Drone',
          slug: 'mini-drone',
          summary: 'Beginner-friendly',
          description: null,
          price_amount: 4999,
          currency: 'PHP',
          pricing_model: 'fixed',
          inventory_status: 'in_stock',
          tags: ['drone'],
          cover_image_url: null,
        },
        {
          id: PROD_B,
          title: 'Pro Drone',
          slug: 'pro-drone',
          summary: 'For pros',
          description: null,
          price_amount: 39999,
          currency: 'PHP',
          pricing_model: 'fixed',
          inventory_status: 'in_stock',
          tags: ['drone'],
          cover_image_url: null,
        },
      ],
      hits: [
        { business_item_id: PROD_A, content: 'Mini Drone beginner', rrf_score: 0.04 },
        { business_item_id: PROD_B, content: 'Pro Drone advanced', rrf_score: 0.03 },
      ],
    })

    const result = await recommendProduct(
      { client, embedder: fakeEmbedder, reranker: makeReranker({ [PROD_A]: 0.82, [PROD_B]: 0.4 }) },
      {
        userId: USER_ID,
        actionPageId: ACTION_PAGE_ID,
        query: 'Im a beginner looking for an easy drone',
      },
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.product.id).toBe(PROD_A)
      expect(result.confidence).toBeCloseTo(0.82)
      expect(result.product.price_label).toContain('4,999')
    }
  })

  it('returns low_confidence when top reranker score is below threshold', async () => {
    const client = makeClient({
      page: {
        id: ACTION_PAGE_ID,
        user_id: USER_ID,
        kind: 'catalog',
        config: { product_ids: [PROD_A] },
      },
      candidates: [
        {
          id: PROD_A,
          title: 'Mini Drone',
          slug: 'mini-drone',
          summary: null,
          description: null,
          price_amount: 4999,
          currency: 'PHP',
          pricing_model: 'fixed',
          inventory_status: 'in_stock',
          tags: [],
          cover_image_url: null,
        },
      ],
      hits: [{ business_item_id: PROD_A, content: 'irrelevant', rrf_score: 0.02 }],
    })

    const result = await recommendProduct(
      { client, embedder: fakeEmbedder, reranker: makeReranker({ [PROD_A]: 0.2 }) },
      {
        userId: USER_ID,
        actionPageId: ACTION_PAGE_ID,
        query: 'totally unrelated query',
        confidenceThreshold: 0.55,
      },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('low_confidence')
      expect(result.bestConfidence).toBeCloseTo(0.2)
    }
  })

  it('returns no_products when the catalog has no curated product_ids', async () => {
    const client = makeClient({
      page: { id: ACTION_PAGE_ID, user_id: USER_ID, kind: 'catalog', config: { product_ids: [] } },
      candidates: [],
      hits: [],
    })

    const result = await recommendProduct(
      { client, embedder: fakeEmbedder, reranker: makeReranker({}) },
      { userId: USER_ID, actionPageId: ACTION_PAGE_ID, query: 'anything' },
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('no_products')
  })
})
