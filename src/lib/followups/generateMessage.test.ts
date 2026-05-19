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

import { generateFollowupMessage } from './generateMessage'

describe('generateFollowupMessage', () => {
  beforeEach(() => {
    completeMock.mockReset()
  })

  it('uses the LLM response when it returns content (real, offset 2)', async () => {
    completeMock.mockResolvedValueOnce('Hi Ana, kumusta na yung budget mo for the package?')
    const text = await generateFollowupMessage({
      kind: 'real',
      slot: 2,
      leadName: 'Ana',
      personalityBlock: 'warm and casual',
      recentMessages: [
        { role: 'user', content: 'how much po?' },
        { role: 'assistant', content: 'Starts at 5k po.' },
      ],
    })
    expect(text).toContain('Ana')
    expect(text).not.toMatch(/-|—|–/)
    expect(text.split('\n').length).toBe(1)
  })

  it('uses the fallback pool when LLM throws (generic, offset 0)', async () => {
    completeMock.mockRejectedValueOnce(new Error('llm timeout'))
    const text = await generateFollowupMessage({
      kind: 'generic',
      slot: 0,
      leadName: 'Jay',
      personalityBlock: '',
      recentMessages: [],
    })
    expect(text).toBe('Hi Jay, interested pa po kayo?')
  })

  it('forces offset 0 to be a light check-in for both kinds', async () => {
    completeMock.mockResolvedValueOnce(' "Hi Ana, interested pa po kayo?" ')
    const text = await generateFollowupMessage({
      kind: 'real',
      slot: 0,
      leadName: 'Ana',
      personalityBlock: 'warm',
      recentMessages: [
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
        { role: 'user', content: 'c' },
        { role: 'user', content: 'd' },
      ],
    })
    expect(text).toBe('Hi Ana, interested pa po kayo?')
  })

  it('sanitizes LLM output (dashes stripped, one line)', async () => {
    completeMock.mockResolvedValueOnce('Hey - any thoughts\non the proposal?')
    const text = await generateFollowupMessage({
      kind: 'real',
      slot: 3,
      leadName: null,
      personalityBlock: '',
      recentMessages: [],
    })
    expect(text).toBe('Hey any thoughts on the proposal?')
  })
})
