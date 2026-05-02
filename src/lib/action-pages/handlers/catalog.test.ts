import { describe, expect, it } from 'vitest'
import { parseCatalogSubmission } from './catalog'

describe('parseCatalogSubmission', () => {
  it('parses cart items and customer details', () => {
    const parsed = parseCatalogSubmission({
      items: JSON.stringify([
        { id: '00000000-0000-4000-8000-000000000001', quantity: 2 },
      ]),
      customer_name: 'Ada',
      customer_phone: '+63917',
    })

    expect(parsed.outcome).toBe('checked_out')
    expect(parsed.data.items).toEqual([
      { id: '00000000-0000-4000-8000-000000000001', quantity: 2 },
    ])
    expect(parsed.data.customer).toMatchObject({
      name: 'Ada',
      phone: '+63917',
    })
  })

  it('rejects an empty cart', () => {
    expect(() => parseCatalogSubmission({ items: '[]' })).toThrow()
  })
})
