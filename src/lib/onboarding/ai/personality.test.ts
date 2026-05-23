import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rag', () => ({
  HfRouterLlm: vi.fn().mockImplementation(function HfRouterLlmMock(this: { complete: ReturnType<typeof vi.fn> }) {
    this.complete = vi.fn(async () =>
      JSON.stringify({
        name: 'Nena',
        persona: 'Friendly tita bakery helper who speaks Taglish and is genuinely warm.',
        do_rules: ['Greet with "Hi po!"', 'Confirm address before quoting delivery.'],
        dont_rules: ['Never argue about prices.', "Never promise next-day delivery outside QC."],
        fallback_message: 'Pasensya po, ipapasa ko sa owner para sa exact info.',
      }),
    )
    return this
  }),
}))

import { generatePersonality } from './personality'
import type { BusinessBasics } from '@/lib/onboarding/business-basics'

const basics: BusinessBasics = {
  name: 'Aling Nena Bakery',
  offer: 'Fresh ensaymada delivered daily',
  business_type: 'ecom',
  audience: 'Tita moms in QC',
  pain: "They want merienda but can't bake",
  tone: 'friendly',
}

describe('generatePersonality', () => {
  it('returns name, persona, rules, fallback', async () => {
    const out = await generatePersonality({ basics, seeds: {}, lang: 'tl' })
    expect(out.name).toBe('Nena')
    expect(out.do_rules.length).toBeGreaterThan(0)
    expect(out.dont_rules.length).toBeGreaterThan(0)
    expect(out.fallback_message).toMatch(/owner/i)
  })

  it('retries once when JSON is malformed and succeeds on the second call', async () => {
    const { HfRouterLlm } = await import('@/lib/rag')
    ;(HfRouterLlm as unknown as { mockImplementationOnce: (fn: () => unknown) => void }).mockImplementationOnce(
      function Bad(this: { complete: ReturnType<typeof vi.fn> }) {
        this.complete = vi.fn(async () => 'nope')
        return this
      },
    )
    const out = await generatePersonality({ basics, seeds: {}, lang: 'tl' })
    expect(out.name).toBe('Nena')
  })

  it('throws generation_failed when all attempts fail', async () => {
    const { HfRouterLlm } = await import('@/lib/rag')
    const badImpl = function Bad(this: { complete: ReturnType<typeof vi.fn> }) {
      this.complete = vi.fn(async () => 'nope')
      return this
    }
    const mock = HfRouterLlm as unknown as { mockImplementationOnce: (fn: () => unknown) => void }
    mock.mockImplementationOnce(badImpl)
    mock.mockImplementationOnce(badImpl)
    mock.mockImplementationOnce(badImpl)
    await expect(generatePersonality({ basics, seeds: {}, lang: 'tl' })).rejects.toThrow(/generation_failed/i)
  })
})
