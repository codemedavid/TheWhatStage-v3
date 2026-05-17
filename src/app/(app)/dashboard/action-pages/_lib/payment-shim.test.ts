import { describe, expect, it } from 'vitest'
import { migrateCatalogPaymentConfig } from './payment-shim'

describe('migrateCatalogPaymentConfig', () => {
  it('returns input unchanged when payment block already present', () => {
    const input = { payment: { enabled: true, excluded_method_ids: ['x'] } }
    expect(migrateCatalogPaymentConfig(input, ['a', 'b', 'x'])).toEqual(input)
  })

  it('converts include-list to exclude-list', () => {
    const input = { payment_method_ids: ['a', 'c'] }
    const out = migrateCatalogPaymentConfig(input, ['a', 'b', 'c', 'd'])
    expect(out).toEqual({
      payment: { enabled: true, excluded_method_ids: ['b', 'd'] },
    })
  })

  it('treats absent payment_method_ids as "all enabled allowed"', () => {
    const out = migrateCatalogPaymentConfig({}, ['a', 'b'])
    expect(out).toEqual({
      payment: { enabled: true, excluded_method_ids: [] },
    })
  })
})
