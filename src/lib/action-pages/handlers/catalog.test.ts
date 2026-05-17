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

  it('parses payment proof fields', () => {
    const parsed = parseCatalogSubmission({
      items: JSON.stringify([
        { id: '00000000-0000-4000-8000-000000000001', quantity: 1 },
      ]),
      payment_method_id: '00000000-0000-4000-8000-000000000011',
      payment_proof_url: 'https://ik.imagekit.io/foo/proof.jpg',
      payment_proof_file_id: 'file_abc',
      payment_amount: '199.50',
      payment_note: 'paid via GCash',
    })
    expect(parsed.data.payment_method_id).toBe('00000000-0000-4000-8000-000000000011')
    expect(parsed.data.payment_proof_url).toBe('https://ik.imagekit.io/foo/proof.jpg')
    expect(parsed.data.payment_proof_file_id).toBe('file_abc')
    expect(parsed.data.payment_amount).toBe(199.5)
    expect(parsed.data.payment_note).toBe('paid via GCash')
  })

  it('rejects payment_method_id without a proof url', () => {
    expect(() =>
      parseCatalogSubmission({
        items: JSON.stringify([
          { id: '00000000-0000-4000-8000-000000000001', quantity: 1 },
        ]),
        payment_method_id: '00000000-0000-4000-8000-000000000011',
      }),
    ).toThrow(/payment proof/i)
  })
})
