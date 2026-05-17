import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ redirect: () => { throw new Error('redirect') } }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('next/server', () => ({ after: () => {} }))
vi.mock('@/lib/onboarding/generation/runner', () => ({ runGeneration: () => {} }))
vi.mock('@/lib/onboarding/generation/repo', () => ({ getJob: () => {}, clearJob: () => {} }))
vi.mock('@/lib/rag', () => ({ HfRouterLlm: class {} }))
vi.mock('@/lib/onboarding/state', () => ({
  markStep: () => {},
  ensureOnboardingState: () => {},
  saveBusinessBasicsToState: () => {},
  setOnboardingLanguage: () => {},
  completeOnboarding: () => {},
  dismissOnboarding: () => {},
  getBusinessBasics: () => null,
  getPrimaryActionPage: () => null,
  getOnboardingState: () => null,
  initOnboardingForProfile: () => {},
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) }, from: () => ({}) }),
  getAuthUser: async () => null,
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))

import { uniqueSlug } from './slug'

describe('uniqueSlug (Fix 3: high-entropy suffix)', () => {
  it('produces a kebab-case base from the seed plus an 8-char hex suffix', () => {
    const s = uniqueSlug('My Awesome Bakery')
    expect(s).toMatch(/^my-awesome-bakery-[0-9a-f]{8}$/)
  })

  it('falls back to the provided fallback when the seed strips to empty', () => {
    expect(uniqueSlug('!!!', 'item')).toMatch(/^item-[0-9a-f]{8}$/)
    expect(uniqueSlug('', 'property')).toMatch(/^property-[0-9a-f]{8}$/)
  })

  it('caps the base segment at 40 chars', () => {
    const seed = 'a'.repeat(80)
    const s = uniqueSlug(seed)
    const base = s.replace(/-[0-9a-f]{8}$/, '')
    expect(base.length).toBe(40)
  })

  it('generates collision-resistant suffixes (1000 runs, zero dupes expected)', () => {
    const set = new Set<string>()
    for (let i = 0; i < 1000; i++) set.add(uniqueSlug('same-seed'))
    expect(set.size).toBe(1000)
  })

  it('strips leading and trailing separators from the base', () => {
    expect(uniqueSlug('---Foo Bar---')).toMatch(/^foo-bar-[0-9a-f]{8}$/)
  })
})
