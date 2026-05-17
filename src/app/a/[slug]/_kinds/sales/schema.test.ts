import { describe, expect, it } from 'vitest'
import { parseSalesConfig } from './schema'

describe('parseSalesConfig payment block', () => {
  it('defaults payment.enabled to true when missing', () => {
    const cfg = parseSalesConfig({})
    expect(cfg.payment.enabled).toBe(true)
    expect(cfg.payment.excluded_method_ids).toEqual([])
  })

  it('honors explicit disable', () => {
    const cfg = parseSalesConfig({ payment: { enabled: false } })
    expect(cfg.payment.enabled).toBe(false)
  })

  it('keeps excluded ids as a string array', () => {
    const cfg = parseSalesConfig({
      payment: { excluded_method_ids: ['m1', 'm2', 5 as unknown as string] },
    })
    expect(cfg.payment.excluded_method_ids).toEqual(['m1', 'm2'])
  })
})
