import { describe, it, expect } from 'vitest'
import { selectReplySegments } from './reply-delivery'

const R = 'Ano po plano niyo?\nFor ordering\nFor monitoring sales'

describe('selectReplySegments', () => {
  it('sends one bubble when nothing is enabled (legacy behaviour)', () => {
    expect(
      selectReplySegments(R, {
        structuredMessagesEnabled: false,
        structuredMessageLayout: 'single',
        splitMessagesEnabled: false,
        splitMaxBubbles: 3,
      }),
    ).toEqual([R])
  })

  it('keeps a single message (line breaks intact) for structured + single', () => {
    expect(
      selectReplySegments(R, {
        structuredMessagesEnabled: true,
        structuredMessageLayout: 'single',
        splitMessagesEnabled: false,
        splitMaxBubbles: 3,
      }),
    ).toEqual([R])
  })

  it('splits per line for structured + bubbles', () => {
    expect(
      selectReplySegments(R, {
        structuredMessagesEnabled: true,
        structuredMessageLayout: 'bubbles',
        splitMessagesEnabled: false,
        splitMaxBubbles: 5,
      }),
    ).toEqual(['Ano po plano niyo?', 'For ordering', 'For monitoring sales'])
  })

  it('structured mode wins over the split-messages toggle when both are on', () => {
    expect(
      selectReplySegments(R, {
        structuredMessagesEnabled: true,
        structuredMessageLayout: 'single',
        splitMessagesEnabled: true,
        splitMaxBubbles: 5,
      }),
    ).toEqual([R])
  })

  it('falls back to sentence-based split when only split-messages is on', () => {
    const reply = 'Salamat po. Ano po budget niyo?'
    expect(
      selectReplySegments(reply, {
        structuredMessagesEnabled: false,
        structuredMessageLayout: 'single',
        splitMessagesEnabled: true,
        splitMaxBubbles: 3,
      }),
    ).toEqual(['Salamat po.', 'Ano po budget niyo?'])
  })
})
