// Exercises the per-job handler: load schedule → re-check gates → generate →
// sanitize → send → advance. The send and generator are mocked.

import { describe, expect, it, vi, beforeEach } from 'vitest'

const { sendOutboundMock, generateMock, shouldSeedMock } = vi.hoisted(() => ({
  sendOutboundMock: vi.fn(),
  generateMock: vi.fn(),
  shouldSeedMock: vi.fn(),
}))

vi.mock('@/lib/messenger/outbound', () => ({ sendOutbound: sendOutboundMock }))
vi.mock('@/lib/facebook/crypto', () => ({ decryptToken: (s: string) => `dec:${s}` }))
vi.mock('@/lib/agent/classifyPolicy', () => ({
  isInsideWindow: (s: string | null) => !!s && Date.now() - new Date(s).getTime() < 24 * 3600_000,
}))
vi.mock('./generateMessage', () => ({ generateFollowupMessage: generateMock }))
vi.mock('./gates', () => ({ shouldSeed: shouldSeedMock }))

import { handleFollowupSend } from './fire'

interface FakeRow {
  id: string
  user_id: string
  lead_id: string
  thread_id: string
  page_id: string
  started_at: string
  next_offset_idx: number
  conversation_kind: 'generic' | 'real'
  status: string
}

function makeAdmin(seed: { schedule: FakeRow; thread: Record<string, unknown>; page: Record<string, unknown>; lead: Record<string, unknown>; chatbot: Record<string, unknown>; history: unknown[] }) {
  const updates: Array<{ table: string; values: unknown; match: unknown }> = []
  const inserts: Array<{ table: string; values: unknown }> = []
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      let pendingMatch: Record<string, unknown> = {}
      let pendingUpdate: unknown = null
      chain.select = () => chain
      chain.order = () => chain
      chain.limit = () => chain
      chain.eq = (col: string, val: unknown) => {
        pendingMatch = { ...pendingMatch, [col]: val }
        return chain
      }
      chain.maybeSingle = async () => {
        if (table === 'lead_followup_schedules') return { data: seed.schedule, error: null }
        if (table === 'messenger_threads') return { data: seed.thread, error: null }
        if (table === 'facebook_pages') return { data: seed.page, error: null }
        if (table === 'leads') return { data: seed.lead, error: null }
        if (table === 'chatbot_configs') return { data: seed.chatbot, error: null }
        return { data: null, error: null }
      }
      chain.update = (values: unknown) => {
        pendingUpdate = values
        return chain
      }
      chain.insert = (values: unknown) => {
        inserts.push({ table, values })
        return Promise.resolve({ data: null, error: null })
      }
      chain.then = (resolve: (r: { data: unknown[]; error: null }) => void) => {
        if (pendingUpdate !== null) {
          updates.push({ table, values: pendingUpdate, match: pendingMatch })
        }
        if (table === 'messenger_messages' && pendingUpdate === null) {
          resolve({ data: seed.history, error: null })
        } else {
          resolve({ data: [], error: null })
        }
      }
      return chain
    },
  }
  return { admin, updates, inserts }
}

beforeEach(() => {
  sendOutboundMock.mockReset()
  generateMock.mockReset()
  shouldSeedMock.mockReset()
})

describe('handleFollowupSend', () => {
  const schedule: FakeRow = {
    id: 's1', user_id: 'u1', lead_id: 'l1', thread_id: 't1', page_id: 'p1',
    started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    next_offset_idx: 0,
    conversation_kind: 'generic',
    status: 'pending',
  }
  const baseSeed = {
    schedule,
    thread: { id: 't1', psid: 'ps1', last_inbound_at: schedule.started_at, page_id: 'p1', full_name: 'Ana Cruz' },
    page: { id: 'p1', page_access_token: 'enc-token' },
    lead: { name: 'Ana Cruz' },
    chatbot: { persona: 'warm, casual' },
    history: [],
  }

  it('generates, sends, and advances to next offset', async () => {
    shouldSeedMock.mockResolvedValue({ ok: true, inboundCount: 1 })
    generateMock.mockResolvedValue('Hi Ana, interested pa po kayo?')
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fb1' })
    const { admin, updates } = makeAdmin(baseSeed)

    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    expect(sendOutboundMock).toHaveBeenCalledTimes(1)
    const upd = updates.filter((u) => u.table === 'lead_followup_schedules')
    const last = upd[upd.length - 1].values as Record<string, unknown>
    expect(last.next_offset_idx).toBe(1)
    expect(last.status).toBe('pending')
  })

  it('marks done when firing the last offset (6)', async () => {
    shouldSeedMock.mockResolvedValue({ ok: true, inboundCount: 1 })
    generateMock.mockResolvedValue('Hi Ana, balik na lang po kayo anytime kung interested.')
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fb7' })
    const { admin, updates } = makeAdmin({ ...baseSeed, schedule: { ...schedule, next_offset_idx: 6 } })

    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    const upd = updates.filter((u) => u.table === 'lead_followup_schedules')
    const last = upd[upd.length - 1].values as Record<string, unknown>
    expect(last.status).toBe('done')
  })

  it('marks done without sending when gates fail mid-schedule', async () => {
    shouldSeedMock.mockResolvedValue({ ok: false, reason: 'page_action_completed' })
    const { admin, updates } = makeAdmin(baseSeed)

    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    expect(sendOutboundMock).not.toHaveBeenCalled()
    const upd = updates.filter((u) => u.table === 'lead_followup_schedules')
    expect((upd[upd.length - 1].values as Record<string, unknown>).status).toBe('done')
  })

  it('marks failed on send error', async () => {
    shouldSeedMock.mockResolvedValue({ ok: true, inboundCount: 1 })
    generateMock.mockResolvedValue('hi')
    sendOutboundMock.mockResolvedValue({ sent: false, reason: 'window' })
    const { admin, updates } = makeAdmin(baseSeed)

    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    const upd = updates.filter((u) => u.table === 'lead_followup_schedules')
    const last = upd[upd.length - 1].values as Record<string, unknown>
    expect(last.status).toBe('failed')
    expect(last.last_error).toContain('window')
  })
})
