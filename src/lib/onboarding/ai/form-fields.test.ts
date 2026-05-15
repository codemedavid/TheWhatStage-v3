import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rag', () => ({
  HfRouterLlm: vi.fn().mockImplementation(function HfRouterLlmMock(this: { complete: ReturnType<typeof vi.fn> }) {
    this.complete = vi.fn(async () =>
      JSON.stringify({
        blocks: [
          { id: 'f_name',  type: 'field', key: 'full_name', label: 'Buong pangalan',  field_kind: 'short_text', required: true },
          { id: 'f_email', type: 'field', key: 'email',     label: 'Email',           field_kind: 'email',      required: true },
          { id: 'f_msg',   type: 'field', key: 'message',   label: 'Tanong mo?',     field_kind: 'long_text',  required: false },
        ],
      }),
    )
    return this
  }),
}))

import { generateFormFields } from './form-fields'
import type { BusinessBasics } from '@/lib/onboarding/business-basics'

const basics: BusinessBasics = {
  name: 'Aling Nena Bakery', offer: 'Fresh ensaymada', business_type: 'ecom',
  audience: 'Tita moms in QC', pain: 'no time to bake', tone: 'friendly',
}

describe('generateFormFields', () => {
  it('returns block list', async () => {
    const out = await generateFormFields({ basics, kind: 'form', lang: 'tl' })
    expect(out.blocks.length).toBeGreaterThan(0)
    expect(out.blocks[0].key).toBe('full_name')
  })
})
