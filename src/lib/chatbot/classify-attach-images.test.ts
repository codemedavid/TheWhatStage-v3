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
vi.mock('@/lib/media/selector', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/media/selector')>()
  return { ...actual, selectMediaForReply: mediaMocks.selectMediaForReply }
})

type Reason = 'asset_ref' | 'folder_ref' | 'instruction_ref' | 'semantic'
const fakeAsset = (id: string, matchReason: Reason = 'asset_ref') => ({
  id,
  folderId: 'f1',
  name: `Asset ${id}`,
  slug: `asset-${id}`,
  description: null,
  storagePath: `path/${id}.png`,
  mimeType: 'image/png',
  matchReason,
})

vi.mock('@/lib/action-pages/force-send', () => ({
  decideForceSend: async () => ({
    actionPage: null,
    overrideFired: false,
    reason: '',
  }),
}))

import { answerWithClassification, coerceAttachMedia } from './classify'

const supabase = {
  from: () => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
    }),
  }),
} as unknown as Parameters<typeof answerWithClassification>[0]

describe('coerceAttachMedia', () => {
  const candidates = [fakeAsset('m1'), fakeAsset('m2', 'instruction_ref'), fakeAsset('m3', 'semantic')]

  it('returns the picked candidates in candidate order, matching by slug or id', () => {
    const picked = coerceAttachMedia(['asset-m3', 'm1'], undefined, candidates)
    expect(picked.map((m) => m.id)).toEqual(['m1', 'm3'])
  })

  it('tolerates a leading @, whitespace and case differences', () => {
    const picked = coerceAttachMedia([' @Asset-M2 '], undefined, candidates)
    expect(picked.map((m) => m.id)).toEqual(['m2'])
  })

  it('drops ids that are not candidates and non-string entries', () => {
    const picked = coerceAttachMedia(['nope', 42, null, 'asset-m1'], undefined, candidates)
    expect(picked.map((m) => m.id)).toEqual(['m1'])
  })

  it('returns [] for an empty list, false, or a missing field', () => {
    expect(coerceAttachMedia([], undefined, candidates)).toEqual([])
    expect(coerceAttachMedia(undefined, false, candidates)).toEqual([])
    expect(coerceAttachMedia(undefined, undefined, candidates)).toEqual([])
    expect(coerceAttachMedia('yes', 'yes', candidates)).toEqual([])
  })

  it('legacy attach_images:true sends only knowledge-tagged refs, never instruction/semantic candidates', () => {
    expect(coerceAttachMedia(undefined, true, candidates).map((m) => m.id)).toEqual(['m1'])
    expect(coerceAttachMedia(true, undefined, candidates).map((m) => m.id)).toEqual(['m1'])
  })
})

describe('answerWithClassification media decision', () => {
  beforeEach(() => {
    llmResponse = ''
    mediaMocks.selectMediaForReply.mockReset()
    mediaMocks.selectMediaForReply.mockResolvedValue([])
  })

  it('asks the selector for instruction refs and semantic auto-send candidates', async () => {
    llmResponse = JSON.stringify({ reply: 'Sige po.', attach_media: [] })
    await answerWithClassification(supabase, 'u1', 'hi', [], [], null)
    const calls = mediaMocks.selectMediaForReply.mock.calls as unknown as Array<[Record<string, unknown>]>
    const call = calls[0]?.[0]
    expect(call?.includeSemantic).toBe(true)
    expect(typeof call?.instructionText).toBe('string')
  })

  it('sends only the candidates the model picked, not every candidate', async () => {
    mediaMocks.selectMediaForReply.mockResolvedValue([
      fakeAsset('proof'),
      fakeAsset('demo', 'semantic'),
      fakeAsset('logo', 'instruction_ref'),
    ])
    llmResponse = JSON.stringify({ reply: 'Eto po yung proof.', attach_media: ['asset-proof'] })
    const r = await answerWithClassification(supabase, 'u1', 'may reviews po ba kayo', [], [], null)
    expect(r.attachImages).toBe(true)
    expect(r.media.map((m) => m.id)).toEqual(['proof'])
  })

  it('can pick a semantic auto-send asset that no knowledge chunk referenced', async () => {
    mediaMocks.selectMediaForReply.mockResolvedValue([fakeAsset('testimonial', 'semantic')])
    llmResponse = JSON.stringify({ reply: 'Eto po feedback ng clients namin.', attach_media: ['asset-testimonial'] })
    const r = await answerWithClassification(supabase, 'u1', 'may testimonial po ba kayo', [], [], null)
    expect(r.media.map((m) => m.id)).toEqual(['testimonial'])
  })

  it('sends nothing when the model picks nothing, even with candidates present', async () => {
    mediaMocks.selectMediaForReply.mockResolvedValue([fakeAsset('m1'), fakeAsset('m2', 'semantic')])
    llmResponse = JSON.stringify({ reply: 'Magkano po ang budget niyo?', attach_media: [] })
    const r = await answerWithClassification(supabase, 'u1', 'magkano?', [], [], null)
    expect(r.attachImages).toBe(false)
    expect(r.media).toEqual([])
  })

  it('defaults to nothing when the model omits attach_media', async () => {
    mediaMocks.selectMediaForReply.mockResolvedValue([fakeAsset('m1')])
    llmResponse = JSON.stringify({ reply: 'Sige po.' })
    const r = await answerWithClassification(supabase, 'u1', 'hi', [], [], null)
    expect(r.attachImages).toBe(false)
    expect(r.media).toEqual([])
  })

  it('still honours a legacy attach_images:true envelope for knowledge-tagged refs only', async () => {
    mediaMocks.selectMediaForReply.mockResolvedValue([fakeAsset('m1'), fakeAsset('m2', 'semantic')])
    llmResponse = JSON.stringify({ reply: 'Eto po.', attach_images: true })
    const r = await answerWithClassification(supabase, 'u1', 'pakita mo', [], [], null)
    expect(r.media.map((m) => m.id)).toEqual(['m1'])
  })

  it('on JSON-parse failure sends only knowledge-tagged refs (never instruction/semantic candidates)', async () => {
    mediaMocks.selectMediaForReply.mockResolvedValue([
      fakeAsset('m1'),
      fakeAsset('m2', 'instruction_ref'),
      fakeAsset('m3', 'semantic'),
    ])
    llmResponse = 'not json at all'
    const r = await answerWithClassification(supabase, 'u1', 'hi', [], [], null)
    expect(r.media.map((m) => m.id)).toEqual(['m1'])
    expect(r.attachImages).toBe(true)
  })

  it('on JSON-parse failure with no selected media returns attachImages=false', async () => {
    llmResponse = 'not json at all'
    const r = await answerWithClassification(supabase, 'u1', 'hi', [], [], null)
    expect(r.attachImages).toBe(false)
  })
})
