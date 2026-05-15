import { describe, expect, it } from 'vitest'
import { BusinessBasicsSchema, BUSINESS_TYPES, TONE_PRESETS } from './business-basics'

describe('BusinessBasicsSchema', () => {
  it('accepts a fully filled object', () => {
    const ok = BusinessBasicsSchema.safeParse({
      name: 'Aling Nena Bakery',
      offer: 'Fresh ensaymada delivered daily',
      business_type: 'ecom',
      audience: 'Tita-aged moms in Quezon City',
      pain: "They want merienda but can't bake themselves",
      tone: 'friendly',
    })
    expect(ok.success).toBe(true)
  })

  it('rejects empty name', () => {
    const r = BusinessBasicsSchema.safeParse({
      name: '',
      offer: 'x',
      business_type: 'service',
      audience: 'x',
      pain: 'x',
      tone: 'professional',
    })
    expect(r.success).toBe(false)
  })

  it('rejects unknown business_type', () => {
    const r = BusinessBasicsSchema.safeParse({
      name: 'x',
      offer: 'x',
      business_type: 'foo',
      audience: 'x',
      pain: 'x',
      tone: 'professional',
    })
    expect(r.success).toBe(false)
  })

  it('rejects fields > 500 chars', () => {
    const long = 'x'.repeat(501)
    const r = BusinessBasicsSchema.safeParse({
      name: 'ok',
      offer: long,
      business_type: 'service',
      audience: 'x',
      pain: 'x',
      tone: 'professional',
    })
    expect(r.success).toBe(false)
  })

  it('exposes 4 business types and 4 tone presets', () => {
    expect(BUSINESS_TYPES.length).toBe(4)
    expect(TONE_PRESETS.length).toBe(4)
  })
})
