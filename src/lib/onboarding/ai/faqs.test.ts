import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rag', () => ({
  HfRouterLlm: vi.fn().mockImplementation(function HfRouterLlmMock(this: { complete: ReturnType<typeof vi.fn> }) {
    this.complete = vi.fn(async () =>
      JSON.stringify({
        suggestions: [
          { question: 'Magkano?', answer: 'PHP 250 each, free shipping in QC.' },
          { question: 'Anong oras kayo bukas?', answer: '8am-6pm Mon-Sat.' },
          { question: 'Pwede COD?', answer: 'Yes, cash on delivery in QC.' },
          { question: 'Saan kayo nag-deliver?', answer: 'QC, Marikina, Pasig.' },
          { question: 'Paano mag-order?', answer: 'Message us here on Messenger.' },
        ],
      }),
    )
    return this
  }),
}))

import { generateFaqs } from './faqs'
import type { BusinessBasics } from '@/lib/onboarding/business-basics'

const basics: BusinessBasics = {
  name: 'Aling Nena Bakery',
  offer: 'Fresh ensaymada delivered daily',
  business_type: 'ecom',
  audience: 'Tita-aged moms in QC',
  pain: "They want merienda but can't bake",
  tone: 'friendly',
}

describe('generateFaqs', () => {
  it('returns the suggested FAQ list', async () => {
    const out = await generateFaqs({ basics, lang: 'tl' })
    expect(out.suggestions).toHaveLength(5)
    expect(out.suggestions[0]).toEqual({ question: 'Magkano?', answer: 'PHP 250 each, free shipping in QC.' })
  })

  it('throws generation_failed when the model keeps returning bad JSON', async () => {
    const { HfRouterLlm } = await import('@/lib/rag')
    const m = HfRouterLlm as unknown as { mockImplementation: (fn: () => unknown) => void }
    m.mockImplementation(function Bad(this: { complete: ReturnType<typeof vi.fn> }) {
      this.complete = vi.fn(async () => 'nope')
      return this
    })
    await expect(generateFaqs({ basics, lang: 'tl' })).rejects.toThrow(/generation_failed/i)
  })
})
