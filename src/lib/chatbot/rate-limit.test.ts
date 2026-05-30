import { describe, expect, it } from 'vitest'
import { checkRateLimit } from '@/lib/chatbot/rate-limit'

describe('checkRateLimit', () => {
  it('allows requests up to the configured limit', async () => {
    const key = `test-rl-allow-${Date.now()}`
    const opts = { limit: 3, windowMs: 1000 }

    for (let i = 0; i < 3; i++) {
      const result = await checkRateLimit(key, opts)
      expect(result.allowed).toBe(true)
    }
  })

  it('blocks the request that exceeds the limit and returns retryAfterMs > 0', async () => {
    const key = `test-rl-block-${Date.now()}`
    const opts = { limit: 3, windowMs: 1000 }

    // Exhaust the allowance
    for (let i = 0; i < 3; i++) {
      await checkRateLimit(key, opts)
    }

    // This one must be blocked
    const result = await checkRateLimit(key, opts)
    expect(result.allowed).toBe(false)
    expect(result.retryAfterMs).toBeGreaterThan(0)
  })

  it('uses separate counters for different keys', async () => {
    const opts = { limit: 2, windowMs: 1000 }
    const keyA = `test-rl-keyA-${Date.now()}`
    const keyB = `test-rl-keyB-${Date.now()}`

    // Exhaust keyA
    await checkRateLimit(keyA, opts)
    await checkRateLimit(keyA, opts)
    const blockedA = await checkRateLimit(keyA, opts)
    expect(blockedA.allowed).toBe(false)

    // keyB should still be clean
    const okB = await checkRateLimit(keyB, opts)
    expect(okB.allowed).toBe(true)
  })

  it('returns retryAfterMs of 0 or absent when allowed', async () => {
    const key = `test-rl-ok-${Date.now()}`
    const opts = { limit: 5, windowMs: 1000 }

    const result = await checkRateLimit(key, opts)
    expect(result.allowed).toBe(true)
    // retryAfterMs should be 0, undefined, or absent when the request is allowed
    expect(!result.retryAfterMs || result.retryAfterMs === 0).toBe(true)
  })
})
