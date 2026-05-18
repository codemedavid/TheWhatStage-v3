import { describe, expect, it, vi, beforeEach } from 'vitest'

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
})
