import { describe, expect, it } from 'vitest'
import { classifyComment, parseCommentDecision } from './classify'

describe('parseCommentDecision', () => {
  it('coerces a valid high-confidence spam decision', () => {
    expect(
      parseCommentDecision(
        JSON.stringify({
          category: 'spam',
          confidence: 'high',
          public_reply: null,
          private_reply: null,
          moderation_action: 'delete',
          reason: 'Scam link',
        }),
      ),
    ).toEqual({
      category: 'spam',
      confidence: 'high',
      publicReply: null,
      privateReply: null,
      moderationAction: 'delete',
      reason: 'Scam link',
    })
  })

  it('downgrades destructive low-confidence decisions to none', () => {
    expect(
      parseCommentDecision(
        JSON.stringify({
          category: 'abusive',
          confidence: 'low',
          public_reply: null,
          private_reply: null,
          moderation_action: 'delete',
          reason: 'Unclear tone',
        }),
      )?.moderationAction,
    ).toBe('none')
  })

  it('returns null for malformed JSON', () => {
    expect(parseCommentDecision('{bad json')).toBeNull()
  })
})

describe('classifyComment', () => {
  it('uses injected LLM and parses the result', async () => {
    const decision = await classifyComment({
      message: 'How much is the booking?',
      pageName: 'WhatStage',
      complete: async () =>
        JSON.stringify({
          category: 'question',
          confidence: 'high',
          public_reply: 'Sent you details.',
          private_reply: 'Here are the booking details.',
          moderation_action: 'private_reply',
          reason: 'Asks about pricing',
        }),
    })

    expect(decision).toMatchObject({
      category: 'question',
      confidence: 'high',
      moderationAction: 'private_reply',
    })
  })
})
