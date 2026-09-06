import { describe, expect, it, vi } from 'vitest'
import { generateApiKey } from './generate'
import { parseBearer, resolveApiKey } from './resolve'

type KeyRow = { id: string; user_id: string; scopes: string[]; revoked_at: string | null }

function makeAdmin(opts: { key?: KeyRow | null; status?: string | null }) {
  const updates: unknown[] = []
  const admin = {
    from(table: string) {
      if (table === 'api_keys') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: opts.key ?? null, error: null }) }),
          }),
          update: (values: unknown) => ({
            eq: () => ({ then: (cb: (r: { error: null }) => void) => { updates.push(values); cb({ error: null }) } }),
          }),
        }
      }
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: opts.status === undefined ? { status: 'active' } : { status: opts.status },
                error: null,
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { admin: admin as never, updates }
}

const ACTIVE_KEY: KeyRow = { id: 'k1', user_id: 'u1', scopes: ['read', 'send', 'bogus'], revoked_at: null }

describe('parseBearer', () => {
  it('extracts the token case-insensitively and trims whitespace', () => {
    expect(parseBearer('Bearer abc')).toBe('abc')
    expect(parseBearer('bearer   abc  ')).toBe('abc')
    expect(parseBearer('Basic abc')).toBeNull()
    expect(parseBearer(null)).toBeNull()
  })
})

describe('resolveApiKey', () => {
  it('returns owner + filtered scopes for a valid key and touches last_used_at', async () => {
    const { admin, updates } = makeAdmin({ key: ACTIVE_KEY })
    const result = await resolveApiKey(admin, generateApiKey().plaintext)
    expect(result).toEqual({ keyId: 'k1', userId: 'u1', scopes: ['read', 'send'] })
    expect(updates).toHaveLength(1)
  })

  it('rejects malformed keys without querying', async () => {
    const admin = { from: vi.fn() } as never
    expect(await resolveApiKey(admin, 'nope')).toBeNull()
    expect(await resolveApiKey(admin, null)).toBeNull()
  })

  it('rejects unknown and revoked keys', async () => {
    expect(await resolveApiKey(makeAdmin({ key: null }).admin, generateApiKey().plaintext)).toBeNull()
    const revoked = { ...ACTIVE_KEY, revoked_at: '2026-09-01T00:00:00Z' }
    expect(await resolveApiKey(makeAdmin({ key: revoked }).admin, generateApiKey().plaintext)).toBeNull()
  })

  it('rejects keys whose owner account is not active', async () => {
    expect(await resolveApiKey(makeAdmin({ key: ACTIVE_KEY, status: 'paused' }).admin, generateApiKey().plaintext)).toBeNull()
    expect(await resolveApiKey(makeAdmin({ key: ACTIVE_KEY, status: null }).admin, generateApiKey().plaintext)).toBeNull()
  })
})
