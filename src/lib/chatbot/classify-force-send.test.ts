import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/rag', () => ({
  HfRouterLlm: class {
    async completeWithUsage() {
      return {
        text: JSON.stringify({
          reply: 'Sounds good!',
          stage_change: null,
          action_page: null,
        }),
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
  decideForceSend: vi.fn(async () => ({
    actionPage: { action_page_id: 'forced', reason: 'forced', button_text: '' },
    overrideFired: true,
    reason: 'override',
  })),
}))

import { answerWithClassification } from './classify'
import { decideForceSend } from '@/lib/action-pages/force-send'

describe('answerWithClassification force-send wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('replaces actionPage with the force-send decision when override fires', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      }),
    } as unknown as Parameters<typeof answerWithClassification>[0]

    const r = await answerWithClassification(
      supabase,
      'u1',
      'sige po',
      [{ role: 'user', content: 'earlier' }],
      [],
      null,
      {
        actionPages: [
          { id: 'forced', title: 'P', cta_label: 'go', bot_send_instructions: '' },
        ],
        leadId: 'lead-1',
        threadId: 't1',
      },
    )

    expect(decideForceSend).toHaveBeenCalledTimes(1)
    expect(r.actionPage?.action_page_id).toBe('forced')
  })
})
