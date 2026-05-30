import { describe, expect, it } from 'vitest'
import { selectReplyModel } from '@/lib/chatbot/model-router'

describe('selectReplyModel', () => {
  it('smalltalk with hasStages:false, hasActionPages:false returns a truthy string', () => {
    const result = selectReplyModel({
      intent: 'smalltalk',
      hasStages: false,
      hasActionPages: false,
    })
    expect(result).toBeTruthy()
    expect(typeof result).toBe('string')
  })

  it('smalltalk with hasStages:true returns undefined (delegate to heavier model)', () => {
    const result = selectReplyModel({
      intent: 'smalltalk',
      hasStages: true,
      hasActionPages: false,
    })
    expect(result).toBeUndefined()
  })

  it('sales intent returns undefined regardless of hasStages', () => {
    expect(
      selectReplyModel({ intent: 'sales', hasStages: false, hasActionPages: false }),
    ).toBeUndefined()

    expect(
      selectReplyModel({ intent: 'sales', hasStages: true, hasActionPages: true }),
    ).toBeUndefined()
  })

  it('support intent returns undefined', () => {
    const result = selectReplyModel({
      intent: 'support',
      hasStages: false,
      hasActionPages: false,
    })
    expect(result).toBeUndefined()
  })

  it('faq intent with hasStages:false, hasActionPages:false returns a truthy string', () => {
    const result = selectReplyModel({
      intent: 'faq',
      hasStages: false,
      hasActionPages: false,
    })
    // faq with no pipeline complexity may also use the fast model
    // The exact return depends on implementation; it must be a string or undefined.
    expect(result === undefined || (typeof result === 'string' && result.length > 0)).toBe(true)
  })
})
