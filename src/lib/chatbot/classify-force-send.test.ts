import { vi, describe, it, expect, beforeEach } from 'vitest'

// Mutable reply the mock LLM returns, so individual tests can simulate a tease.
// NOTE: the name MUST start with `mock` — vitest hoists `vi.mock` factories above
// imports and only allows them to close over variables whose name begins with
// `mock`. Renaming this to a non-`mock` identifier throws "Cannot access … before
// initialization" at import time and fails the whole file.
const DEFAULT_REPLY = JSON.stringify({ reply: 'Sounds good!', stage_change: null, action_page: null })
let mockReplyText = DEFAULT_REPLY

vi.mock('@/lib/rag', () => ({
  HfRouterLlm: class {
    async completeWithUsage() {
      return {
        text: mockReplyText,
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
    mockReplyText = DEFAULT_REPLY
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

  it('passes teasedLinkThisTurn=true to decideForceSend when the model teases a form with no action_page', async () => {
    // Model teases a form/link in prose but leaves action_page null — exactly
    // the production [classify.tease] case. The tease sentence is stripped, but
    // the signal must reach decideForceSend so the page is recovered.
    mockReplyText = JSON.stringify({
      reply: 'Perfect po! Sige, eto na po yung form para masimulan na natin 🎶',
      stage_change: null,
      action_page: null,
    })
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      }),
    } as unknown as Parameters<typeof answerWithClassification>[0]

    await answerWithClassification(
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
    expect(vi.mocked(decideForceSend).mock.calls[0][0]).toMatchObject({ teasedLinkThisTurn: true })
  })

  it('recovers the production "fill up lang po yung form sa baba" phrasing (screenshot bug)', async () => {
    // Exact phrasing from the reported screenshot. Politeness particles ("lang
    // po") between the verb and "form" used to defeat LINK_TEASE_RE, so the tease
    // shipped button-less. This locks in the fix end-to-end.
    mockReplyText = JSON.stringify({
      reply: 'Just fill up lang po yung form sa baba para masimulan na natin kayo ☺️',
      stage_change: null,
      action_page: null,
    })
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      }),
    } as unknown as Parameters<typeof answerWithClassification>[0]

    await answerWithClassification(
      supabase,
      'u1',
      'Where to fill up?',
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

    expect(vi.mocked(decideForceSend).mock.calls[0][0]).toMatchObject({ teasedLinkThisTurn: true })
  })

  it('passes teasedLinkThisTurn=false when the reply has no tease', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      }),
    } as unknown as Parameters<typeof answerWithClassification>[0]

    await answerWithClassification(
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

    expect(vi.mocked(decideForceSend).mock.calls[0][0]).toMatchObject({ teasedLinkThisTurn: false })
  })

  it('passes teasedLinkThisTurn=false when the tease is NEGATED (no need / optional)', async () => {
    // LINK_TEASE_RE matches this line too, but the model is telling the customer
    // they do NOT need the form — force-sending it would contradict the reply.
    mockReplyText = JSON.stringify({
      reply: 'Hindi na po kailangan i-fill up yung form, automatic na po ako bahala 💚',
      stage_change: null,
      action_page: null,
    })
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      }),
    } as unknown as Parameters<typeof answerWithClassification>[0]

    await answerWithClassification(
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

    expect(vi.mocked(decideForceSend).mock.calls[0][0]).toMatchObject({ teasedLinkThisTurn: false })
  })
})
