import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  registerPushDevice,
  unregisterPushDevice,
  setPushDeviceEnabled,
  isPushPlatform,
} from './devices'

type Existing = { id: string; user_id: string } | null

// Records what the code did to push_devices so each test can assert on the
// write rather than on a chain of mock call arguments. `maybeSingle` answers
// the pre-read before a write is recorded and the written row afterwards,
// mirroring `.update(...).select('enabled').maybeSingle()`.
function makeAdmin(
  opts: {
    existing?: Existing
    insertError?: { code?: string; message: string }
    storedEnabled?: boolean
  } = {},
) {
  const calls: { op: string; payload?: unknown; filters: Record<string, unknown> }[] = []
  let insertAttempts = 0

  const admin = {
    from(table: string) {
      expect(table).toBe('push_devices')
      const filters: Record<string, unknown> = {}
      let wrote: 'insert' | 'update' | null = null
      let insertFailed = false

      const query: Record<string, unknown> = {
        select: vi.fn(() => query),
        eq: vi.fn((col: string, value: unknown) => {
          filters[col] = value
          return query
        }),
        insert: vi.fn((payload: unknown) => {
          insertAttempts += 1
          insertFailed = insertAttempts === 1 && !!opts.insertError
          calls.push({ op: 'insert', payload, filters })
          wrote = 'insert'
          return query
        }),
        update: vi.fn((payload: unknown) => {
          calls.push({ op: 'update', payload, filters })
          wrote = 'update'
          return query
        }),
        delete: vi.fn(() => {
          calls.push({ op: 'delete', filters })
          wrote = 'update'
          return query
        }),
        maybeSingle: vi.fn(async () => {
          if (!wrote) return { data: opts.existing ?? null, error: null }
          if (insertFailed) return { data: null, error: opts.insertError }
          return { data: { enabled: opts.storedEnabled ?? true }, error: null }
        }),
        then: (resolve: (r: { error: unknown }) => void) => resolve({ error: null }),
      }
      return query
    },
  } as unknown as SupabaseClient

  return { admin, calls }
}

describe('isPushPlatform', () => {
  it('accepts the two platforms the app can run on', () => {
    expect(isPushPlatform('ios')).toBe(true)
    expect(isPushPlatform('android')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isPushPlatform('web')).toBe(false)
    expect(isPushPlatform(null)).toBe(false)
  })
})

describe('registerPushDevice', () => {
  const INPUT = {
    userId: 'user-1',
    token: 'ExponentPushToken[a]',
    platform: 'ios' as const,
    deviceName: "Ada's iPhone",
  }

  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('inserts a row the first time a device registers', async () => {
    // Arrange
    const { admin, calls } = makeAdmin({ existing: null })

    // Act
    const result = await registerPushDevice(admin, INPUT)

    // Assert
    expect(result).toEqual({ enabled: true })

    // Assert
    expect(calls).toHaveLength(1)
    expect(calls[0].op).toBe('insert')
    expect(calls[0].payload).toMatchObject({
      user_id: 'user-1',
      token: 'ExponentPushToken[a]',
      platform: 'ios',
      device_name: "Ada's iPhone",
    })
  })

  it('refreshes the existing row without resetting the mute when the same user re-registers', async () => {
    // Arrange — this device was muted from the Me screen on a previous launch.
    const { admin, calls } = makeAdmin({
      existing: { id: 'row-1', user_id: 'user-1' },
      storedEnabled: false,
    })

    // Act
    const result = await registerPushDevice(admin, INPUT)

    // Assert — the mute survives, and the app is told about it.
    expect(result).toEqual({ enabled: false })
    expect(calls).toHaveLength(1)
    expect(calls[0].op).toBe('update')
    expect(calls[0].payload).not.toHaveProperty('enabled')
    expect(calls[0].filters).toEqual({ id: 'row-1' })
  })

  it('moves the device to the new user and un-mutes it when someone else signs in', async () => {
    // Arrange
    const { admin, calls } = makeAdmin({ existing: { id: 'row-1', user_id: 'someone-else' } })

    // Act
    await registerPushDevice(admin, INPUT)

    // Assert
    expect(calls[0].op).toBe('update')
    expect(calls[0].payload).toMatchObject({ user_id: 'user-1', enabled: true })
  })

  it('falls back to an update when a concurrent registration won the insert race', async () => {
    // Arrange — the pre-read saw nothing, then the unique(token) index rejected us.
    const { admin, calls } = makeAdmin({
      existing: null,
      insertError: { code: '23505', message: 'duplicate key' },
    })

    // Act
    await registerPushDevice(admin, INPUT)

    // Assert
    expect(calls.map((c) => c.op)).toEqual(['insert', 'update'])
    expect(calls[1].filters).toEqual({ token: 'ExponentPushToken[a]' })
  })

  it('throws when the insert fails for any other reason', async () => {
    // Arrange
    const { admin } = makeAdmin({ existing: null, insertError: { message: 'permission denied' } })

    // Act / Assert
    await expect(registerPushDevice(admin, INPUT)).rejects.toThrow(/permission denied/)
  })
})

describe('unregisterPushDevice', () => {
  it('deletes only this user’s row for the token', async () => {
    // Arrange
    const { admin, calls } = makeAdmin()

    // Act
    await unregisterPushDevice(admin, { userId: 'user-1', token: 'ExponentPushToken[a]' })

    // Assert
    expect(calls[0].op).toBe('delete')
    expect(calls[0].filters).toEqual({ token: 'ExponentPushToken[a]', user_id: 'user-1' })
  })
})

describe('setPushDeviceEnabled', () => {
  it('scopes the mute to this user’s row', async () => {
    // Arrange
    const { admin, calls } = makeAdmin()

    // Act
    await setPushDeviceEnabled(admin, { userId: 'user-1', token: 'ExponentPushToken[a]', enabled: false })

    // Assert
    expect(calls[0].op).toBe('update')
    expect(calls[0].payload).toMatchObject({ enabled: false })
    expect(calls[0].filters).toEqual({ token: 'ExponentPushToken[a]', user_id: 'user-1' })
  })
})
