import { describe, expect, it, vi } from 'vitest'
import { isKnowledgeRef, selectMediaForReply, type MediaSelectorClient } from './selector'

const embedder = { embed: async () => Array(1024).fill(0) }

interface TestAsset {
  id: string
  folder_id: string
  name: string
  slug: string
  description: string | null
  storage_path: string
  mime_type: string
  auto_send?: boolean
}

interface TestFolder {
  id: string
  slug: string
  name: string
  description: string | null
}

interface ClientOpts {
  /** Asset ids in hybrid-ranking order (rank 0 first). Omitted ids are unranked. */
  semanticOrder?: string[]
  rpc?: MediaSelectorClient['rpc']
}

/** Minimal PostgREST-style builder that honours eq/in filters on the test data. */
function makeClient(assets: TestAsset[], folders: TestFolder[], opts: ClientOpts = {}): MediaSelectorClient {
  const semantic = opts.semanticOrder ?? assets.map((a) => a.id)
  const rpc =
    opts.rpc ??
    vi.fn(async () => ({
      data: semantic.map((id, rank) => ({ media_asset_id: id, rrf_score: 1 - rank * 0.01 })),
      error: null,
    }))
  return {
    from(table: string) {
      const eqs: Record<string, unknown> = {}
      const ins: Record<string, string[]> = {}
      const run = () => {
        const rows = (table === 'media_assets' ? assets : folders) as unknown as Record<string, unknown>[]
        const filtered = rows.filter((row) => {
          const eqOk = Object.entries(eqs).every(([col, val]) => {
            if (col === 'user_id') return true
            if (col === 'is_archived') return (row.is_archived ?? false) === val
            return row[col] === val
          })
          const inOk = Object.entries(ins).every(([col, vals]) => vals.includes(row[col] as string))
          return eqOk && inOk
        })
        return Promise.resolve({ data: filtered, error: null })
      }
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          eqs[col] = val
          return builder
        },
        in: (col: string, vals: string[]) => {
          ins[col] = vals
          return run()
        },
        limit: () => run(),
      }
      return builder
    },
    rpc,
  }
}

const chunk = (content: string) => ({
  id: 'c1',
  content,
  document_id: 'd1',
  faq_id: null,
  business_item_id: null,
  heading_path: null,
})

const baseAssets: TestAsset[] = [
  { id: 'a1', folder_id: 'f1', name: 'Ryan Review', slug: 'new-review-customer-ryan', description: 'Engineer review', storage_path: 'u/f/a1.jpg', mime_type: 'image/jpeg' },
  { id: 'a2', folder_id: 'f1', name: 'General Review', slug: 'general-review', description: 'Customer review', storage_path: 'u/f/a2.jpg', mime_type: 'image/jpeg' },
  { id: 'a3', folder_id: 'f2', name: 'Sample Build', slug: 'sample-build', description: 'Build sample', storage_path: 'u/f/a3.jpg', mime_type: 'image/jpeg' },
  { id: 'a4', folder_id: 'f2', name: 'Premium Build', slug: 'premium-build', description: null, storage_path: 'u/f/a4.jpg', mime_type: 'image/jpeg' },
]

const baseFolders: TestFolder[] = [
  { id: 'f1', slug: 'image-review', name: 'Reviews', description: 'Review images' },
  { id: 'f2', slug: 'samples', name: 'Samples', description: 'Sample images' },
]

const baseArgs = {
  embedder,
  userId: 'u1',
  rpcName: 'match_media_assets_service' as const,
  limit: 4,
}

