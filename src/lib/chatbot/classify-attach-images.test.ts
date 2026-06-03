import { vi, describe, it, expect, beforeEach } from 'vitest'

let llmResponse = ''

vi.mock('@/lib/rag', () => ({
  HfRouterLlm: class {
    async completeWithUsage() {
      return {
        text: llmResponse,
        model: 'fake',
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0 },
      }
    }
    async complete() { return '' }
    async rewriteQuery(q: string) { return q }
  },
  retrieve: async () => ({ buckets: { useful: [], ambiguous: [], reject: [] } }),
  buildPrompt: () => ({
    system: '',
    user: '',
    contextChunks: [],
    contextChunkIds: [],
  }),
  createEmbedder: () => ({ embed: async () => [] }),
}))

const mediaMocks = vi.hoisted(() => ({
  selectMediaForReply: vi.fn(async () => [] as unknown[]),
}))
vi.mock('@/lib/media/selector', () => ({ selectMediaForReply: mediaMocks.selectMediaForReply }))

const fakeAsset = (id: string) => ({
  id,
  folderId: 'f1',
  name: `Asset ${id}`,
  slug: `asset-${id}`,
  description: null,
  storagePath: `path/${id}.png`,
  mimeType: 'image/png',
  matchReason: 'asset_ref' as const,
})

vi.mock('@/lib/action-pages/force-send', () => ({
  decideForceSend: async () => ({
    actionPage: null,
    overrideFired: false,
    reason: '',
  }),
}))

import { answerWithClassification } from './classify'

const supabase = {
  from: () => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
    }),
  }),
} as unknown as Parameters<typeof answerWithClassification>[0]

describe('answerWithClassification attach_images coercion', () => {
  beforeEach(() => {
    llmResponse = ''
    mediaMocks.selectMediaForReply.mockReset()
    mediaMocks.selectMediaForReply.mockResolvedValue([])
  })

  it('returns attachImages=true when the model sets attach_images:true', async () => {
    llmResponse = JSON.stringify({ reply: 'Eto po.', attach_images: true })
    const r = await answerWithClassification(supabase, 'u1', 'pakita mo', [], [], null)
    expect(r.attachImages).toBe(true)
  })

  it('returns attachImages=false when the model sets attach_images:false', async () => {
    llmResponse = JSON.stringify({ reply: 'Magkano ang budget?', attach_images: false })
    const r = await answerWithClassification(supabase, 'u1', 'magkano?', [], [], null)
    expect(r.attachImages).toBe(false)
  })

  it('defaults to false when the model omits attach_images', async () => {
    llmResponse = JSON.stringify({ reply: 'Sige po.' })
    const r = await answerWithClassification(supabase, 'u1', 'hi', [], [], null)
    expect(r.attachImages).toBe(false)
  })

  it('defaults to false when attach_images is a truthy non-boolean (strict equality to true)', async () => {
    llmResponse = JSON.stringify({ reply: 'Sige po.', attach_images: 'yes' })
    const r = await answerWithClassification(supabase, 'u1', 'hi', [], [], null)
    expect(r.attachImages).toBe(false)
  })

  it('defaults to false when JSON parse fails entirely (fallback path with no selected media)', async () => {
    llmResponse = 'not json at all'
    const r = await answerWithClassification(supabase, 'u1', 'hi', [], [], null)
    // Fallback path triggers; media selector is mocked to [] so attachImages
    // resolves to false (media.length > 0 === false).
    expect(r.attachImages).toBe(false)
  })

  it('emits resolved media when the model opts in (attach_images:true)', async () => {
    mediaMocks.selectMediaForReply.mockResolvedValue([fakeAsset('m1'), fakeAsset('m2')])
    llmResponse = JSON.stringify({ reply: 'Eto po yung proof.', attach_images: true })
    const r = await answerWithClassification(supabase, 'u1', 'pakita mo yung proof', [], [], null)
    expect(r.attachImages).toBe(true)
    expect(r.media.map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  it('gates resolved media to [] when the model opts out (attach_images:false)', async () => {
    // The selector DID resolve candidate assets (a doc mentioned @asset), but
    // the model decided this turn is unrelated — the gate must drop them so the
    // worker never sends images on an unrelated turn.
    mediaMocks.selectMediaForReply.mockResolvedValue([fakeAsset('m1'), fakeAsset('m2')])
    llmResponse = JSON.stringify({ reply: 'Magkano po ang budget niyo?', attach_images: false })
    const r = await answerWithClassification(supabase, 'u1', 'magkano?', [], [], null)
    expect(r.attachImages).toBe(false)
    expect(r.media).toEqual([])
  })
})
