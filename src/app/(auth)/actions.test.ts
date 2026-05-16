import { describe, expect, it, vi, beforeEach } from 'vitest'
import { authUser } from '@/lib/onboarding/__test-helpers__/supabase-mock'

vi.mock('server-only', () => ({}))

const redirectMock = vi.hoisted(() => vi.fn((url: string) => {
  const err = new Error(`NEXT_REDIRECT:${url}`) as Error & { digest: string }
  err.digest = `NEXT_REDIRECT;${url}`
  throw err
}))
vi.mock('next/navigation', () => ({ redirect: redirectMock }))

const adminAuthCreate = vi.hoisted(() => vi.fn(async () => ({ data: { user: { id: 'u1' } }, error: null })))
const initOnboardingForProfile = vi.hoisted(() => vi.fn(async () => {}))
const getPostAuthRedirect = vi.hoisted(() => vi.fn(async () => '/onboarding/welcome'))

vi.mock('@/lib/onboarding/state', () => ({
  initOnboardingForProfile,
  ensureOnboardingState: vi.fn(async () => {}),
  markStep: vi.fn(async () => {}),
  setOnboardingLanguage: vi.fn(),
  completeOnboarding: vi.fn(),
  dismissOnboarding: vi.fn(),
  saveBusinessBasicsToState: vi.fn(),
  getBusinessBasics: vi.fn(),
  getPrimaryActionPage: vi.fn(),
  getOnboardingState: vi.fn(),
}))
vi.mock('@/lib/onboarding/post-auth-redirect', () => ({ getPostAuthRedirect }))

const signInWithPassword = vi.hoisted(() => vi.fn())
const getUser = vi.hoisted(() => vi.fn())
const mockFrom = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { signInWithPassword, getUser },
    from: mockFrom,
  }),
  getAuthUser: async () => (await getUser()).data.user,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { createUser: adminAuthCreate } },
    from: mockFrom,
  }),
}))

import { signUpAction, signInAction } from './actions'

beforeEach(() => {
  redirectMock.mockClear()
  adminAuthCreate.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  signInWithPassword.mockReset().mockResolvedValue({ data: {}, error: null })
  getUser.mockReset().mockResolvedValue(authUser('u1'))
  initOnboardingForProfile.mockReset().mockResolvedValue(undefined)
  getPostAuthRedirect.mockReset().mockResolvedValue('/onboarding/welcome')
  mockFrom.mockReset()
})

function fd(values: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(values)) f.set(k, v)
  return f
}

describe('signUpAction', () => {
  it('creates user, initializes onboarding state, and redirects to /onboarding/welcome', async () => {
    await expect(signUpAction({}, fd({
      full_name: 'Aling Nena',
      email: 'nena@example.com',
      password: 'hunter22hunter',
    }))).rejects.toThrowError(/NEXT_REDIRECT:\/onboarding\/welcome/)

    expect(adminAuthCreate).toHaveBeenCalledWith(expect.objectContaining({
      email: 'nena@example.com',
      email_confirm: true,
      user_metadata: { full_name: 'Aling Nena' },
    }))
    expect(signInWithPassword).toHaveBeenCalled()
    expect(initOnboardingForProfile).toHaveBeenCalledWith('u1')
    expect(redirectMock).toHaveBeenCalledWith('/onboarding/welcome')
  })

  it('returns formError "already exists" when admin create reports duplicate', async () => {
    adminAuthCreate.mockResolvedValue({ data: null, error: { message: 'User already registered' } } as never)
    const res = await signUpAction({}, fd({
      full_name: 'X', email: 'dup@example.com', password: 'hunter22hunter',
    }))
    expect(res.formError).toMatch(/already exists/i)
    expect(initOnboardingForProfile).not.toHaveBeenCalled()
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it('returns fieldErrors on validation failure (no admin call)', async () => {
    const res = await signUpAction({}, fd({ full_name: '', email: 'no', password: '' }))
    expect(res.fieldErrors).toBeDefined()
    expect(adminAuthCreate).not.toHaveBeenCalled()
  })

  it('returns a friendly formError when initOnboardingForProfile throws (Tier 1 hardening)', async () => {
    initOnboardingForProfile.mockRejectedValueOnce(new Error('init_onboarding_failed'))
    const res = await signUpAction({}, fd({
      full_name: 'Aling Nena',
      email: 'nena@example.com',
      password: 'hunter22hunter',
    }))
    expect(res.formError).toMatch(/setup could not start/i)
    expect(redirectMock).not.toHaveBeenCalled()
  })
})

describe('signInAction', () => {
  it('on success, redirects to the result of getPostAuthRedirect (mid-flow user)', async () => {
    getPostAuthRedirect.mockResolvedValue('/onboarding/knowledge')
    await expect(signInAction({}, fd({
      email: 'mid@example.com', password: 'hunter22hunter',
    }))).rejects.toThrowError(/NEXT_REDIRECT:\/onboarding\/knowledge/)
    expect(getPostAuthRedirect).toHaveBeenCalledTimes(1)
    expect(redirectMock).toHaveBeenCalledWith('/onboarding/knowledge')
  })

  it('on completed onboarding, redirects to /dashboard via getPostAuthRedirect', async () => {
    getPostAuthRedirect.mockResolvedValue('/dashboard')
    await expect(signInAction({}, fd({
      email: 'done@example.com', password: 'hunter22hunter',
    }))).rejects.toThrowError(/NEXT_REDIRECT:\/dashboard/)
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
