import { describe, expect, it, vi, beforeEach } from 'vitest'

const { sendOutboundMock, generateSeqMock } = vi.hoisted(() => ({
  sendOutboundMock: vi.fn(),
  generateSeqMock: vi.fn(),
}))

vi.mock('@/lib/messenger/outbound', () => ({ sendOutbound: sendOutboundMock }))
vi.mock('@/lib/facebook/crypto', () => ({ decryptToken: (s: string) => `dec:${s}` }))
vi.mock('@/lib/agent/classifyPolicy', () => ({
  isInsideWindow: (s: string | null) => !!s && Date.now() - new Date(s).getTime() < 24 * 3600_000,
}))
vi.mock('./sequence-generate', () => ({ generateSequenceMessage: generateSeqMock }))
vi.mock('@/lib/rag/llm', () => ({
  HfRouterLlm: class {
    complete = vi.fn(async () => 'one-off body')
  },
}))
vi.mock('@/lib/rag/config', () => ({ ragConfig: { classifierModel: 'fake' } }))

import { fireReminder } from './fire'

type FakeReminder = {
  id: string
  user_id: string
  lead_id: string
  thread_id: string
  topic: string
  status: string
  auto_send: boolean
  sequence_id: string | null
  sequence_position: number | null
  pre_generated_text: string | null
  fallback_text: string | null
}

function makeAdmin(seed: {
  reminder: FakeReminder
  sequence?: { id: string; status: string; topic: string; anchor_at: string } | null
  thread: Record<string, unknown>
  page: Record<string, unknown>
  lead: Record<string, unknown>
  chatbot?: Record<string, unknown> | null
}) {
  const updates: Array<{ table: string; values: unknown }> = []
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      let pendingUpdate: unknown = null
      chain.select = () => chain
      chain.eq = () => chain
      chain.order = () => chain
      chain.limit = () => chain
      chain.maybeSingle = async () => {
        if (table === 'lead_reminders') return { data: seed.reminder, error: null }
        if (table === 'lead_reminder_sequences')
          return { data: seed.sequence ?? null, error: null }
        if (table === 'messenger_threads') return { data: seed.thread, error: null }
        if (table === 'facebook_pages') return { data: seed.page, error: null }
        if (table === 'leads') return { data: seed.lead, error: null }
        if (table === 'chatbot_configs') return { data: seed.chatbot ?? null, error: null }
        return { data: null, error: null }
      }
      chain.update = (values: unknown) => {
        pendingUpdate = values
        return chain
      }
      chain.insert = () => Promise.resolve({ data: null, error: null })
      chain.then = (resolve: (r: { data: null; error: null }) => void) => {
        if (pendingUpdate !== null) updates.push({ table, values: pendingUpdate })
        resolve({ data: null, error: null })
      }
      return chain
    },
  }
  return { admin, updates }
}

const baseSeed = {
  reminder: {
    id: 'r1',
    user_id: 'u1',
    lead_id: 'l1',
    thread_id: 't1',
    topic: 'pricing',
    status: 'pending',
    auto_send: true,
    sequence_id: 'seq-1',
    sequence_position: 0,
    pre_generated_text: 'pre-gen body',
    fallback_text: 'fallback body',
  } satisfies FakeReminder,
  thread: { id: 't1', psid: 'ps1', last_inbound_at: new Date().toISOString(), page_id: 'p1' },
  page: { id: 'p1', page_access_token: 'enc' },
  lead: { name: 'Maria' },
  chatbot: { persona: 'warm', instructions: '' },
}

beforeEach(() => {
  sendOutboundMock.mockReset()
  generateSeqMock.mockReset()
})

describe('fireReminder — sequence-aware', () => {
  it('cancels the touchpoint and skips send when parent sequence is not active', async () => {
    const { admin, updates } = makeAdmin({
      ...baseSeed,
      sequence: { id: 'seq-1', status: 'cancelled', topic: 'pricing', anchor_at: new Date().toISOString() },
    })
    const result = await fireReminder(admin as never, 'r1')
    expect(result.ok).toBe(false)
    expect(sendOutboundMock).not.toHaveBeenCalled()
    const reminderUpdate = updates.find((u) => u.table === 'lead_reminders')
    expect((reminderUpdate!.values as Record<string, unknown>).status).toBe('cancelled')
  })

  it('uses fresh LLM output when available', async () => {
    generateSeqMock.mockResolvedValue('fresh body')
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fb-1' })
    const { admin } = makeAdmin({
      ...baseSeed,
      sequence: { id: 'seq-1', status: 'active', topic: 'pricing', anchor_at: new Date().toISOString() },
    })
    await fireReminder(admin as never, 'r1')
    expect(sendOutboundMock).toHaveBeenCalledTimes(1)
    const call = sendOutboundMock.mock.calls[0][0]
    expect(call.payload.text).toBe('fresh body')
  })

  it('falls back to pre_generated_text when fresh LLM returns null', async () => {
    generateSeqMock.mockResolvedValue(null)
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fb-1' })
    const { admin } = makeAdmin({
      ...baseSeed,
      sequence: { id: 'seq-1', status: 'active', topic: 'pricing', anchor_at: new Date().toISOString() },
    })
    await fireReminder(admin as never, 'r1')
    const call = sendOutboundMock.mock.calls[0][0]
    expect(call.payload.text).toBe('pre-gen body')
  })

  it('falls back to fallback_text when both fresh and pre-gen are unavailable', async () => {
    generateSeqMock.mockResolvedValue(null)
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fb-1' })
    const { admin } = makeAdmin({
      ...baseSeed,
      reminder: { ...baseSeed.reminder, pre_generated_text: null },
      sequence: { id: 'seq-1', status: 'active', topic: 'pricing', anchor_at: new Date().toISOString() },
    })
    await fireReminder(admin as never, 'r1')
    const call = sendOutboundMock.mock.calls[0][0]
    expect(call.payload.text).toBe('fallback body')
  })

  it('uses the legacy one-off path when sequence_id is null (no regression)', async () => {
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fb-1' })
    const { admin } = makeAdmin({
      ...baseSeed,
      reminder: {
        ...baseSeed.reminder,
        sequence_id: null,
        sequence_position: null,
        pre_generated_text: null,
        fallback_text: null,
      },
      sequence: null,
    })
    await fireReminder(admin as never, 'r1')
    expect(sendOutboundMock).toHaveBeenCalledTimes(1)
    const call = sendOutboundMock.mock.calls[0][0]
    expect(typeof call.payload.text).toBe('string')
    expect(call.payload.text.length).toBeGreaterThan(0)
  })
})
