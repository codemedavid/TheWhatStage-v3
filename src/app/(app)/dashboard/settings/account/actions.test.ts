import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const redirectMock = vi.hoisted(() =>
  vi.fn((url: string) => {
    const err = new Error(`NEXT_REDIRECT:${url}`) as Error & { digest: string }
    err.digest = `NEXT_REDIRECT;${url}`
    throw err
  }),
)
vi.mock('next/navigation', () => ({ redirect: redirectMock }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const getSession = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/get-session', () => ({ getSession }))

const signInWithPassword = vi.hoisted(() => vi.fn())
const updateUser = vi.hoisted(() => vi.fn())
const signOut = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { signInWithPassword, updateUser, signOut },
  }),
}))

const adminUpdateUserById = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { updateUserById: adminUpdateUserById } },
  }),
}))

import {
  changePasswordAction,
  changeEmailAction,
  signOutEverywhereAction,
} from './actions'

function fd(values: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(values)) f.set(k, v)
  return f
}

const SESSION = {
  userId: 'u1',
  email: 'me@example.com',
  fullName: 'Me',
  role: 'user' as const,
  status: 'active' as const,
  subscriptionTier: 'free' as const,
}

beforeEach(() => {
  redirectMock.mockClear()
  getSession.mockReset().mockResolvedValue(SESSION)
  signInWithPassword.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  updateUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  signOut.mockReset().mockResolvedValue({ error: null })
  adminUpdateUserById.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
})

describe('changePasswordAction', () => {
  it('verifies the current password then updates to the new one', async () => {
    const res = await changePasswordAction({ status: 'idle' }, fd({
      current_password: 'oldpass1234',
      new_password: 'newpass1234',
      confirm_password: 'newpass1234',
    }))

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: 'me@example.com',
      password: 'oldpass1234',
    })
    expect(updateUser).toHaveBeenCalledWith({ password: 'newpass1234' })
    expect(res.status).toBe('ok')
  })

  it('rejects when the current password is wrong (no updateUser call)', async () => {
    signInWithPassword.mockResolvedValue({ data: null, error: { message: 'invalid' } })

    const res = await changePasswordAction({ status: 'idle' }, fd({
      current_password: 'wrongpass12',
      new_password: 'newpass1234',
      confirm_password: 'newpass1234',
    }))

    expect(res.status).toBe('error')
    if (res.status === 'error') expect(res.field).toBe('current_password')
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('returns a validation error when confirmation does not match', async () => {
    const res = await changePasswordAction({ status: 'idle' }, fd({
      current_password: 'oldpass1234',
      new_password: 'newpass1234',
      confirm_password: 'mismatch1234',
    }))

    expect(res.status).toBe('error')
    if (res.status === 'error') expect(res.field).toBe('confirm_password')
    expect(signInWithPassword).not.toHaveBeenCalled()
    expect(updateUser).not.toHaveBeenCalled()
  })

  it('returns an error when there is no session', async () => {
    getSession.mockResolvedValue(null)
    const res = await changePasswordAction({ status: 'idle' }, fd({
      current_password: 'oldpass1234',
      new_password: 'newpass1234',
      confirm_password: 'newpass1234',
    }))
    expect(res.status).toBe('error')
    expect(signInWithPassword).not.toHaveBeenCalled()
  })

  it('surfaces an error when updateUser fails', async () => {
    updateUser.mockResolvedValue({ data: null, error: { message: 'weak password' } })
    const res = await changePasswordAction({ status: 'idle' }, fd({
      current_password: 'oldpass1234',
      new_password: 'newpass1234',
      confirm_password: 'newpass1234',
    }))
    expect(res.status).toBe('error')
  })
})

describe('changeEmailAction', () => {
  it('updates the email via the admin client for the current user', async () => {
    const res = await changeEmailAction({ status: 'idle' }, fd({ email: 'New@Example.com' }))

    expect(adminUpdateUserById).toHaveBeenCalledWith('u1', {
      email: 'new@example.com',
      email_confirm: true,
    })
    expect(res.status).toBe('ok')
  })

  it('rejects an invalid email without calling the admin client', async () => {
    const res = await changeEmailAction({ status: 'idle' }, fd({ email: 'nope' }))
    expect(res.status).toBe('error')
    if (res.status === 'error') expect(res.field).toBe('email')
    expect(adminUpdateUserById).not.toHaveBeenCalled()
  })

  it('does nothing when the email is unchanged', async () => {
    const res = await changeEmailAction({ status: 'idle' }, fd({ email: 'me@example.com' }))
    expect(res.status).toBe('error')
    expect(adminUpdateUserById).not.toHaveBeenCalled()
  })

  it('surfaces an error when the admin update fails', async () => {
    adminUpdateUserById.mockResolvedValue({ data: null, error: { message: 'email taken' } })
    const res = await changeEmailAction({ status: 'idle' }, fd({ email: 'taken@example.com' }))
    expect(res.status).toBe('error')
  })

  it('returns an error when there is no session', async () => {
    getSession.mockResolvedValue(null)
    const res = await changeEmailAction({ status: 'idle' }, fd({ email: 'new@example.com' }))
    expect(res.status).toBe('error')
    expect(adminUpdateUserById).not.toHaveBeenCalled()
  })
})

describe('signOutEverywhereAction', () => {
  it('revokes all sessions globally and redirects to /login', async () => {
    await expect(signOutEverywhereAction()).rejects.toThrowError(/NEXT_REDIRECT:\/login/)
    expect(signOut).toHaveBeenCalledWith({ scope: 'global' })
  })
})
