import { describe, expect, it } from 'vitest'
import { fetchPublicCatalogProducts } from './public-dto'

class FakeCatalogQuery {
  filters: Array<[string, unknown]> = []
  orderedBy: { column: string; ascending: boolean } | null = null

  constructor(private readonly rows: unknown[]) {}

  select() {
    return this
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value])
    return this
  }

  order(column: string, options: { ascending: boolean }) {
    this.orderedBy = { column, ascending: options.ascending }
    return Promise.resolve({ data: this.rows, error: null })
  }
}

describe('fetchPublicCatalogProducts', () => {
  it('filters to published products and returns customer-facing price labels', async () => {
    const query = new FakeCatalogQuery([
      {
        id: '00000000-0000-4000-8000-000000000001',
        title: 'Starter Kit',
        slug: 'starter-kit',
        summary: 'Ready to ship',
        description: null,
        price_amount: 1299,
        currency: 'PHP',
        pricing_model: 'fixed',
        inventory_status: 'in_stock',
        tags: ['featured'],
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        title: 'Custom Build',
        slug: 'custom-build',
        summary: null,
        description: null,
        price_amount: null,
        currency: 'PHP',
        pricing_model: 'quote',
        inventory_status: 'not_tracked',
        tags: [],
      },
    ])
    const supabase = {
      from(table: string) {
        expect(table).toBe('business_items')
        return query
      },
    }

    const products = await fetchPublicCatalogProducts(
      supabase as never,
      'user-1',
    )

    expect(query.filters).toEqual([
      ['user_id', 'user-1'],
      ['kind', 'product'],
      ['status', 'published'],
    ])
    expect(query.orderedBy).toEqual({ column: 'updated_at', ascending: false })
    expect(products.map((product) => product.price_label)).toEqual([
      expect.stringContaining('1,299'),
      'Contact for price',
    ])
  })
})
