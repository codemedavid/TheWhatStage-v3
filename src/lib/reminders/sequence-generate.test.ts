import { describe, expect, it, vi, beforeEach } from 'vitest'

const completeMock = vi.fn<(messages: unknown, opts?: unknown) => Promise<string>>()

vi.mock('@/lib/rag/llm', () => ({
  HfRouterLlm: class {
    complete = completeMock
  },
}))
vi.mock('@/lib/rag/config', () => ({
  ragConfig: { classifierModel: 'fake-model' },
}))

import { buildSequencePrompt, generateSequenceMessage } from './sequence-generate'

const fixedNow = new Date('2026-08-10T06:00:00.000Z') // Mon 2pm Manila
const anchor = new Date('2026-08-12T06:00:00.000Z') // Wed 2pm Manila

describe('buildSequencePrompt', () => {
  it('includes current Manila time, topic, position, anchor, and scheduled time', () => {
    const { system, user } = buildSequencePrompt({
      now: fixedNow,
      anchor,
      position: 0,
      topic: 'pricing for the 3BR unit',
      leadName: 'Maria',
      personalityBlock: 'warm Taglish sales tone',
      recentMessages: [],
    })
    expect(system).toContain('Current time:')
    expect(system).toContain('Asia/Manila')
    expect(system).toContain('pricing for the 3BR unit')
    expect(system).toContain('message #1 of 7')
    expect(system).toContain('warm Taglish sales tone')
    expect(system).toContain('Maria')
    expect(user.length).toBeGreaterThan(0)
  })

  it('appends transcript to user message when recentMessages are provided', () => {
    const { user } = buildSequencePrompt({
      now: fixedNow,
      anchor,
      position: 2,
      topic: 'pricing',
      leadName: 'Maria',
      personalityBlock: '',
      recentMessages: [
        { role: 'user', content: 'how much po?' },
        { role: 'assistant', content: 'Starts at 5k po.' },
      ],
    })
    expect(user).toContain('how much po?')
    expect(user).toContain('Starts at 5k po.')
  })

  it('throws on out-of-range position', () => {
    expect(() =>
      buildSequencePrompt({
        now: fixedNow,
        anchor,
        position: 7,
        topic: 't',
        leadName: null,
        personalityBlock: '',
        recentMessages: [],
      }),
    ).toThrow()
  })
})

describe('generateSequenceMessage', () => {
  beforeEach(() => completeMock.mockReset())

  it('returns sanitized LLM output on success', async () => {
    completeMock.mockResolvedValueOnce('"Hi Maria, ready na ako para sa pricing - balikan natin?"')
    const text = await generateSequenceMessage({
      now: fixedNow,
      anchor,
      position: 0,
      topic: 'pricing for the 3BR unit',
      leadName: 'Maria',
      personalityBlock: 'warm',
      recentMessages: [],
    })
    expect(text).not.toMatch(/[-‐‑‒–—―]/)
    expect(text!.split('\n').length).toBe(1)
    expect(text).toContain('Maria')
  })

  it('returns null on LLM rejection', async () => {
    completeMock.mockRejectedValueOnce(new Error('boom'))
    const text = await generateSequenceMessage({
      now: fixedNow,
      anchor,
      position: 1,
      topic: 'pricing',
      leadName: null,
      personalityBlock: '',
      recentMessages: [],
    })
    expect(text).toBeNull()
  })

  it('returns null on empty/whitespace LLM response', async () => {
    completeMock.mockResolvedValueOnce('   ')
    const text = await generateSequenceMessage({
      now: fixedNow,
      anchor,
      position: 2,
      topic: 'pricing',
      leadName: 'Maria',
      personalityBlock: '',
      recentMessages: [],
    })
    expect(text).toBeNull()
  })
})
