import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const redirectMock = vi.hoisted(() => vi.fn((url: string) => {
  const err = new Error(`NEXT_REDIRECT:${url}`) as Error & { digest: string }
  err.digest = `NEXT_REDIRECT;${url}`
  throw err
}))
vi.mock('next/navigation', () => ({ redirect: redirectMock }))

const adminAuthCreate = vi.hoisted(() => vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null })))
const getPostAuthRedirect = vi.hoisted(() => vi.fn(async () => '/onboarding/welcome'))

vi.mock('@/lib/onboarding/post-auth-redirect', () => ({ getPostAuthRedirect }))

const signInWithPassword = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn(async () => ({ error: null })))
const getUser = vi.hoisted(() => vi.fn())
const mockClientFrom = vi.hoisted(() => vi.fn())
const mockAdminFrom = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { signInWithPassword, signOut, getUser },
    from: mockClientFrom,
  }),
  getAuthUser: async () => (await getUser()).data.user,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { createUser: adminAuthCreate } },
    from: mockAdminFrom,
  }),
}))

import { signUpAction, signInAction } from './actions'

function profileLookup(row: { status: string; role: string } | null) {
  // Mocks `admin.from('profiles').select('status, role').eq('id', userId).single()`.
  return {
    select: () => ({
      eq: () => ({
        single: async () => ({ data: row, error: null }),
      }),
    }),
  }
}

beforeEach(() => {
  redirectMock.mockClear()
  adminAuthCreate.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  signInWithPassword.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  signOut.mockReset().mockResolvedValue({ error: null })
  getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } } })
  getPostAuthRedirect.mockReset().mockResolvedValue('/onboarding/welcome')
  mockClientFrom.mockReset()
  mockAdminFrom.mockReset().mockReturnValue(profileLookup({ status: 'active', role: 'user' }))
})

function fd(values: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(values)) f.set(k, v)
  return f
}

describe('signUpAction', () => {
  it('creates user, auto-signs-in (so ApprovalPoller can poll), redirects to /account-pending', async () => {
    await expect(signUpAction({}, fd({
      full_name: 'Aling Nena',
      email: 'nena@example.com',
      password: 'hunter22hunter',
      agree: 'on',
    }))).rejects.toThrowError(/NEXT_REDIRECT:\/account-pending/)

    expect(adminAuthCreate).toHaveBeenCalledWith(expect.objectContaining({
      email: 'nena@example.com',
      email_confirm: true,
      user_metadata: { full_name: 'Aling Nena' },
    }))
    expect(signInWithPassword).toHaveBeenCalledTimes(1)
    expect(redirectMock).toHaveBeenCalledWith('/account-pending')
  })

  it('returns generic formError when admin create fails (no email-existence enumeration)', async () => {
    adminAuthCreate.mockResolvedValue({ data: null, error: { message: 'User already registered' } } as never)
    const res = await signUpAction({}, fd({
      full_name: 'X', email: 'dup@example.com', password: 'hunter22hunter', agree: 'on',
    }))
    // Must NOT leak whether the email exists; the message should be the same
    // generic copy returned for any other create failure.
    expect(res.formError).toMatch(/could not create account/i)
    expect(res.formError).not.toMatch(/already/i)
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it('rejects signup when the terms-of-service checkbox is missing', async () => {
    const res = await signUpAction({}, fd({
      full_name: 'X', email: 'a@b.co', password: 'hunter22hunter',
    }))
    expect(res.fieldErrors?.agree).toBeDefined()
    expect(adminAuthCreate).not.toHaveBeenCalled()
  })

  it('returns fieldErrors on validation failure (no admin call)', async () => {
    const res = await signUpAction({}, fd({ full_name: '', email: 'no', password: '', agree: 'on' }))
    expect(res.fieldErrors).toBeDefined()
    expect(adminAuthCreate).not.toHaveBeenCalled()
  })
})

describe('signInAction', () => {
  it('on active user, redirects to the result of getPostAuthRedirect', async () => {
    getPostAuthRedirect.mockResolvedValue('/onboarding/knowledge')
    await expect(signInAction({}, fd({
      email: 'mid@example.com', password: 'hunter22hunter',
    }))).rejects.toThrowError(/NEXT_REDIRECT:\/onboarding\/knowledge/)
    expect(getPostAuthRedirect).toHaveBeenCalledTimes(1)
    expect(signOut).not.toHaveBeenCalled()
  })

  it('on pending user, keeps the session alive (for ApprovalPoller) and redirects to /account-pending', async () => {
    mockAdminFrom.mockReturnValue(profileLookup({ status: 'pending', role: 'user' }))
    await expect(signInAction({}, fd({
      email: 'new@example.com', password: 'hunter22hunter',
    }))).rejects.toThrowError(/NEXT_REDIRECT:\/account-pending/)
    // Pending users keep their session so the (auth) layout's 10s
    // router.refresh poll auto-promotes them to the dashboard the moment
    // the admin flips status → active. Self-escalation is blocked by RLS,
    // not by killing the session.
    expect(signOut).not.toHaveBeenCalled()
    expect(getPostAuthRedirect).not.toHaveBeenCalled()
  })

  it('on paused user, signs out and redirects to /account-paused', async () => {
    mockAdminFrom.mockReturnValue(profileLookup({ status: 'paused', role: 'user' }))
    await expect(signInAction({}, fd({
      email: 'paused@example.com', password: 'hunter22hunter',
    }))).rejects.toThrowError(/NEXT_REDIRECT:\/account-paused/)
    expect(signOut).toHaveBeenCalledTimes(1)
  })

  it('superadmin is never gated by status (defense against locking yourself out)', async () => {
    mockAdminFrom.mockReturnValue(profileLookup({ status: 'paused', role: 'superadmin' }))
    getPostAuthRedirect.mockResolvedValue('/dashboard')
    await expect(signInAction({}, fd({
      email: 'admin@example.com', password: 'hunter22hunter',
    }))).rejects.toThrowError(/NEXT_REDIRECT:\/dashboard/)
    expect(signOut).not.toHaveBeenCalled()
  })

  it('returns formError on bad credentials and does not call redirect', async () => {
    signInWithPassword.mockResolvedValue({ data: null, error: { message: 'invalid' } } as never)
    const res = await signInAction({}, fd({
      email: 'bad@example.com', password: 'hunter22hunter',
    }))
    expect(res.formError).toMatch(/invalid/i)
    expect(getPostAuthRedirect).not.toHaveBeenCalled()
    expect(redirectMock).not.toHaveBeenCalled()
  })
})
