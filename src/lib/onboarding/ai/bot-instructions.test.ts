import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rag', () => ({
  HfRouterLlm: vi.fn().mockImplementation(function HfRouterLlmMock(this: { complete: ReturnType<typeof vi.fn> }) {
    this.complete = vi.fn(async () =>
      JSON.stringify({
        bot_send_instructions: 'Send the booking link when the customer asks about scheduling.',
        recommendation_rules: 'Wait until the customer mentions a specific date/time or asks "kelan available". Confirm need then send link.',
        required_slots: ['preferred_date'],
        confidence_threshold: 0.6,
      }),
    )
    return this
  }),
}))

import { generateBotInstructions } from './bot-instructions'
import type { BusinessBasics } from '@/lib/onboarding/business-basics'

const basics: BusinessBasics = {
  name: 'Bakery', offer: 'ensaymada', business_type: 'ecom',
  audience: 'titas', pain: 'no time', tone: 'friendly',
}

describe('generateBotInstructions', () => {
  it('returns parsed fields', async () => {
    const r = await generateBotInstructions({
      basics, lang: 'tl', goal: 'booking',
      action_page: { title: 'Book a tasting', cta_label: 'Book a slot' },
      flow_description: 'They ask price, then I send booking link.',
    })
    expect(r.bot_send_instructions).toMatch(/booking/i)
    expect(r.recommendation_rules).toMatch(/specific date/i)
    expect(r.required_slots).toEqual(['preferred_date'])
    expect(r.confidence_threshold).toBeCloseTo(0.6)
  })
})
