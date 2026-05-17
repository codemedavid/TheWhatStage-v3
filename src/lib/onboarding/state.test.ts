import { describe, expect, it, vi } from 'vitest'

// server-only is a Next.js package not available in the Vitest/jsdom environment
vi.mock('server-only', () => ({}))
// Supabase clients require env vars not present in tests; stub them out
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))

import { progressFraction } from './state'
import type { OnboardingState } from './types'

const empty: OnboardingState = {
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

describe('progressFraction', () => {
  it('returns 0 when no steps complete', () => {
    expect(progressFraction(empty)).toBe(0)
  })

  it('returns 1 when all steps complete', () => {
    const done: OnboardingState = {
      ...empty,
      business_completed_at: 'x',
      knowledge_completed_at: 'x',
      faqs_completed_at: 'x',
      personality_completed_at: 'x',
      goal_completed_at: 'x',
      goal_content_completed_at: 'x',
      flow_completed_at: 'x',
    }
    expect(progressFraction(done)).toBe(1)
  })

  it('returns 3/7 when three steps complete', () => {
    const partial: OnboardingState = {
      ...empty,
      business_completed_at: 'x',
      knowledge_completed_at: 'x',
      faqs_completed_at: 'x',
    }
    expect(progressFraction(partial)).toBeCloseTo(3 / 7)
  })
})
