import { describe, expect, it, vi } from 'vitest'
import { recommendProperty } from './recommend-property'
import type { Embedder, RerankItem, Reranker, RerankResult } from '@/lib/rag/hf-client'

const ACTION_PAGE_ID = '00000000-0000-4000-8000-000000000aa1'
const USER_ID = '00000000-0000-4000-8000-000000000001'
const PROP_A = '00000000-0000-4000-8000-000000000020'

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
  filter: (...args: unknown[]) => FakeQuery
  maybeSingle: () => Promise<{ data: unknown; error: null }>
  then: <T>(resolve: (v: { data: unknown; error: null }) => T) => Promise<T>
}

function makeClient(opts: {
  page: { id: string; user_id: string; kind: string; config: { properties: Array<{ id: string }> } } | null
  candidates: Array<Record<string, unknown>>
  hits: Array<{ business_item_id: string; content: string; rrf_score: number }>
}) {
  function makeQuery(table: string): FakeQuery {
    const q: FakeQuery = {
      eq: () => q,
      in: () => q,
      neq: () => q,
      gte: () => q,
      lte: () => q,
      overlaps: () => q,
      filter: () => q,
      async maybeSingle() {
        if (table === 'action_pages') return { data: opts.page, error: null }
        return { data: null, error: null }
      },
      then(resolve) {
        return Promise.resolve({ data: opts.candidates, error: null }).then(resolve)
      },
    }
    return q
  }
  return {
    from(table: string) {
      return { select: () => makeQuery(table) }
    },
    rpc: vi.fn(async () => ({ data: opts.hits, error: null })),
  } as unknown as Parameters<typeof recommendProperty>[0]['client']
}

describe('recommendProperty', () => {
  it('returns no_action_page when page not found', async () => {
    const client = makeClient({ page: null, candidates: [], hits: [] })
    const r = await recommendProperty(
      { client, embedder: fakeEmbedder, reranker: makeReranker({}) },
      { userId: USER_ID, actionPageId: ACTION_PAGE_ID, query: 'condo' },
    )
    expect(r).toEqual({ ok: false, reason: 'no_action_page' })
  })

  it('returns no_products when properties array is empty', async () => {
    const client = makeClient({
      page: { id: ACTION_PAGE_ID, user_id: USER_ID, kind: 'realestate', config: { properties: [] } },
      candidates: [],
      hits: [],
    })
    const r = await recommendProperty(
      { client, embedder: fakeEmbedder, reranker: makeReranker({}) },
      { userId: USER_ID, actionPageId: ACTION_PAGE_ID, query: 'condo' },
    )
    expect(r).toEqual({ ok: false, reason: 'no_products' })
  })

  it('returns ok with the right shape on a confident match', async () => {
    const client = makeClient({
      page: {
        id: ACTION_PAGE_ID,
        user_id: USER_ID,
        kind: 'realestate',
        config: { properties: [{ id: 'a' }, { id: 'b' }] },
      },
      candidates: [
        {
          id: PROP_A,
          title: 'Cebu Condo',
          slug: 'p-a',
          summary: 'Cebu City, Cebu',
          description: 'A nice condo',
          price_amount: 5_000_000,
          currency: 'PHP',
          pricing_model: 'fixed',
          inventory_status: 'in_stock',
          tags: ['condo'],
          cover_image_url: 'https://i/a.jpg',
          details: { property_status: 'for_sale', address: { city: 'Cebu City', region: 'Cebu' } },
        },
      ],
      hits: [{ business_item_id: PROP_A, content: 'condo blurb', rrf_score: 0.9 }],
    })
    const r = await recommendProperty(
      { client, embedder: fakeEmbedder, reranker: makeReranker({ [PROP_A]: 0.95 }) },
      { userId: USER_ID, actionPageId: ACTION_PAGE_ID, query: 'condo in cebu' },
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.product.title).toBe('Cebu Condo')
      expect(r.product.slug).toBe('p-a')
      expect(r.product.city).toBe('Cebu City')
      expect(r.product.region).toBe('Cebu')
      expect(r.product.property_status).toBe('for_sale')
      expect(r.confidence).toBeCloseTo(0.95)
    }
  })

  it('returns low_confidence when reranker top score is below threshold', async () => {
    const client = makeClient({
      page: {
        id: ACTION_PAGE_ID,
        user_id: USER_ID,
        kind: 'realestate',
        config: { properties: [{ id: 'a' }] },
      },
      candidates: [
        {
          id: PROP_A,
          title: 'Some Property',
          slug: 'p-a',
          summary: null,
          description: null,
          price_amount: 1_000_000,
          currency: 'PHP',
          pricing_model: 'fixed',
          inventory_status: 'in_stock',
          tags: [],
          cover_image_url: null,
          details: { property_status: 'for_sale', address: { city: '', region: '' } },
        },
      ],
      hits: [{ business_item_id: PROP_A, content: 'blurb', rrf_score: 0.4 }],
    })
    const r = await recommendProperty(
      { client, embedder: fakeEmbedder, reranker: makeReranker({ [PROP_A]: 0.2 }) },
      { userId: USER_ID, actionPageId: ACTION_PAGE_ID, query: 'condo', confidenceThreshold: 0.5 },
    )
    expect(r).toMatchObject({ ok: false, reason: 'low_confidence', bestConfidence: 0.2 })
  })
})
