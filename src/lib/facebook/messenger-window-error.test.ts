import { describe, expect, it } from 'vitest'
import { isHumanAgentUnapprovedError, isOutsideWindowError } from './messenger'

// Verbatim Graph rejection bodies, as graphError() embeds them in the thrown
// message. sendOutbound routes on these to decide between retrying untagged
// and reporting a genuinely closed window.
const TAG_UNAPPROVED = new Error(
  'Graph 400 (code 100): {"error":{"message":"(#100) Cannot tag messages with \'HUMAN_AGENT\' without prior approval.","code":100,"error_subcode":2018276}}',
)
const OUTSIDE_WINDOW = new Error(
  'Graph 400 (code 10): {"error":{"message":"This message is sent outside of allowed window.","code":10,"error_subcode":2018278}}',
)

describe('isOutsideWindowError', () => {
  it('matches Graph subcode 2018278', () => {
    expect(isOutsideWindowError(OUTSIDE_WINDOW)).toBe(true)
  })

  it('matches on the message wording when the subcode is absent', () => {
    expect(
      isOutsideWindowError(new Error('Graph 400: This message is sent outside of allowed window.')),
    ).toBe(true)
  })

  it('does not match the Human Agent approval rejection', () => {
    expect(isOutsideWindowError(TAG_UNAPPROVED)).toBe(false)
  })

  it('does not match unrelated failures or non-errors', () => {
    expect(isOutsideWindowError(new Error('Graph 503: upstream unavailable'))).toBe(false)
    expect(isOutsideWindowError('outside of allowed window')).toBe(false)
  })
})

describe('isHumanAgentUnapprovedError', () => {
  it('matches Graph subcode 2018276 but not the closed-window rejection', () => {
    expect(isHumanAgentUnapprovedError(TAG_UNAPPROVED)).toBe(true)
    expect(isHumanAgentUnapprovedError(OUTSIDE_WINDOW)).toBe(false)
  })
})
