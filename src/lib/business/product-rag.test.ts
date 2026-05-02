import { describe, expect, it } from 'vitest'
import { buildProductRagText } from './product-rag'

describe('buildProductRagText', () => {
  it('includes public product and recommendation fields', () => {
    const text = buildProductRagText({
      title: 'Starter Whitening Kit',
      summary: 'For first-time users.',
      description: 'A gentle kit for visible whitening.',
      price_amount: 1299,
      currency: 'PHP',
      pricing_model: 'fixed',
      details: {
        features: ['Gentle formula'],
        specifications: [{ name: 'Duration', value: '14 days' }],
        included: ['Tray', 'Gel'],
        availability_note: 'Ships this week',
      },
      recommendation_hints: {
        budget_min: 1000,
        budget_max: 1500,
        desired_results: ['whiter teeth'],
        best_for: ['beginners'],
        not_for: ['children'],
        keywords: ['teeth whitening'],
      },
    })

    expect(text).toContain('Starter Whitening Kit')
    expect(text).toContain('Price: PHP 1299')
    expect(text).toContain('Desired results: whiter teeth')
    expect(text).toContain('Duration: 14 days')
  })

  it('does not include unknown private fields from details or hints', () => {
    const text = buildProductRagText({
      title: 'Private Test Product',
      summary: null,
      description: null,
      price_amount: null,
      currency: 'PHP',
      pricing_model: 'quote',
      details: { internal_cost: '10', features: [] },
      recommendation_hints: { owner_note: 'never expose', keywords: [] },
    })

    expect(text).toContain('Private Test Product')
    expect(text).not.toContain('internal_cost')
    expect(text).not.toContain('owner_note')
    expect(text).not.toContain('never expose')
  })
})