describe('selectMediaForReply', () => {
  it('prioritizes explicit @asset references before folder/semantic matches', async () => {
    const result = await selectMediaForReply({
      ...baseArgs,
      client: makeClient(baseAssets, baseFolders, { semanticOrder: ['a2'] }),
      customerMessage: 'send Ryan review',
      retrievedChunks: [chunk('Use @new-review-customer-ryan and #image-review.')],
    })

    // a1 via asset_ref; #image-review picks one best from f1 (a2 ranks first).
    expect(result.map((r) => r.slug)).toEqual(['new-review-customer-ryan', 'general-review'])
    expect(result.map((r) => r.matchReason)).toEqual(['asset_ref', 'folder_ref'])
  })

  it('caps results at the requested limit', async () => {
    const result = await selectMediaForReply({
      ...baseArgs,
      client: makeClient(baseAssets, baseFolders),
      customerMessage: 'reviews',
      retrievedChunks: [chunk('#image-review')],
      limit: 1,
    })

    expect(result).toHaveLength(1)
  })

  it('sends all images in a referenced folder, ordered by semantic ranking', async () => {
    const result = await selectMediaForReply({
      ...baseArgs,
      client: makeClient(baseAssets, baseFolders, { semanticOrder: ['a4', 'a3', 'a1', 'a2'] }),
      customerMessage: 'show me a build',
      retrievedChunks: [chunk('See #samples folder.')],
    })

    const folderHits = result.filter((r) => r.matchReason === 'folder_ref')
    expect(folderHits.map((r) => r.slug)).toEqual(['premium-build', 'sample-build'])
  })

  it('returns nothing when knowledge has no refs and semantic mode is off', async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }))
    const result = await selectMediaForReply({
      ...baseArgs,
      client: makeClient(baseAssets.map((a) => ({ ...a, auto_send: true })), baseFolders, { rpc }),
      customerMessage: 'do you have reviews?',
      retrievedChunks: [chunk('We are open 9-5.')],
    })

    expect(result).toEqual([])
    expect(rpc).not.toHaveBeenCalled()
  })

  describe('instruction refs', () => {
    it('adds @asset and #folder refs from the chatbot instructions as instruction_ref candidates', async () => {
      const result = await selectMediaForReply({
        ...baseArgs,
        client: makeClient(baseAssets, baseFolders, { semanticOrder: ['a3', 'a4'] }),
        customerMessage: 'hi',
        retrievedChunks: [chunk('We are open 9-5.')],
        instructionText: 'When asked for proof send @general-review. For builds use #samples.',
      })

      expect(result.map((r) => [r.slug, r.matchReason])).toEqual([
        ['general-review', 'instruction_ref'],
        ['sample-build', 'instruction_ref'],
        ['premium-build', 'instruction_ref'],
      ])
      expect(result.some(isKnowledgeRef)).toBe(false)
    })

    it('keeps the knowledge reason when the same asset is referenced in both places', async () => {
      const result = await selectMediaForReply({
        ...baseArgs,
        client: makeClient(baseAssets, baseFolders),
        customerMessage: 'proof?',
        retrievedChunks: [chunk('Proof: @general-review')],
        instructionText: 'Always consider @general-review',
      })

      expect(result).toHaveLength(1)
      expect(result[0].matchReason).toBe('asset_ref')
    })
  })

  describe('semantic auto-send candidates', () => {
    const autoAssets: TestAsset[] = [
      { ...baseAssets[0], auto_send: true },
      { ...baseAssets[1], auto_send: true },
      { ...baseAssets[2], auto_send: false },
      { ...baseAssets[3], auto_send: true },
    ]

    it('offers auto_send assets ranked by relevance, without any knowledge reference', async () => {
      const result = await selectMediaForReply({
        ...baseArgs,
        client: makeClient(autoAssets, baseFolders, { semanticOrder: ['a2', 'a3', 'a1', 'a4'] }),
        customerMessage: 'may testimonial po ba kayo?',
        retrievedChunks: [chunk('We are open 9-5.')],
        includeSemantic: true,
      })

      // a3 ranks well but is not auto_send; the rest follow ranking order.
      expect(result.map((r) => r.slug)).toEqual(['general-review', 'new-review-customer-ryan', 'premium-build'])
      expect(result.every((r) => r.matchReason === 'semantic')).toBe(true)
    })

    it('drops auto_send assets that the ranking considers irrelevant (unranked or outside the window)', async () => {
      const farAway = Array.from({ length: 12 }, (_, i) => `other-${i}`)
      const result = await selectMediaForReply({
        ...baseArgs,
        client: makeClient(autoAssets, baseFolders, { semanticOrder: ['a1', ...farAway, 'a2'] }),
        customerMessage: 'reviews please',
        retrievedChunks: [],
        includeSemantic: true,
      })

      // a1 rank 0 → in; a2 rank 13 → out; a4 unranked → out.
      expect(result.map((r) => r.slug)).toEqual(['new-review-customer-ryan'])
    })

    it('respects semanticLimit and the total limit', async () => {
      const result = await selectMediaForReply({
        ...baseArgs,
        client: makeClient(autoAssets, baseFolders, { semanticOrder: ['a1', 'a2', 'a4'] }),
        customerMessage: 'reviews please',
        retrievedChunks: [chunk('Build info: @sample-build')],
        includeSemantic: true,
        semanticLimit: 1,
      })

      expect(result.map((r) => [r.slug, r.matchReason])).toEqual([
        ['sample-build', 'asset_ref'],
        ['new-review-customer-ryan', 'semantic'],
      ])
    })

    it('skips the embedding call when no asset is flagged auto_send', async () => {
      const rpc = vi.fn(async () => ({ data: [], error: null }))
      const result = await selectMediaForReply({
        ...baseArgs,
        client: makeClient(baseAssets, baseFolders, { rpc }),
        customerMessage: 'reviews please',
        retrievedChunks: [],
        includeSemantic: true,
      })

      expect(result).toEqual([])
      expect(rpc).not.toHaveBeenCalled()
    })
  })
})
