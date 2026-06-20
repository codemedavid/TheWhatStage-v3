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

import { generateActionPageCta, buildCtaSystemPromptForTest } from './generateCta'

const baseArgs = {
  pageTitle: 'Lead Gen Form',
  ctaLabel: 'Open form',
  instructions: 'Send when the customer agrees to start.',
  personalityBlock: 'warm Taglish',
  leadName: 'Ana',
  recentMessages: [
    { role: 'user' as const, content: 'sige po, game na ako' },
    { role: 'assistant' as const, content: 'ayos!' },
  ],
}

describe('generateActionPageCta', () => {
  beforeEach(() => {
    completeMock.mockReset()
  })

  it('parses caption and label from a JSON LLM response', async () => {
    completeMock.mockResolvedValueOnce(
      JSON.stringify({ caption: 'I-claim mo na slot mo 👇', label: 'Claim slot' }),
    )
    const cta = await generateActionPageCta(baseArgs)
    expect(cta).toEqual({ caption: 'I-claim mo na slot mo 👇', label: 'Claim slot' })
  })

  it('clamps the label to the Messenger 20-char button cap', async () => {
    completeMock.mockResolvedValueOnce(
      JSON.stringify({ caption: 'tap 👇', label: 'A'.repeat(40) }),
    )
    const cta = await generateActionPageCta(baseArgs)
    expect(cta.label.length).toBe(20)
  })

  it('falls back to a default caption and the page cta_label when the LLM throws', async () => {
    completeMock.mockRejectedValueOnce(new Error('boom'))
    const cta = await generateActionPageCta(baseArgs)
    expect(cta).toEqual({ caption: 'Tap below to continue 👇', label: 'Open form' })
  })

  it('falls back when the LLM returns non-JSON', async () => {
    completeMock.mockResolvedValueOnce('totally not json')
    const cta = await generateActionPageCta(baseArgs)
    expect(cta).toEqual({ caption: 'Tap below to continue 👇', label: 'Open form' })
  })

  it('falls back to the cta_label when the parsed label is empty', async () => {
    completeMock.mockResolvedValueOnce(JSON.stringify({ caption: 'tap 👇', label: '   ' }))
    const cta = await generateActionPageCta(baseArgs)
    expect(cta.label).toBe('Open form')
    expect(cta.caption).toBe('tap 👇')
  })

  it('falls back to the default caption when the parsed caption is empty', async () => {
    completeMock.mockResolvedValueOnce(JSON.stringify({ caption: '', label: 'Book na' }))
    const cta = await generateActionPageCta(baseArgs)
    expect(cta.caption).toBe('Tap below to continue 👇')
    expect(cta.label).toBe('Book na')
  })

  it('passes the page context (title, instructions, personality) into the prompt', async () => {
    completeMock.mockResolvedValueOnce(JSON.stringify({ caption: 'tap 👇', label: 'Go now' }))
    await generateActionPageCta(baseArgs)
    const messages = completeMock.mock.calls[0][0] as Array<{ role: string; content: string }>
    const joined = messages.map((m) => m.content).join('\n')
    expect(joined).toContain('Lead Gen Form')
    expect(joined).toContain('warm Taglish')
    expect(joined).toMatch(/2.?3 words/i)
  })

  it('instructs the model to guide the customer through what to do (tap button below, then fill the form)', () => {
    const prompt = buildCtaSystemPromptForTest(baseArgs)
    // Caption should now walk the customer through the next steps, not just sell.
    expect(prompt).toMatch(/below|sa baba/i)
    expect(prompt).toMatch(/fill\s*(out|up|in)?\s*.*form/i)
    expect(prompt).toMatch(/guide|walk|step|what to do|tell them/i)
  })

  it('falls back when the LLM call exceeds the timeout', async () => {
    completeMock.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve('late'), 50)),
    )
    const cta = await generateActionPageCta({ ...baseArgs, timeoutMs: 5 })
    expect(cta).toEqual({ caption: 'Tap below to continue 👇', label: 'Open form' })
  })
})
