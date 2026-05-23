// Exercises the per-job handler: load schedule → re-check gates → generate →
// sanitize → send → advance. The send and generator are mocked.

import { describe, expect, it, vi, beforeEach } from 'vitest'

const { sendOutboundMock, generateMock, shouldSeedMock, resolvePolicyMock, mintAssetMock, mintDeeplinkMock } = vi.hoisted(() => ({
  sendOutboundMock: vi.fn(),
  generateMock: vi.fn(),
  shouldSeedMock: vi.fn(),
  resolvePolicyMock: vi.fn(),
  mintAssetMock: vi.fn(),
  mintDeeplinkMock: vi.fn(),
}))

vi.mock('@/lib/messenger/outbound', () => ({
  sendOutbound: sendOutboundMock,
  resolveSendPolicy: resolvePolicyMock,
}))

vi.mock('./attachments', () => ({
  mintMediaAssetUrl:      mintAssetMock,
  mintActionPageDeeplink: mintDeeplinkMock,
}))
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
  offsets_snapshot: Array<{ offset_ms: number; slot: number; instruction?: string }>
}

function makeAdmin(seed: {
  schedule: FakeRow
  thread: Record<string, unknown>
  page: Record<string, unknown>
  lead: Record<string, unknown>
  chatbot: Record<string, unknown>
  history: unknown[]
}) {
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
        if (table === 'media_assets') return { data: { name: 'My asset' }, error: null }
        if (table === 'action_pages') return { data: { title: 'My page' }, error: null }
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

const DEFAULT_SNAPSHOT = [
  { offset_ms: 300000,   slot: 0, instruction: '' },
  { offset_ms: 3600000,  slot: 1, instruction: '' },
  { offset_ms: 18000000, slot: 2, instruction: '' },
  { offset_ms: 28800000, slot: 3, instruction: '' },
  { offset_ms: 43200000, slot: 4, instruction: '' },
  { offset_ms: 64800000, slot: 5, instruction: '' },
  { offset_ms: 86400000, slot: 6, instruction: '' },
]

beforeEach(() => {
  sendOutboundMock.mockReset()
  generateMock.mockReset()
  shouldSeedMock.mockReset()
  resolvePolicyMock.mockReset()
  mintAssetMock.mockReset()
  mintDeeplinkMock.mockReset()

  shouldSeedMock.mockResolvedValue({ ok: true, inboundCount: 1 })
  generateMock.mockResolvedValue('Hi Maria, balikan lang po.')
  sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fbm-1' })
  resolvePolicyMock.mockResolvedValue({ mode: 'RESPONSE' })
  mintAssetMock.mockResolvedValue('https://signed/img.jpg')
  mintDeeplinkMock.mockResolvedValue('https://app/a/booking?psid=p&pid=g&exp=1&sig=x')
})

describe('handleFollowupSend', () => {
  const schedule: FakeRow = {
    id: 's1', user_id: 'u1', lead_id: 'l1', thread_id: 't1', page_id: 'p1',
    started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    next_offset_idx: 0,
    conversation_kind: 'generic',
    status: 'pending',
    offsets_snapshot: DEFAULT_SNAPSHOT,
  }
  const baseSeed = {
    schedule,
    thread: { id: 't1', psid: 'ps1', last_inbound_at: schedule.started_at, page_id: 'p1', full_name: 'Ana Cruz' },
    page: { id: 'p1', page_access_token: 'enc-token' },
    lead: { name: 'Ana Cruz' },
    chatbot: { persona: 'warm, casual' },
    history: [],
  }

  it('generates, sends, and advances to next offset using snapshot', async () => {
    shouldSeedMock.mockResolvedValue({ ok: true, inboundCount: 1 })
    generateMock.mockResolvedValue('Hi Ana, interested pa po kayo?')
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fb1' })
    const { admin, updates } = makeAdmin(baseSeed)

    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    expect(sendOutboundMock).toHaveBeenCalledTimes(1)
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({ slot: 0 }),
    )
    const upd = updates.filter((u) => u.table === 'lead_followup_schedules')
    const last = upd[upd.length - 1].values as Record<string, unknown>
    expect(last.next_offset_idx).toBe(1)
    expect(last.status).toBe('pending')
    // next_run_at uses snapshot[1].offset_ms = 1h
    expect(last.next_run_at).toBe(
      new Date(Date.parse(schedule.started_at) + 3_600_000).toISOString(),
    )
  })

  it('passes the original slot index (not next_offset_idx) to generateMessage', async () => {
    // Snapshot with rows 1 and 2 disabled (slots 0, 3, 5 only). Schedule at idx=1
    // means we're firing the row whose original slot is 3.
    const compactSnap = [
      { offset_ms: 300000,   slot: 0 },
      { offset_ms: 28800000, slot: 3 },
      { offset_ms: 64800000, slot: 5 },
    ]
    shouldSeedMock.mockResolvedValue({ ok: true, inboundCount: 1 })
    generateMock.mockResolvedValue('hi')
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fb2' })
    const { admin } = makeAdmin({
      ...baseSeed,
      schedule: { ...schedule, next_offset_idx: 1, offsets_snapshot: compactSnap },
    })

    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    expect(generateMock).toHaveBeenCalledWith(expect.objectContaining({ slot: 3 }))
  })

  it('marks done when firing the last entry in the snapshot', async () => {
    shouldSeedMock.mockResolvedValue({ ok: true, inboundCount: 1 })
    generateMock.mockResolvedValue('hi')
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fb7' })
    const { admin, updates } = makeAdmin({
      ...baseSeed,
      schedule: { ...schedule, next_offset_idx: 6 },
    })

    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    const upd = updates.filter((u) => u.table === 'lead_followup_schedules')
    const last = upd[upd.length - 1].values as Record<string, unknown>
    expect(last.status).toBe('done')
  })

  it('marks done at snapshot.length - 1 even when snapshot is shorter than 7', async () => {
    const compactSnap = [
      { offset_ms: 300000,   slot: 0 },
      { offset_ms: 28800000, slot: 3 },
    ]
    shouldSeedMock.mockResolvedValue({ ok: true, inboundCount: 1 })
    generateMock.mockResolvedValue('hi')
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fbx' })
    const { admin, updates } = makeAdmin({
      ...baseSeed,
      schedule: { ...schedule, next_offset_idx: 1, offsets_snapshot: compactSnap },
    })

    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    const upd = updates.filter((u) => u.table === 'lead_followup_schedules')
    expect((upd[upd.length - 1].values as Record<string, unknown>).status).toBe('done')
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

  it('forwards the instruction from the snapshot entry to generateFollowupMessage', async () => {
    const snapWithInstr = [
      { offset_ms: 300000,   slot: 0, instruction: 'quick hello po' },
      { offset_ms: 3600000,  slot: 1, instruction: 'ask one question' },
      { offset_ms: 18000000, slot: 2, instruction: 'share a benefit' },
      { offset_ms: 28800000, slot: 3, instruction: '' },
      { offset_ms: 43200000, slot: 4, instruction: '' },
      { offset_ms: 64800000, slot: 5, instruction: '' },
      { offset_ms: 86400000, slot: 6, instruction: '' },
    ]
    shouldSeedMock.mockResolvedValue({ ok: true, inboundCount: 1 })
    generateMock.mockResolvedValue('hi')
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fbi' })
    const { admin } = makeAdmin({
      ...baseSeed,
      schedule: { ...schedule, next_offset_idx: 2, offsets_snapshot: snapWithInstr },
    })

    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({ slot: 2, instruction: 'share a benefit' }),
    )
  })

  it('forwards instruction="" when snapshot entry lacks the field (legacy)', async () => {
    // Legacy snapshot rows seeded before this feature have no `instruction` key.
    const legacySnap = [
      { offset_ms: 300000,   slot: 0 },
      { offset_ms: 3600000,  slot: 1 },
      { offset_ms: 18000000, slot: 2 },
      { offset_ms: 28800000, slot: 3 },
      { offset_ms: 43200000, slot: 4 },
      { offset_ms: 64800000, slot: 5 },
      { offset_ms: 86400000, slot: 6 },
    ]
    shouldSeedMock.mockResolvedValue({ ok: true, inboundCount: 1 })
    generateMock.mockResolvedValue('hi')
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fbl' })
    const { admin } = makeAdmin({
      ...baseSeed,
      schedule: { ...schedule, next_offset_idx: 1, offsets_snapshot: legacySnap as never },
    })

    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({ slot: 1, instruction: '' }),
    )
  })
})

