import { describe, expect, it } from 'vitest'
import { isPriceInquiry, priceInquiryDecision } from './inquiry'

describe('isPriceInquiry', () => {
  it('detects "hm?" shorthand for "how much"', () => {
    // The reported bug: bare "hm?" comments were classified needs_no_action.
    expect(isPriceInquiry('hm?')).toBe(true)
    expect(isPriceInquiry('Hm?')).toBe(true)
    expect(isPriceInquiry('HM')).toBe(true)
    expect(isPriceInquiry('hm po?')).toBe(true)
    expect(isPriceInquiry('hmm?')).toBe(true)
  })

  it('detects Taglish/English price questions', () => {
    expect(isPriceInquiry('magkano po?')).toBe(true)
    expect(isPriceInquiry('How much is this?')).toBe(true)
    expect(isPriceInquiry('how much po')).toBe(true)
    expect(isPriceInquiry('presyo?')).toBe(true)
    expect(isPriceInquiry('price?')).toBe(true)
    expect(isPriceInquiry('pricelist please')).toBe(true)
    expect(isPriceInquiry('price list po')).toBe(true)
    expect(isPriceInquiry('magkano lahat')).toBe(true)
  })

  it('detects buying / availability intent shorthands', () => {
    expect(isPriceInquiry('pm me')).toBe(true)
    expect(isPriceInquiry('pm price')).toBe(true)
    expect(isPriceInquiry('interested')).toBe(true)
    expect(isPriceInquiry('available po ba?')).toBe(true)
    expect(isPriceInquiry('still available?')).toBe(true)
    expect(isPriceInquiry('how to order')).toBe(true)
    expect(isPriceInquiry('paano umorder')).toBe(true)
  })

  it('returns false for non-inquiry engagement comments', () => {
    expect(isPriceInquiry('Nice photo!')).toBe(false)
    expect(isPriceInquiry('love this team')).toBe(false)
    expect(isPriceInquiry('salamat po')).toBe(false)
    expect(isPriceInquiry('congrats')).toBe(false)
    expect(isPriceInquiry('')).toBe(false)
    expect(isPriceInquiry('   ')).toBe(false)
  })

  it('does not misfire on words that merely contain a keyword', () => {
    // "3pm" must not match the "pm" message-request keyword.
    expect(isPriceInquiry('see you at 3pm')).toBe(false)
    // "chmm" / unrelated words containing "hm" must not match.
    expect(isPriceInquiry('rhythm')).toBe(false)
  })
})

describe('priceInquiryDecision', () => {
  it('returns a high-confidence private_reply question decision', () => {
    const decision = priceInquiryDecision()
    expect(decision.category).toBe('question')
    expect(decision.confidence).toBe('high')
    expect(decision.moderationAction).toBe('private_reply')
    // Both replies are non-null placeholders so the public-reply fallback in
    // chooseGraphAction still fires when private replies are not permitted.
    expect(decision.privateReply).toBeTruthy()
    expect(decision.publicReply).toBeTruthy()
  })
})
