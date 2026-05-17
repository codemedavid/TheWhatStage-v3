import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rag', () => ({
  HfRouterLlm: vi.fn().mockImplementation(function HfRouterLlmMock(this: { complete: ReturnType<typeof vi.fn> }) {
    this.complete = vi.fn(async () =>
      JSON.stringify({
        sections: [
          { title: 'About us', body: 'We bake fresh.' },
          { title: 'What we offer', body: 'Ensaymada, pandesal.' },
          { title: 'Who it’s for', body: 'Tita moms in QC.' },
          { title: 'How to order', body: 'Message us on FB.' },
        ],
      }),
    )
    return this
  }),
}))

import { generateKnowledge } from './knowledge'
import type { BusinessBasics } from '@/lib/onboarding/business-basics'

const basics: BusinessBasics = {
  name: 'Aling Nena Bakery',
  offer: 'Fresh ensaymada delivered daily',
  business_type: 'ecom',
  audience: 'Tita-aged moms in QC',
  pain: "They want merienda but can't bake",
  tone: 'friendly',
}

describe('generateKnowledge', () => {
  it('returns parsed sections from the LLM', async () => {
    const out = await generateKnowledge({ basics, lang: 'tl' })
    expect(out.sections).toHaveLength(4)
    expect(out.sections[0]).toEqual({ title: 'About us', body: 'We bake fresh.' })
  })

  it('throws a typed error if the model keeps returning invalid JSON', async () => {
    const { HfRouterLlm } = await import('@/lib/rag')
    const m = HfRouterLlm as unknown as { mockImplementation: (fn: () => unknown) => void }
    m.mockImplementation(function HfRouterLlmBad(this: { complete: ReturnType<typeof vi.fn> }) {
      this.complete = vi.fn(async () => 'not-json')
      return this
    })
    await expect(generateKnowledge({ basics, lang: 'tl' })).rejects.toThrow(/generation_failed/i)
  })
})