describe('handleFollowupSend — attachments', () => {
  function attachSeed(snapshotEntry: Record<string, unknown> = {}) {
    return {
      schedule: {
        id: 's1', user_id: 'u1', lead_id: 'l1', thread_id: 't1', page_id: 'p1',
        started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
        next_offset_idx: 0,
        conversation_kind: 'real' as const,
        status: 'pending',
        offsets_snapshot: [{
          slot: 0,
          offset_ms: 5 * 60_000,
          instruction: 'hello',
          image_media_asset_id: null,
          action_page_id: null,
          ...snapshotEntry,
        }],
      },
      thread:  { id: 't1', psid: 'PSID', last_inbound_at: new Date(Date.now() - 60_000).toISOString(), full_name: 'Maria' },
      page:    { id: 'p1', page_access_token: 'enc-token' },
      lead:    { name: 'Maria' },
      chatbot: { persona: null, instructions: null },
      history: [],
    }
  }

  it('sends text → image → button in order when policy is RESPONSE and both attachments are set', async () => {
    const seed = attachSeed({
      image_media_asset_id: '11111111-1111-4111-9111-111111111111',
      action_page_id:        '22222222-2222-4222-9222-222222222222',
    })
    const { admin } = makeAdmin(seed)
    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    expect(sendOutboundMock).toHaveBeenCalledTimes(3)
    const kinds = sendOutboundMock.mock.calls.map((c: [{ payload: { kind: string } }]) => c[0].payload.kind)
    expect(kinds).toEqual(['text', 'image', 'button'])
    expect(sendOutboundMock.mock.calls[1][0].payload).toMatchObject({
      kind: 'image', imageUrl: 'https://signed/img.jpg',
    })
    expect(sendOutboundMock.mock.calls[2][0].payload).toMatchObject({
      kind: 'button',
      text: 'Tap below to continue 👇',
      ctaLabel: 'View',
      url: 'https://app/a/booking?psid=p&pid=g&exp=1&sig=x',
    })
    // Regression: pageId must come from the schedule, not thread (thread select
    // does not include page_id). userId must be passed for ownership check.
    expect(mintDeeplinkMock).toHaveBeenCalledWith(
      expect.anything(),
      '22222222-2222-4222-9222-222222222222',
      'u1',
      expect.objectContaining({ pageId: 'p1' }),
    )
  })

  it('sends text only when policy is HUMAN_AGENT, even with attachments configured', async () => {
    resolvePolicyMock.mockResolvedValue({ mode: 'HUMAN_AGENT' })
    const seed = attachSeed({
      image_media_asset_id: '11111111-1111-4111-9111-111111111111',
      action_page_id:        '22222222-2222-4222-9222-222222222222',
    })
    const { admin } = makeAdmin(seed)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    expect(sendOutboundMock).toHaveBeenCalledTimes(1)
    expect(sendOutboundMock.mock.calls[0][0].payload.kind).toBe('text')
    expect(mintAssetMock).not.toHaveBeenCalled()
    expect(mintDeeplinkMock).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      '[followups.fire] attachments skipped — outside 24h window',
      expect.objectContaining({ dropped_image: true, dropped_action_page: true }),
    )
    warn.mockRestore()
  })

  it('sends only text + image when action_page_id is null', async () => {
    const seed = attachSeed({
      image_media_asset_id: '11111111-1111-4111-9111-111111111111',
      action_page_id: null,
    })
    const { admin } = makeAdmin(seed)
    await handleFollowupSend(admin as never, { scheduleId: 's1' })
    const kinds = sendOutboundMock.mock.calls.map((c: [{ payload: { kind: string } }]) => c[0].payload.kind)
    expect(kinds).toEqual(['text', 'image'])
  })

  it('skips the image silently when mintMediaAssetUrl returns null', async () => {
    mintAssetMock.mockResolvedValue(null)
    const seed = attachSeed({
      image_media_asset_id: '11111111-1111-4111-9111-111111111111',
      action_page_id: null,
    })
    const { admin } = makeAdmin(seed)
    await handleFollowupSend(admin as never, { scheduleId: 's1' })
    const kinds = sendOutboundMock.mock.calls.map((c: [{ payload: { kind: string } }]) => c[0].payload.kind)
    expect(kinds).toEqual(['text'])
  })

  it('passes a non-empty attachmentHint to the generator inside the window', async () => {
    const seed = attachSeed({
      image_media_asset_id: '11111111-1111-4111-9111-111111111111',
      action_page_id:        '22222222-2222-4222-9222-222222222222',
    })
    const { admin } = makeAdmin(seed)
    await handleFollowupSend(admin as never, { scheduleId: 's1' })
    expect(generateMock).toHaveBeenCalledWith(expect.objectContaining({
      attachmentHint: expect.stringContaining('photo'),
    }))
  })

  it('passes empty attachmentHint when policy is HUMAN_AGENT', async () => {
    resolvePolicyMock.mockResolvedValue({ mode: 'HUMAN_AGENT' })
    const seed = attachSeed({
      image_media_asset_id: '11111111-1111-4111-9111-111111111111',
      action_page_id:        '22222222-2222-4222-9222-222222222222',
    })
    const { admin } = makeAdmin(seed)
    await handleFollowupSend(admin as never, { scheduleId: 's1' })
    expect(generateMock).toHaveBeenCalledWith(expect.objectContaining({
      attachmentHint: '',
    }))
  })
})
