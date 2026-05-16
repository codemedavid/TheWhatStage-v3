import { describe, expect, it } from 'vitest'
import { canonicalHash } from './hash'

describe('canonicalHash', () => {
  it('returns a stable 64-char hex string', () => {
    const h = canonicalHash({ a: 1, b: 'two' })
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is order-independent for object keys', () => {
    const a = canonicalHash({ x: 1, y: 2 })
    const b = canonicalHash({ y: 2, x: 1 })
    expect(a).toBe(b)
  })

  it('is order-independent at nested levels', () => {
    const a = canonicalHash({ outer: { p: 1, q: 2 } })
    const b = canonicalHash({ outer: { q: 2, p: 1 } })
    expect(a).toBe(b)
  })

  it('trims top-level string values', () => {
    expect(canonicalHash({ s: '  hello  ' })).toBe(canonicalHash({ s: 'hello' }))
  })

  it('changes when values differ', () => {
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }))
  })

  it('treats arrays as ordered (different order = different hash)', () => {
    expect(canonicalHash({ list: [1, 2] })).not.toBe(canonicalHash({ list: [2, 1] }))
  })
})
