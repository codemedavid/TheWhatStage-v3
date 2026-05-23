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

vi.mock('@/lib/media/selector', () => ({ selectMediaForReply: async () => [] }))

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
})
