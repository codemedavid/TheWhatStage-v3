import { describe, it, expect } from 'vitest'
import { buildPrompt } from './prompt-builder'
import type { GradedBuckets } from './grader'
import type { RetrievedChunk } from './retriever'

const emptyBuckets = (): GradedBuckets<RetrievedChunk> => ({
  useful: [],
  ambiguous: [],
  reject: [],
})

const build = (config?: Parameters<typeof buildPrompt>[0]['config']) =>
  buildPrompt({ userQuery: 'q', buckets: emptyBuckets(), config }).system

// The exact original hardcoded reply-length rule (default = 2 sentences). Kept
// here so the default path is proven byte-identical to pre-change main.
const ORIGINAL_LENGTH_RULE =
  '- Every reply MUST be 1 to 2 short sentences. Two sentences is the absolute maximum, regardless of topic or how much info you have.'

describe('reply-length prompt section', () => {
  it('emits the original 1-to-2-sentence hard rule by default (no config)', () => {
    expect(build()).toContain(ORIGINAL_LENGTH_RULE)
  })

  it('parameterises the cap when a different max is configured', () => {
    const system = build({ replyLengthLimitEnabled: true, replyMaxSentences: 3 })
    expect(system).toContain('1 to 3 short sentences')
    expect(system).toContain('Three sentences is the absolute maximum')
    expect(system).not.toContain(ORIGINAL_LENGTH_RULE)
  })

  it('handles a cap of 1 with singular phrasing', () => {
    const system = build({ replyLengthLimitEnabled: true, replyMaxSentences: 1 })
    expect(system).toContain('Every reply MUST be 1 short sentence.')
    expect(system).toContain('One sentence is the absolute maximum')
  })

  it('drops the sentence cap when the length limit is disabled', () => {
    const system = build({ replyLengthLimitEnabled: false })
    expect(system).not.toContain('absolute maximum')
    // The one-question discipline survives even without a length cap.
    expect(system).toContain('Ask AT MOST one question per reply')
  })
})

describe('message-structure prompt section', () => {
  it('omits the structure section by default', () => {
    expect(build()).not.toContain('# Message structure')
  })

  it('adds the structure section when structured messages are enabled', () => {
    const system = build({ structuredMessagesEnabled: true })
    expect(system).toContain('# Message structure')
    // Each option on its own line is the core instruction.
    expect(system).toContain('its own new line')
  })

  it('adds an option-listing exception to the length rule when both are on', () => {
    const system = build({
      structuredMessagesEnabled: true,
      replyLengthLimitEnabled: true,
      replyMaxSentences: 2,
    })
    expect(system).toContain('# Message structure')
    expect(system).toContain('EXCEPTION')
  })
})
