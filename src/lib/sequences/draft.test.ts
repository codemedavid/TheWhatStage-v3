// Spec for draftSequenceBatch: draft the WHOLE sequence in ONE LLM call and
// parse it into per-position messages. Parsing must be robust — a small model
// may wrap JSON in markdown fences, return a partial array, or emit garbage. A
// bad/partial parse must degrade gracefully (omit missing positions) so the
// worker falls back per step rather than dropping a touch.

import { describe, expect, it, vi, beforeEach } from 'vitest'

const { completeMock } = vi.hoisted(() => ({ completeMock: vi.fn() }))

vi.mock('@/lib/rag/llm', () => ({
  HfRouterLlm: class {
    complete = completeMock
  },
}))

import { draftSequenceBatch } from './draft'

const baseArgs = {
  leadName: 'Ana',
  persona: 'Friendly closer',
  instructions: null,
  doRules: [],
  dontRules: [],
  knowledge: null,
  contextTitle: 'Ana’s Jingle',
  aiInstructions: 'Waiting on GCash payment.',
  stageInstructions: 'Be gentle.',
  stageDoRules: [],
  stageDontRules: [],
  recentMessages: [],
  steps: [
    { position: 0, delayMinutes: 5, instruction: 'Check in.' },
    { position: 1, delayMinutes: 1440, instruction: 'Share value.' },
    { position: 2, delayMinutes: 4320, instruction: 'Final nudge.' },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('draftSequenceBatch', () => {
  it('parses a clean JSON array into per-position messages', async () => {
    completeMock.mockResolvedValue(
      JSON.stringify([
        { step: 0, message: 'Hi Ana, just checking in!' },
        { step: 1, message: 'Here is the value…' },
        { step: 2, message: 'Last nudge — ready?' },
      ]),
    )

    const out = await draftSequenceBatch(baseArgs)

    expect(completeMock).toHaveBeenCalledTimes(1) // ONE call for the whole sequence
    expect(out).toEqual([
      { position: 0, text: 'Hi Ana, just checking in!' },
      { position: 1, text: 'Here is the value…' },
      { position: 2, text: 'Last nudge — ready?' },
    ])
  })

  it('strips markdown code fences before parsing', async () => {
    completeMock.mockResolvedValue('```json\n[{"step":0,"message":"Hello!"}]\n```')
    const out = await draftSequenceBatch(baseArgs)
    expect(out).toEqual([{ position: 0, text: 'Hello!' }])
  })

  it('returns a PARTIAL list when the model returns fewer items (missing positions omitted)', async () => {
    completeMock.mockResolvedValue(JSON.stringify([{ step: 0, message: 'Only the first.' }]))
    const out = await draftSequenceBatch(baseArgs)
    expect(out).toEqual([{ position: 0, text: 'Only the first.' }])
  })

  it('drops entries with empty/blank messages', async () => {
    completeMock.mockResolvedValue(
      JSON.stringify([
        { step: 0, message: '   ' },
        { step: 1, message: 'Kept.' },
      ]),
    )
    const out = await draftSequenceBatch(baseArgs)
    expect(out).toEqual([{ position: 1, text: 'Kept.' }])
  })

  it('returns [] on unparseable output (caller falls back per step)', async () => {
    completeMock.mockResolvedValue('I cannot do that, sorry.')
    const out = await draftSequenceBatch(baseArgs)
    expect(out).toEqual([])
  })

  it('returns [] when the LLM call throws', async () => {
    completeMock.mockRejectedValue(new Error('llm 500'))
    const out = await draftSequenceBatch(baseArgs)
    expect(out).toEqual([])
  })

  it('accepts the position/text key aliases too', async () => {
    completeMock.mockResolvedValue(JSON.stringify([{ position: 2, text: 'Aliased.' }]))
    const out = await draftSequenceBatch(baseArgs)
    expect(out).toEqual([{ position: 2, text: 'Aliased.' }])
  })
})
