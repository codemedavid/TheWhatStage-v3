import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSession = vi.hoisted(() => vi.fn())
const adminFrom = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/get-session', () => ({ getSession }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: adminFrom }),
}))

import { POST } from './route'

function req(body: unknown) {
  return new Request('https://app.test/api/superadmin/users/u-target/status', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function ctx(id = 'u-target') {
  return { params: Promise.resolve({ id }) }
}

function mockProfileLookup(target: { role: string; status: string } | null) {
  // First admin.from('profiles') call — read target.
  // Second admin.from('profiles') call — update + select.
  let call = 0
  adminFrom.mockImplementation((table: string) => {
    expect(table).toBe('profiles')
    call += 1
    if (call === 1) {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: target, error: null }),
          }),
        }),
      }
    }
    return {
      update: () => ({
        eq: () => ({
          select: () => ({
            single: async () => ({
              data: { id: 'u-target', status: 'paused', role: target?.role, email: 'x', full_name: 'X' },
              error: null,
            }),
          }),
        }),
      }),
    }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockReset()
  adminFrom.mockReset()
})

describe('POST /api/superadmin/users/[id]/status', () => {
  it('401 when no session', async () => {
    getSession.mockResolvedValue(null)
    const res = await POST(req({ status: 'paused' }) as never, ctx())
    expect(res.status).toBe(401)
  })

  it('403 when caller is not superadmin', async () => {
    getSession.mockResolvedValue({ userId: 'u1', role: 'user' })
    const res = await POST(req({ status: 'paused' }) as never, ctx())
    expect(res.status).toBe(403)
  })

  it('403 when superadmin tries to modify their own status', async () => {
    getSession.mockResolvedValue({ userId: 'sa', role: 'superadmin' })
    const res = await POST(req({ status: 'paused' }) as never, ctx('sa'))
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/own status/i)
  })

  it('400 when body has invalid status', async () => {
    getSession.mockResolvedValue({ userId: 'sa', role: 'superadmin' })
    const res = await POST(req({ status: 'banished' }) as never, ctx())
    expect(res.status).toBe(400)
  })

  it('400 on invalid JSON', async () => {
    getSession.mockResolvedValue({ userId: 'sa', role: 'superadmin' })
    const badReq = new Request('https://app.test/api/superadmin/users/u-target/status', {
      method: 'POST',
      body: 'not json',
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(badReq as never, ctx())
    expect(res.status).toBe(400)
  })

  it('404 when target user does not exist', async () => {
    getSession.mockResolvedValue({ userId: 'sa', role: 'superadmin' })
    mockProfileLookup(null)
    const res = await POST(req({ status: 'paused' }) as never, ctx())
    expect(res.status).toBe(404)
  })

  it('403 when target is another superadmin', async () => {
    getSession.mockResolvedValue({ userId: 'sa', role: 'superadmin' })
    mockProfileLookup({ role: 'superadmin', status: 'active' })
    const res = await POST(req({ status: 'paused' }) as never, ctx())
    expect(res.status).toBe(403)
  })

  it('200 + updated row when pausing an active user', async () => {
    getSession.mockResolvedValue({ userId: 'sa', role: 'superadmin' })
    mockProfileLookup({ role: 'user', status: 'active' })
    const res = await POST(req({ status: 'paused' }) as never, ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('paused')
  })

  it('200 when approving a pending user (pending → active)', async () => {
    getSession.mockResolvedValue({ userId: 'sa', role: 'superadmin' })
    mockProfileLookup({ role: 'user', status: 'pending' })
    const res = await POST(req({ status: 'active' }) as never, ctx())
    expect(res.status).toBe(200)
  })
})
