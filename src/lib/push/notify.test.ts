import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { notifyInboundMessage, pushTitle, pushBody, PUSH_BODY_MAX } from './notify'
import * as expo from './expo'

// Minimal admin-client stub. `push_devices` answers both the enabled-token read
// and the prune delete; `messenger_threads` answers the badge count.
function makeAdmin(opts: { tokens?: { token: string }[]; unread?: number; deviceError?: boolean } = {}) {
  const deletedIn: string[][] = []
  const admin = {
    from(table: string) {
      if (table === 'push_devices') {
        const query = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          delete: vi.fn().mockReturnThis(),
          in: vi.fn((_col: string, values: string[]) => {
            deletedIn.push(values)
            return Promise.resolve({ error: null })
          }),
          then: (resolve: (r: unknown) => void) =>
            resolve({
              data: opts.deviceError ? null : (opts.tokens ?? []),
              error: opts.deviceError ? { message: 'boom' } : null,
            }),
        }
        return query
      }
      // messenger_threads badge count
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gt: vi.fn().mockResolvedValue({ count: opts.unread ?? 0, error: null }),
      }
    },
  } as unknown as SupabaseClient
  return { admin, deletedIn }
}

const INPUT = {
  userId: 'user-1',
  threadId: 'thread-1',
  leadId: 'lead-1',
  contactName: 'Ada Lovelace',
  preview: 'Do you deliver to Cebu?',
}

describe('pushTitle', () => {
  it('uses the contact name when there is one', () => {
    expect(pushTitle('Ada Lovelace')).toBe('Ada Lovelace')
  })

  it('falls back to a generic title for an unnamed contact', () => {
    expect(pushTitle(null)).toBe('New message')
    expect(pushTitle('   ')).toBe('New message')
  })
})

describe('pushBody', () => {
  it('passes short text through unchanged', () => {
    expect(pushBody('hi there')).toBe('hi there')
  })

  it('marks an empty body as an attachment rather than sending a blank push', () => {
    expect(pushBody('')).toBe('Sent an attachment')
  })

  it('truncates long text with an ellipsis', () => {
    const out = pushBody('x'.repeat(500))
    expect(out).toHaveLength(PUSH_BODY_MAX + 1)
    expect(out.endsWith('…')).toBe(true)
  })

  it('collapses newlines so the notification stays one line', () => {
    expect(pushBody('line one\n\nline two')).toBe('line one line two')
  })
})

describe('notifyInboundMessage', () => {
  // Re-spied per test: the afterEach restore detaches the previous spy, and a
  // stale reference would let the real sender reach Expo over the network.
  let send: MockInstance<typeof expo.sendExpoPush>

  beforeEach(() => {
    send = vi.spyOn(expo, 'sendExpoPush')
    send.mockResolvedValue({ sent: 1, failed: 0, deadTokens: [] })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // Nothing in this suite may touch the network.
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in tests'))))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends nothing when the user has no registered devices', async () => {
    // Arrange
    const { admin } = makeAdmin({ tokens: [] })

    // Act
    await notifyInboundMessage(admin, INPUT)

    // Assert
    expect(send).not.toHaveBeenCalled()
  })

  it('sends nothing when the device lookup fails', async () => {
    // Arrange
    const { admin } = makeAdmin({ deviceError: true })

    // Act
    await notifyInboundMessage(admin, INPUT)

    // Assert
    expect(send).not.toHaveBeenCalled()
  })

  it('builds one message per device carrying the thread id for deep linking', async () => {
    // Arrange
    const { admin } = makeAdmin({
      tokens: [{ token: 'ExponentPushToken[a]' }, { token: 'ExponentPushToken[b]' }],
      unread: 3,
    })

    // Act
    await notifyInboundMessage(admin, INPUT)

    // Assert
    expect(send).toHaveBeenCalledOnce()
    const messages = send.mock.calls[0][0]
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      to: 'ExponentPushToken[a]',
      title: 'Ada Lovelace',
      body: 'Do you deliver to Cebu?',
      badge: 3,
      data: { type: 'inbound_message', threadId: 'thread-1', leadId: 'lead-1' },
    })
    expect(messages[1].to).toBe('ExponentPushToken[b]')
  })

  it('deletes tokens Expo reported as dead', async () => {
    // Arrange
    const { admin, deletedIn } = makeAdmin({ tokens: [{ token: 'ExponentPushToken[a]' }] })
    send.mockResolvedValue({ sent: 0, failed: 1, deadTokens: ['ExponentPushToken[a]'] })

    // Act
    await notifyInboundMessage(admin, INPUT)

    // Assert
    expect(deletedIn).toEqual([['ExponentPushToken[a]']])
  })

  it('leaves live tokens alone', async () => {
    // Arrange
    const { admin, deletedIn } = makeAdmin({ tokens: [{ token: 'ExponentPushToken[a]' }] })

    // Act
    await notifyInboundMessage(admin, INPUT)

    // Assert
    expect(deletedIn).toEqual([])
  })

  it('never throws when the send itself blows up', async () => {
    // Arrange
    const { admin } = makeAdmin({ tokens: [{ token: 'ExponentPushToken[a]' }] })
    send.mockRejectedValue(new Error('expo down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    // Act / Assert
    await expect(notifyInboundMessage(admin, INPUT)).resolves.toBeUndefined()
  })
})
