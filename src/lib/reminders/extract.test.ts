import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const { completeMock } = vi.hoisted(() => ({
  completeMock: vi.fn<(messages: unknown, opts?: unknown) => Promise<string>>(),
}))

vi.mock('@/lib/rag/llm', () => ({
  HfRouterLlm: class {
    complete = completeMock
  },
}))
vi.mock('@/lib/rag/config', () => ({
  ragConfig: { classifierModel: 'fake-model' },
}))

import { extractReminder } from './extract'

beforeEach(() => completeMock.mockReset())

describe('extractReminder', () => {
  it('returns null without calling the LLM when no time marker is present', async () => {
    const out = await extractReminder('how much po? thanks!')
    expect(out).toBeNull()
    expect(completeMock).not.toHaveBeenCalled()
  })

  it('calls the LLM when a time marker is present', async () => {
    completeMock.mockResolvedValueOnce(
      JSON.stringify({
        has_request: true,
        when_local: '2099-12-31 09:00',
        topic: 'follow up',
        confidence: 'high',
      }),
    )
    const out = await extractReminder('follow up Wednesday morning')
    expect(out).not.toBeNull()
    expect(completeMock).toHaveBeenCalledTimes(1)
  })

  describe('when_local parsing tolerance', () => {
    it('accepts seconds in when_local', async () => {
      completeMock.mockResolvedValueOnce(
        JSON.stringify({
          has_request: true,
          when_local: '2099-12-31 09:00:00',
          topic: 'follow up',
          confidence: 'high',
        }),
      )
      const out = await extractReminder('follow up Wednesday morning')
      expect(out).not.toBeNull()
      // 09:00 Manila == 01:00 UTC
      expect(out?.scheduled_at).toBe('2099-12-31T01:00:00.000Z')
    })

    it('accepts non-zero-padded date and time components', async () => {
      completeMock.mockResolvedValueOnce(
        JSON.stringify({
          has_request: true,
          when_local: '2099-1-5 9:00',
          topic: 'follow up',
          confidence: 'high',
        }),
      )
      const out = await extractReminder('follow up next month at 9am')
      expect(out).not.toBeNull()
      expect(out?.scheduled_at).toBe('2099-01-05T01:00:00.000Z')
    })
  })

  describe('past-time auto-bump', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('bumps a clock time up to 24h in the past forward by one day', async () => {
      // Pretend "now" is 2026-05-19 09:00 Manila (01:00 UTC).
      vi.setSystemTime(new Date('2026-05-19T01:00:00Z'))
      completeMock.mockResolvedValueOnce(
        JSON.stringify({
          has_request: true,
          // LLM mistakenly returned today's 3am (already past) instead of
          // tomorrow's 3am for "follow up at 3am".
          when_local: '2026-05-19 03:00',
          topic: 'follow up',
          confidence: 'high',
        }),
      )
      const out = await extractReminder('follow up later at 3am')
      expect(out).not.toBeNull()
      // Bumped to 2026-05-20 03:00 Manila (= 2026-05-19 19:00 UTC).
      expect(out?.scheduled_at).toBe('2026-05-19T19:00:00.000Z')
    })

    it('returns null when when_local is more than 24h in the past', async () => {
      vi.setSystemTime(new Date('2026-05-19T01:00:00Z'))
      completeMock.mockResolvedValueOnce(
        JSON.stringify({
          has_request: true,
          when_local: '2026-05-10 09:00',
          topic: 'follow up',
          confidence: 'high',
        }),
      )
      const out = await extractReminder('follow up last week')
      expect(out).toBeNull()
    })
  })
})
