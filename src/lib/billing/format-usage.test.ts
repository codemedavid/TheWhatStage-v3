import { describe, it, expect } from 'vitest'
import { usdFromMicros, formatUsd } from './format-usage'

describe('usdFromMicros', () => {
  it('converts USD micros to a USD number', () => {
    expect(usdFromMicros(2_099_700)).toBeCloseTo(2.0997, 4)
  })

  it('returns 0 for zero / null-ish input', () => {
    expect(usdFromMicros(0)).toBe(0)
  })
})

describe('formatUsd', () => {
  it('formats micros as a 2-decimal USD string', () => {
    expect(formatUsd(2_099_700)).toBe('$2.10')
  })

  it('formats zero as $0.00', () => {
    expect(formatUsd(0)).toBe('$0.00')
  })

  it('uses up to 4 decimals for sub-cent amounts when precise=true', () => {
    // $0.00768 sample bill — 2 decimals would round to $0.01 and hide it.
    expect(formatUsd(7_680, { precise: true })).toBe('$0.0077')
  })

  it('groups thousands for large totals', () => {
    expect(formatUsd(1_234_560_000)).toBe('$1,234.56')
  })
})
