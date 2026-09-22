import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const getUser = vi.fn()
const maybeSingle = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
  }),
}))

import { MobileAuthError, requireMobileUser, resetMobileAuthCache } from './auth'

function req(auth?: string) {
  return new NextRequest('http://localhost/api/mobile/x', {
    headers: auth ? { authorization: auth } : {},
  })
}

describe('requireMobileUser', () => {
  beforeEach(() => {
    getUser.mockReset()
    maybeSingle.mockReset()
    // Verified tokens are memoised per warm instance; each test starts cold.
    resetMobileAuthCache()
  })

  it('rejects a request without a bearer token', async () => {
    await expect(requireMobileUser(req())).rejects.toMatchObject({ status: 401 })
  })

  it('rejects an invalid token', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad' } })
    await expect(requireMobileUser(req('Bearer nope'))).rejects.toBeInstanceOf(MobileAuthError)
  })

  it('returns the principal for an active account', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.c' } }, error: null })
    maybeSingle.mockResolvedValue({ data: { role: 'user', status: 'active' } })
    const p = await requireMobileUser(req('Bearer token'))
    expect(p.userId).toBe('u1')
    expect(p.email).toBe('a@b.c')
  })

  it('blocks pending and paused accounts unless superadmin', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: '' } }, error: null })
    maybeSingle.mockResolvedValue({ data: { role: 'user', status: 'paused' } })
    await expect(requireMobileUser(req('Bearer token'))).rejects.toMatchObject({ status: 403 })

    maybeSingle.mockResolvedValue({ data: { role: 'superadmin', status: 'pending' } })
    await expect(requireMobileUser(req('Bearer token'))).resolves.toMatchObject({ userId: 'u1' })
  })

  it('reuses a verified token instead of re-hitting GoTrue and profiles', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.c' } }, error: null })
    maybeSingle.mockResolvedValue({ data: { role: 'user', status: 'active' } })

    await requireMobileUser(req('Bearer token'))
    const second = await requireMobileUser(req('Bearer token'))

    expect(second).toMatchObject({ userId: 'u1', email: 'a@b.c' })
    expect(getUser).toHaveBeenCalledTimes(1)
    expect(maybeSingle).toHaveBeenCalledTimes(1)
  })

  it('never caches a rejected token', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad' } })
    await expect(requireMobileUser(req('Bearer nope'))).rejects.toMatchObject({ status: 401 })
    await expect(requireMobileUser(req('Bearer nope'))).rejects.toMatchObject({ status: 401 })
    expect(getUser).toHaveBeenCalledTimes(2)
  })

  it('scopes the cache to the exact token', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u1', email: '' } }, error: null })
    maybeSingle.mockResolvedValue({ data: { role: 'user', status: 'active' } })
    await requireMobileUser(req('Bearer one'))

    getUser.mockResolvedValue({ data: { user: { id: 'u2', email: '' } }, error: null })
    await expect(requireMobileUser(req('Bearer two'))).resolves.toMatchObject({ userId: 'u2' })
  })
})
