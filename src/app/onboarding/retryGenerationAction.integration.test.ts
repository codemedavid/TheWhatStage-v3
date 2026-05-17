import { describe, expect, it, vi, beforeEach } from 'vitest'
import { chain, tableRouter, authUser } from '@/lib/onboarding/__test-helpers__/supabase-mock'

vi.mock('server-only', () => ({}))

const redirectMock = vi.hoisted(() => vi.fn((url: string) => {
  const err = new Error(`NEXT_REDIRECT:${url}`) as Error & { digest: string }
  err.digest = `NEXT_REDIRECT;${url}`
  throw err
}))
vi.mock('next/navigation', () => ({ redirect: redirectMock }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/server', () => ({ after: vi.fn(async (cb: () => unknown) => { await cb() }) }))

const runGeneration = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/onboarding/generation/runner', () => ({ runGeneration }))

const clearJob = vi.hoisted(() => vi.fn(async () => {}))
const getJob = vi.hoisted(() => vi.fn(async () => null))
vi.mock('@/lib/onboarding/generation/repo', () => ({ clearJob, getJob }))

vi.mock('@/lib/rag', () => ({ HfRouterLlm: vi.fn() }))

const getBusinessBasics = vi.hoisted(() => vi.fn())
const getPrimaryActionPage = vi.hoisted(() => vi.fn())
vi.mock('@/lib/onboarding/state', () => ({
  markStep: vi.fn(),
  ensureOnboardingState: vi.fn(),
  saveBusinessBasicsToState: vi.fn(),
  setOnboardingLanguage: vi.fn(),
  completeOnboarding: vi.fn(),
  dismissOnboarding: vi.fn(),
  getBusinessBasics,
  getPrimaryActionPage,
  getOnboardingState: vi.fn(),
  initOnboardingForProfile: vi.fn(),
}))

const getUser = vi.hoisted(() => vi.fn())
const mockFrom = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser }, from: mockFrom }),
  getAuthUser: async () => (await getUser()).data.user,
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mockFrom }) }))

import { retryGenerationAction } from './actions'

function fd(values: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(values)) f.set(k, v)
  return f
}

const BASICS = {
  name: 'Acme',
  offer: 'Coffee',
  business_type: 'cafe',
  audience: 'students',
  pain: 'tired',
  tone: 'friendly',
}

beforeEach(() => {
  redirectMock.mockClear()
  runGeneration.mockReset().mockResolvedValue(undefined)
  clearJob.mockReset().mockResolvedValue(undefined)
  getUser.mockReset().mockResolvedValue(authUser('u1'))
  getBusinessBasics.mockReset().mockResolvedValue(BASICS)
  getPrimaryActionPage.mockReset().mockResolvedValue(null)

  const onboardingState = chain({ data: { ui_language: 'tl', personality_seeds: {}, flow_description: '' }, error: null })
  mockFrom.mockReset().mockImplementation(tableRouter({ onboarding_state: onboardingState }))
})

describe('retryGenerationAction (regenerate CTA)', () => {
  it('clears the existing job row and re-enqueues knowledge before redirecting', async () => {
    await expect(retryGenerationAction(fd({ kind: 'knowledge' })))
      .rejects.toThrowError(/NEXT_REDIRECT:\/onboarding\/knowledge/)

    expect(clearJob).toHaveBeenCalledWith('u1', 'knowledge')
    expect(runGeneration).toHaveBeenCalledTimes(1)
    expect(runGeneration).toHaveBeenCalledWith('u1', 'knowledge', expect.objectContaining({
      basics: expect.objectContaining({ name: 'Acme' }),
      lang: 'tl',
    }))
  })

  it('clears and re-enqueues faqs before redirecting', async () => {
    await expect(retryGenerationAction(fd({ kind: 'faqs' })))
      .rejects.toThrowError(/NEXT_REDIRECT:\/onboarding\/faqs/)

    expect(clearJob).toHaveBeenCalledWith('u1', 'faqs')
    expect(runGeneration).toHaveBeenCalledTimes(1)
    expect(runGeneration).toHaveBeenCalledWith('u1', 'faqs', expect.anything())
  })

  it('redirects to /onboarding/welcome on invalid kind without clearing', async () => {
    await expect(retryGenerationAction(fd({ kind: 'bogus' })))
      .rejects.toThrowError(/NEXT_REDIRECT:\/onboarding\/welcome/)
    expect(clearJob).not.toHaveBeenCalled()
    expect(runGeneration).not.toHaveBeenCalled()
  })
})
