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

const afterMock = vi.hoisted(() => vi.fn(async (cb: () => unknown) => { await cb() }))
vi.mock('next/server', () => ({ after: afterMock }))

const runGeneration = vi.hoisted(() =>
  vi.fn<(profileId: string, kind: string, input: unknown) => Promise<void>>(async () => {}),
)
vi.mock('@/lib/onboarding/generation/runner', () => ({ runGeneration }))

const markStep = vi.hoisted(() => vi.fn(async () => {}))
const saveBusinessBasicsToState = vi.hoisted(() => vi.fn(async () => {}))
const ensureOnboardingState = vi.hoisted(() => vi.fn(async () => {}))
const getBusinessBasics = vi.hoisted(() => vi.fn(async () => null))

vi.mock('@/lib/onboarding/state', () => ({
  markStep,
  saveBusinessBasicsToState,
  ensureOnboardingState,
  setOnboardingLanguage: vi.fn(),
  completeOnboarding: vi.fn(),
  dismissOnboarding: vi.fn(),
  getBusinessBasics,
  getPrimaryActionPage: vi.fn(),
  getOnboardingState: vi.fn(),
  initOnboardingForProfile: vi.fn(),
}))

const onboardingStateRow = chain({ data: { ui_language: 'tl' }, error: null })
const mockFrom = vi.hoisted(() => vi.fn())
const getUser = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser }, from: mockFrom }),
  getAuthUser: async () => (await getUser()).data.user,
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: mockFrom }) }))
vi.mock('@/lib/rag', () => ({ HfRouterLlm: vi.fn() }))

import { saveBusinessBasicsAction } from './actions'

beforeEach(() => {
  redirectMock.mockClear()
  afterMock.mockClear()
  runGeneration.mockReset().mockResolvedValue(undefined)
  markStep.mockReset().mockResolvedValue(undefined)
  saveBusinessBasicsToState.mockReset().mockResolvedValue(undefined)
  ensureOnboardingState.mockReset().mockResolvedValue(undefined)
  getUser.mockReset().mockResolvedValue(authUser('u1'))
  mockFrom.mockReset().mockImplementation(tableRouter({ onboarding_state: onboardingStateRow }))
})

function fd(values: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(values)) f.set(k, v)
  return f
}

const goodForm = {
  name: 'Aling Nena Bakery',
  offer: 'Fresh ensaymada delivered daily',
  business_type: 'ecom',
  audience: 'Tita moms in QC',
  pain: "They want merienda but can't bake",
  tone: 'friendly',
}

describe('saveBusinessBasicsAction', () => {
  it('saves basics, marks the business step, enqueues knowledge + faqs, then redirects', async () => {
    await expect(saveBusinessBasicsAction({}, fd(goodForm)))
      .rejects.toThrowError(/NEXT_REDIRECT:\/onboarding\/knowledge/)

    expect(ensureOnboardingState).toHaveBeenCalled()
    expect(saveBusinessBasicsToState).toHaveBeenCalledWith(expect.objectContaining({ name: 'Aling Nena Bakery' }))
    expect(markStep).toHaveBeenCalledWith('business')

    expect(runGeneration).toHaveBeenCalledTimes(2)
    const kinds = runGeneration.mock.calls.map((c) => c[1]).sort()
    expect(kinds).toEqual(['faqs', 'knowledge'])
    for (const call of runGeneration.mock.calls) {
      expect(call[0]).toBe('u1')
      expect(call[2]).toEqual(expect.objectContaining({
        basics: expect.objectContaining({ name: 'Aling Nena Bakery' }),
        lang: 'tl',
      }))
    }
    expect(redirectMock).toHaveBeenCalledWith('/onboarding/knowledge')
  })

  it('returns fieldErrors and echoes back user input when validation fails', async () => {
    const res = await saveBusinessBasicsAction({}, fd({ ...goodForm, name: '' }))
    expect(res.fieldErrors?.name).toBeDefined()
    expect(res.values?.offer).toBe(goodForm.offer) // Tier 1: preserve input on error
    expect(saveBusinessBasicsToState).not.toHaveBeenCalled()
    expect(runGeneration).not.toHaveBeenCalled()
    expect(redirectMock).not.toHaveBeenCalled()
  })

  it('returns formError + echoed values when persisting basics throws', async () => {
    saveBusinessBasicsToState.mockRejectedValue(new Error('db down'))
    const res = await saveBusinessBasicsAction({}, fd(goodForm))
    expect(res.formError).toMatch(/could not save/i)
    expect(res.values?.name).toBe(goodForm.name)
    expect(runGeneration).not.toHaveBeenCalled()
  })

  it('rejects single-character gibberish (Tier 2 input quality guard)', async () => {
    const res = await saveBusinessBasicsAction({}, fd({
      ...goodForm,
      offer: 'xx',
    }))
    expect(res.fieldErrors?.offer).toBeDefined()
    expect(saveBusinessBasicsToState).not.toHaveBeenCalled()
  })

  it('skips enqueue if user disappeared between save and schedule', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    // ensureOnboardingState would throw "not authenticated" — re-stub so save proceeds
    ensureOnboardingState.mockResolvedValue(undefined)
    await expect(saveBusinessBasicsAction({}, fd(goodForm)))
      .rejects.toThrowError(/NEXT_REDIRECT:\/onboarding\/knowledge/)
    expect(runGeneration).not.toHaveBeenCalled()
  })
})
