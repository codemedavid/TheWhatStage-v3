import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getUserMock, supabaseFromMock, adminFromMock, sendOutboundMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  supabaseFromMock: vi.fn(),
  adminFromMock: vi.fn(),
  sendOutboundMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: supabaseFromMock,
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: adminFromMock }),
}))
vi.mock('@/lib/messenger/outbound', () => ({
  sendOutbound: sendOutboundMock,
}))
vi.mock('@/lib/facebook/crypto', () => ({
  decryptToken: (s: string) => `decrypted:${s}`,
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

import { replyAsOperator, setAutoReply, resumeBot } from './messenger'

beforeEach(() => {
  getUserMock.mockReset()
  supabaseFromMock.mockReset()
  adminFromMock.mockReset()
  sendOutboundMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fb-mid-1' })
})

function makeSupabaseStub(opts: {
  thread: Record<string, unknown> | null
  threadUpdateSpy?: (patch: Record<string, unknown>) => void
  messageInsertSpy?: (row: Record<string, unknown>) => void
  takeoverMinutes?: number
}) {
  return (table: string) => {
    if (table === 'messenger_threads') {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: opts.thread, error: null }) }),
        }),
        update: (patch: Record<string, unknown>) => {
          opts.threadUpdateSpy?.(patch)
          return { eq: async () => ({ error: null }) }
        },
      }
    }
    if (table === 'messenger_messages') {
      return {
        insert: async (row: Record<string, unknown>) => {
          opts.messageInsertSpy?.(row)
          return { error: null }
        },
      }
    }
    if (table === 'chatbot_configs') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { human_takeover_minutes: opts.takeoverMinutes ?? 60 },
              error: null,
            }),
          }),
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  }
}

describe('replyAsOperator — bot_paused_until stamp', () => {
  it('stamps bot_paused_until ≈ now + N minutes when human_takeover_minutes > 0', async () => {
    const patches: Record<string, unknown>[] = []
    supabaseFromMock.mockImplementation(makeSupabaseStub({
      thread: {
        id: 't1', psid: 'psid', page_id: 'p1', last_inbound_at: null,
        controlled_by_run_id: null,
        facebook_pages: { page_access_token: 'enc' },
      },
      threadUpdateSpy: (p) => { patches.push(p) },
    }))

    const t0 = Date.now()
    await replyAsOperator('lead-1', 'hello')
    const t1 = Date.now()

    const stampPatch = patches.find((p) => 'bot_paused_until' in p)
    expect(stampPatch?.bot_paused_until).toBeTypeOf('string')
    const stampedAt = Date.parse(stampPatch?.bot_paused_until as string)
    expect(stampedAt).toBeGreaterThanOrEqual(t0 + 60 * 60_000 - 50)
    expect(stampedAt).toBeLessThanOrEqual(t1 + 60 * 60_000 + 50)
  })

  it('does NOT stamp when human_takeover_minutes = 0', async () => {
    const patches: Record<string, unknown>[] = []
    supabaseFromMock.mockImplementation(makeSupabaseStub({
      thread: {
        id: 't1', psid: 'psid', page_id: 'p1', last_inbound_at: null,
        controlled_by_run_id: null,
        facebook_pages: { page_access_token: 'enc' },
      },
      threadUpdateSpy: (p) => { patches.push(p) },
      takeoverMinutes: 0,
    }))

    await replyAsOperator('lead-1', 'hello')

    expect(patches.some((p) => 'bot_paused_until' in p)).toBe(false)
  })

  it('does NOT stamp when chatbot_configs row is missing', async () => {
    const patches: Record<string, unknown>[] = []
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === 'chatbot_configs') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
        }
      }
      return makeSupabaseStub({
        thread: {
          id: 't1', psid: 'psid', page_id: 'p1', last_inbound_at: null,
          controlled_by_run_id: null,
          facebook_pages: { page_access_token: 'enc' },
        },
        threadUpdateSpy: (p) => { patches.push(p) },
      })(table)
    })

    await replyAsOperator('lead-1', 'hello')

    expect(patches.some((p) => 'bot_paused_until' in p)).toBe(false)
  })

  it('still stamps when the FB send fails (operator intent counted)', async () => {
    sendOutboundMock.mockResolvedValue({ sent: false, reason: 'rate_limited' })
    const patches: Record<string, unknown>[] = []
    supabaseFromMock.mockImplementation(makeSupabaseStub({
      thread: {
        id: 't1', psid: 'psid', page_id: 'p1', last_inbound_at: null,
        controlled_by_run_id: null,
        facebook_pages: { page_access_token: 'enc' },
      },
      threadUpdateSpy: (p) => { patches.push(p) },
    }))

    await expect(replyAsOperator('lead-1', 'hello')).rejects.toThrow()
    const stampPatch = patches.find((p) => 'bot_paused_until' in p)
    expect(stampPatch).toBeDefined()
    expect(typeof stampPatch?.bot_paused_until).toBe('string')
    const tailPatch = patches.find((p) => 'last_message_at' in p)
    expect(tailPatch).toBeUndefined()
  })
})

describe('setAutoReply', () => {
  it('clears bot_paused_until when enabling', async () => {
    let patch: Record<string, unknown> | undefined
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === 'messenger_threads') {
        return {
          update: (p: Record<string, unknown>) => {
            patch = p
            return { eq: async () => ({ error: null }) }
          },
        }
      }
      throw new Error(`unexpected ${table}`)
    })

    await setAutoReply('lead-1', true)

    expect(patch).toEqual({ auto_reply_enabled: true, bot_paused_until: null })
  })

  it('does NOT touch bot_paused_until when disabling', async () => {
    let patch: Record<string, unknown> | undefined
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === 'messenger_threads') {
        return {
          update: (p: Record<string, unknown>) => {
            patch = p
            return { eq: async () => ({ error: null }) }
          },
        }
      }
      throw new Error(`unexpected ${table}`)
    })

    await setAutoReply('lead-1', false)

    expect(patch).toEqual({ auto_reply_enabled: false })
  })
})

describe('resumeBot', () => {
  it('clears bot_paused_until without touching auto_reply_enabled', async () => {
    let patch: Record<string, unknown> | undefined
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === 'messenger_threads') {
        return {
          update: (p: Record<string, unknown>) => {
            patch = p
            return { eq: async () => ({ error: null }) }
          },
        }
      }
      throw new Error(`unexpected ${table}`)
    })

    await resumeBot('lead-1')

    expect(patch).toEqual({ bot_paused_until: null })
  })
})
