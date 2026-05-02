import { describe, expect, it } from 'vitest'
import { ProductFormInput } from './schemas'

const baseProduct = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Starter Kit',
  slug: 'starter-kit',
  status: 'draft',
  summary: null,
  description: null,
  price_amount: null,
  compare_at_amount: null,
  currency: 'PHP',
  pricing_model: 'fixed',
  sku: null,
  inventory_status: 'not_tracked',
  tags: [],
  details: {},
  recommendation_hints: {},
  rag_enabled: true,
}

describe('ProductFormInput publishing rules', () => {
  it('requires customer-facing copy before publishing', () => {
    expect(() =>
      ProductFormInput.parse({
        ...baseProduct,
        status: 'published',
        price_amount: 100,
      }),
    ).toThrow(/summary or description/i)
  })

  it('requires a positive price for fixed and starts-at published products', () => {
    expect(() =>
      ProductFormInput.parse({
        ...baseProduct,
        status: 'published',
        summary: 'A public product summary.',
        price_amount: null,
      }),
    ).toThrow(/positive price/i)
  })

  it('allows quote published products without a numeric price', () => {
    const parsed = ProductFormInput.parse({
      ...baseProduct,
      status: 'published',
      summary: 'A public product summary.',
      pricing_model: 'quote',
      price_amount: null,
    })

    expect(parsed.pricing_model).toBe('quote')
  })
})
