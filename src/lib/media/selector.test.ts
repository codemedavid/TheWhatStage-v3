import { describe, expect, it } from 'vitest'
import { selectMediaForReply, type MediaSelectorClient } from './selector'

const embedder = { embed: async () => Array(1024).fill(0) }

interface TestAsset {
  id: string
  folder_id: string
  name: string
  slug: string
  description: string | null
  storage_path: string
  mime_type: string
}

interface TestFolder {
  id: string
  slug: string
  name: string
  description: string | null
}

interface ClientOpts {
  semanticOrder?: string[]
}

function makeClient(
  assets: TestAsset[],
  folders: TestFolder[],
  opts: ClientOpts = {},
): MediaSelectorClient {
  const semantic = opts.semanticOrder ?? assets.map((a) => a.id)
  return {
    from(table: string) {
      const state: { inCol?: string; inVals?: string[] } = {}
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: (col: string, vals: string[]) => {
          state.inCol = col
          state.inVals = vals
          return Promise.resolve({
            data:
              table === 'media_assets'
                ? assets.filter((a) =>
                    state.inCol === 'slug'
                      ? vals.includes(a.slug)
                      : state.inCol === 'folder_id'
                        ? vals.includes(a.folder_id)
                        : vals.includes(a.id),
                  )
                : folders.filter((f) => vals.includes(f.slug)),
            error: null,
          })
        },
        limit: () => Promise.resolve({ data: assets, error: null }),
      }
      return builder
    },
    rpc: async () => ({
      data: semantic.map((id, rank) => ({ media_asset_id: id, rrf_score: 1 - rank * 0.01 })),
      error: null,
    }),
  }
}

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

describe('selectMediaForReply', () => {
  it('prioritizes explicit @asset references before folder/semantic matches', async () => {
    const result = await selectMediaForReply({
      client: makeClient(baseAssets, baseFolders, { semanticOrder: ['a2'] }),
      embedder,
      userId: 'u1',
      customerMessage: 'send Ryan review',
      retrievedChunks: [{ id: 'c1', content: 'Use @new-review-customer-ryan and #image-review.', document_id: 'd1', faq_id: null, business_item_id: null, heading_path: null }],
      rpcName: 'match_media_assets_service',
      limit: 4,
    })

    // a1 via asset_ref; #image-review picks one best from f1 (a2 ranks first).
    expect(result.map((r) => r.slug)).toEqual([
      'new-review-customer-ryan',
      'general-review',
    ])
  })

  it('caps results at the requested limit', async () => {
    const result = await selectMediaForReply({
      client: makeClient(baseAssets, baseFolders),
      embedder,
      userId: 'u1',
      customerMessage: 'reviews',
      retrievedChunks: [{ id: 'c1', content: '#image-review', document_id: 'd1', faq_id: null, business_item_id: null, heading_path: null }],
      rpcName: 'match_media_assets_service',
      limit: 1,
    })

    expect(result).toHaveLength(1)
  })

  it('picks one best image per folder mention', async () => {
    const result = await selectMediaForReply({
      client: makeClient(baseAssets, baseFolders, { semanticOrder: ['a4', 'a3', 'a1', 'a2'] }),
      embedder,
      userId: 'u1',
      customerMessage: 'show me a build',
      retrievedChunks: [{ id: 'c1', content: 'See #samples folder.', document_id: 'd1', faq_id: null, business_item_id: null, heading_path: null }],
      rpcName: 'match_media_assets_service',
      limit: 4,
    })

    const samplesHit = result.find((r) => r.matchReason === 'folder_ref')
    expect(samplesHit).toMatchObject({ slug: 'premium-build', folderId: 'f2' })
  })
})
