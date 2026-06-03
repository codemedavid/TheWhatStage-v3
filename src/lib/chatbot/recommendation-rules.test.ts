import { describe, expect, it } from 'vitest'
import { parseRecommendationRules, getActionPageRecommendationRules } from './config'
import type { ChatbotConfig } from './config'

const PAGE_ID = '00000000-0000-4000-8000-000000000aa1'

describe('parseRecommendationRules', () => {
  // The onboarding writer historically persisted camelCase keys while the
  // parser only read snake_case — silently dropping every configured rule and
  // disabling the recommend_product / recommend_property card routing. Both
  // casings must round-trip so already-saved rows still load.
  it('reads camelCase rows (legacy onboarding writes)', () => {
    const parsed = parseRecommendationRules({
      defaultConfidenceThreshold: 0.6,
      perActionPage: {
        [PAGE_ID]: {
          rules: 'Recommend when budget is known.',
          requiredSlots: ['budget_range'],
          confidenceThreshold: 0.7,
        },
      },
    })
    expect(parsed.defaultConfidenceThreshold).toBe(0.6)
    expect(parsed.perActionPage[PAGE_ID]).toEqual({
      rules: 'Recommend when budget is known.',
      requiredSlots: ['budget_range'],
      confidenceThreshold: 0.7,
    })
  })

  it('reads snake_case rows (canonical shape)', () => {
    const parsed = parseRecommendationRules({
      default_confidence_threshold: 0.5,
      per_action_page: {
        [PAGE_ID]: {
          rules: 'Recommend on explicit ask.',
          required_slots: ['preferred_date'],
          confidence_threshold: 0.55,
        },
      },
    })
    expect(parsed.perActionPage[PAGE_ID]).toEqual({
      rules: 'Recommend on explicit ask.',
      requiredSlots: ['preferred_date'],
      confidenceThreshold: 0.55,
    })
  })

  it('drops entries with no rules string', () => {
    const parsed = parseRecommendationRules({
      per_action_page: { [PAGE_ID]: { required_slots: ['x'] } },
    })
    expect(parsed.perActionPage[PAGE_ID]).toBeUndefined()
  })

  it('getActionPageRecommendationRules returns parsed camelCase rules', () => {
    const config = {
      recommendationRules: parseRecommendationRules({
        perActionPage: { [PAGE_ID]: { rules: 'go', requiredSlots: [], confidenceThreshold: 0.5 } },
      }),
    } as ChatbotConfig
    expect(getActionPageRecommendationRules(config, PAGE_ID)?.rules).toBe('go')
    expect(getActionPageRecommendationRules(config, null)).toBeNull()
  })
})
