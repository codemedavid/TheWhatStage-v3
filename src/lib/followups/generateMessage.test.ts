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
      instruction: '',
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
      instruction: '',
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
      instruction: '',
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
      instruction: '',
    })
    expect(text).toBe('Hey any thoughts on the proposal?')
  })

  it('calls the LLM for slot 0 when an instruction is set (no short-circuit)', async () => {
    completeMock.mockResolvedValueOnce('Hi Ana, kumusta na po?')
    const text = await generateFollowupMessage({
      kind: 'generic',
      slot: 0,
      leadName: 'Ana',
      personalityBlock: '',
      recentMessages: [],
      instruction: 'Quick warm hello, ask if still interested.',
    })
    expect(completeMock).toHaveBeenCalledTimes(1)
    expect(text).toBe('Hi Ana, kumusta na po?')
  })

  it('still short-circuits slot 0 to the fallback when instruction is empty', async () => {
    const text = await generateFollowupMessage({
      kind: 'generic',
      slot: 0,
      leadName: 'Jay',
      personalityBlock: '',
      recentMessages: [],
      instruction: '',
    })
    expect(completeMock).not.toHaveBeenCalled()
    expect(text).toBe('Hi Jay, interested pa po kayo?')
  })

  it('injects the Touchpoint guide block into the system prompt when instruction is set', async () => {
    completeMock.mockResolvedValueOnce('Hi Ana, share lang po na flexible kami sa schedule.')
    await generateFollowupMessage({
      kind: 'real',
      slot: 2,
      leadName: 'Ana',
      personalityBlock: 'warm',
      recentMessages: [
        { role: 'user', content: 'magkano po?' },
        { role: 'assistant', content: '5k po.' },
      ],
      instruction: 'Share a concrete benefit or social proof.',
    })
    const messages = completeMock.mock.calls[0][0] as Array<{ role: string; content: string }>
    const system = messages.find((m) => m.role === 'system')!
    expect(system.content).toContain('Touchpoint guide for THIS message')
    expect(system.content).toContain('Share a concrete benefit or social proof.')
  })

  it('omits the Touchpoint guide block when instruction is empty (no behavior change)', async () => {
    completeMock.mockResolvedValueOnce('hi')
    await generateFollowupMessage({
      kind: 'real',
      slot: 3,
      leadName: 'Ana',
      personalityBlock: '',
      recentMessages: [],
      instruction: '',
    })
    const messages = completeMock.mock.calls[0][0] as Array<{ role: string; content: string }>
    const system = messages.find((m) => m.role === 'system')!
    expect(system.content).not.toContain('Touchpoint guide')
  })

  it('falls back when LLM fails even with an instruction set', async () => {
    completeMock.mockRejectedValueOnce(new Error('boom'))
    const text = await generateFollowupMessage({
      kind: 'generic',
      slot: 4,
      leadName: 'Jay',
      personalityBlock: '',
      recentMessages: [],
      instruction: 'Light reminder.',
    })
    // Fallback for slot 4 generic.
    expect(text).toBe('Hi Jay, available pa po kayo to chat?')
  })
})
