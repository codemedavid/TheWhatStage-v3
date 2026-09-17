import { describe, it, expect, vi } from 'vitest'
import { costMicros, isModelPriced } from './pricing'

const MODEL = 'deepseek/deepseek-v4.1-flash'

describe('costMicros', () => {
  it('bills fresh input + output at the model rate', () => {
    // 1M fresh input @ $0.15 + 1M output @ $0.60 = $0.75 = 750_000 micros
    const got = costMicros(MODEL, {
      promptTokens: 1_000_000,
      cachedPromptTokens: 0,
      completionTokens: 1_000_000,
    })
    expect(got).toBe(750_000)
  })

  it('discounts cached prompt tokens (split from fresh input)', () => {
    // 1M prompt of which 1M cached @ $0.015, 0 fresh, 0 output = $0.015 = 15_000 micros
    const got = costMicros(MODEL, {
      promptTokens: 1_000_000,
      cachedPromptTokens: 1_000_000,
      completionTokens: 0,
    })
    expect(got).toBe(15_000)
  })

  it('treats cached as a subset of prompt (fresh = prompt - cached)', () => {
    // 1M prompt, 600k cached → 400k fresh @0.15 = 60_000, 600k cached @0.015 = 9_000
    const got = costMicros(MODEL, {
      promptTokens: 1_000_000,
      cachedPromptTokens: 600_000,
      completionTokens: 0,
    })
    expect(got).toBe(60_000 + 9_000)
  })

  it('never goes negative when cached exceeds prompt (defensive)', () => {
    const got = costMicros(MODEL, {
      promptTokens: 100,
      cachedPromptTokens: 999_999,
      completionTokens: 0,
    })
    expect(got).toBeGreaterThanOrEqual(0)
  })

  it('returns 0 and warns for an unknown model', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const got = costMicros('made-up/model', {
      promptTokens: 1_000_000,
      cachedPromptTokens: 0,
      completionTokens: 1_000_000,
    })
    expect(got).toBe(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('isModelPriced', () => {
  it('is true for a known model and false for an unknown one', () => {
    expect(isModelPriced(MODEL)).toBe(true)
    expect(isModelPriced('meta-llama/Llama-3.3-70B-Instruct:groq')).toBe(false)
  })
})
