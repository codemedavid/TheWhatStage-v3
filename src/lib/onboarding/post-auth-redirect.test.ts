import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const getOnboardingState = vi.hoisted(() => vi.fn())
vi.mock('./state', () => ({ getOnboardingState }))

import { getPostAuthRedirect } from './post-auth-redirect'
import type { OnboardingState } from './types'

const baseState: OnboardingState = {
  profileId: 'p1',
  business_completed_at: null,
  knowledge_completed_at: null,
  faqs_completed_at: null,
  personality_completed_at: null,
  goal_completed_at: null,
  goal_content_completed_at: null,
  flow_completed_at: null,
  completed_at: null,
  dismissed_at: null,
  business_basics: null,
  faq_seeds: null,
  personality_seeds: null,
  flow_description: null,
  ai_generations: [],
  ui_language: 'tl',
  customer_language: 'tl',
  created_at: '',
  updated_at: '',
}

beforeEach(() => getOnboardingState.mockReset())

describe('getPostAuthRedirect', () => {
  it('routes to /onboarding/welcome when no state row exists', async () => {
    getOnboardingState.mockResolvedValue(null)
    expect(await getPostAuthRedirect()).toBe('/onboarding/welcome')
  })

  it('routes to /onboarding/welcome when state row exists but every step is untouched', async () => {
    getOnboardingState.mockResolvedValue({ ...baseState })
    expect(await getPostAuthRedirect()).toBe('/onboarding/welcome')
  })

  it('routes to /dashboard when completed_at is set', async () => {
    getOnboardingState.mockResolvedValue({ ...baseState, completed_at: '2026-05-15T00:00:00Z' })
    expect(await getPostAuthRedirect()).toBe('/dashboard')
  })

  it('routes to /dashboard when dismissed_at is set', async () => {
    getOnboardingState.mockResolvedValue({ ...baseState, dismissed_at: '2026-05-15T00:00:00Z' })
    expect(await getPostAuthRedirect()).toBe('/dashboard')
  })

  it('routes to the next incomplete step after business when business is done', async () => {
    getOnboardingState.mockResolvedValue({ ...baseState, business_completed_at: 'x' })
    expect(await getPostAuthRedirect()).toBe('/onboarding/knowledge')
  })

  it('skips the middle steps and returns flow when only flow is incomplete', async () => {
    getOnboardingState.mockResolvedValue({
      ...baseState,
      business_completed_at: 'x',
      knowledge_completed_at: 'x',
      faqs_completed_at: 'x',
      personality_completed_at: 'x',
      goal_completed_at: 'x',
      goal_content_completed_at: 'x',
    })
    expect(await getPostAuthRedirect()).toBe('/onboarding/flow')
  })

  it('returns /onboarding/done when every step is complete but completed_at is unset', async () => {
    getOnboardingState.mockResolvedValue({
      ...baseState,
      business_completed_at: 'x',
      knowledge_completed_at: 'x',
      faqs_completed_at: 'x',
      personality_completed_at: 'x',
      goal_completed_at: 'x',
      goal_content_completed_at: 'x',
      flow_completed_at: 'x',
    })
    expect(await getPostAuthRedirect()).toBe('/onboarding/done')
  })

  it('treats dismissed_at as terminal even when mid-flow', async () => {
    getOnboardingState.mockResolvedValue({
      ...baseState,
      business_completed_at: 'x',
      dismissed_at: '2026-05-15T00:00:00Z',
    })
    expect(await getPostAuthRedirect()).toBe('/dashboard')
  })
})
