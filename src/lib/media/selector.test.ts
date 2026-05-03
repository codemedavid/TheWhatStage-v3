import { describe, expect, it } from 'vitest'
import { selectMediaForReply, type MediaSelectorClient } from './selector'

const embedder = { embed: async () => Array(1024).fill(0) }

function client(): MediaSelectorClient {
  const assets = [
    { id: 'a1', folder_id: 'f1', name: 'Ryan Review', slug: 'new-review-customer-ryan', description: 'Engineer review', storage_path: 'u/f/a1.jpg', mime_type: 'image/jpeg' },
    { id: 'a2', folder_id: 'f1', name: 'General Review', slug: 'general-review', description: 'Customer review', storage_path: 'u/f/a2.jpg', mime_type: 'image/jpeg' },
    { id: 'a3', folder_id: 'f2', name: 'Sample Build', slug: 'sample-build', description: 'Build sample', storage_path: 'u/f/a3.jpg', mime_type: 'image/jpeg' },
  ]
  const folders = [
    { id: 'f1', slug: 'image-review', name: 'Reviews', description: 'Review images' },
    { id: 'f2', slug: 'samples', name: 'Samples', description: 'Sample images' },
  ]

  return {
    from(table: string) {
      const state: { inCol?: string; inVals?: string[]; eqCol?: string; eqVal?: unknown } = {}
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          state.eqCol = col
          state.eqVal = val
          return builder
        },
        in: (col: string, vals: string[]) => {
          state.inCol = col
          state.inVals = vals
          return Promise.resolve({
            data:
              table === 'media_assets'
                ? assets.filter((a) => state.inCol === 'slug' ? vals.includes(a.slug) : vals.includes(a.id))
                : folders.filter((f) => vals.includes(f.slug)),
            error: null,
          })
        },
        limit: () => Promise.resolve({ data: assets, error: null }),
      }
      return builder
    },
    rpc: async () => ({ data: [{ media_asset_id: 'a2', rrf_score: 0.9 }], error: null }),
  }
}

describe('selectMediaForReply', () => {
  it('prioritizes explicit asset references before semantic matches', async () => {
    const result = await selectMediaForReply({
      client: client(),
      embedder,
      userId: 'u1',
      customerMessage: 'send Ryan review',
      retrievedChunks: [{ id: 'c1', content: 'Use @new-review-customer-ryan and #image-review.', document_id: 'd1', faq_id: null, business_item_id: null, heading_path: null }],
      rpcName: 'match_media_assets_service',
      limit: 4,
    })

    expect(result.map((r) => r.slug)).toEqual(['new-review-customer-ryan', 'general-review'])
  })

  it('caps results at the requested limit', async () => {
    const result = await selectMediaForReply({
      client: client(),
      embedder,
      userId: 'u1',
      customerMessage: 'reviews',
      retrievedChunks: [{ id: 'c1', content: '#image-review', document_id: 'd1', faq_id: null, business_item_id: null, heading_path: null }],
      rpcName: 'match_media_assets_service',
      limit: 1,
    })

    expect(result).toHaveLength(1)
  })
})
