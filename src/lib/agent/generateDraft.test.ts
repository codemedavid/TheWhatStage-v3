import { describe, expect, it, vi } from 'vitest'
import { generateDraft } from './generateDraft'
import type { AudienceLead, BulkContext, ParsedIntent } from './types'

function lead(overrides: Partial<AudienceLead> = {}): AudienceLead {
  return {
    id: 'lead-1',
    name: 'Juan Dela Cruz',
    custom_fields: {},
    user_id: 'u1',
    thread_id: 'thread-1',
    psid: 'psid-1',
    last_inbound_at: null,
    page_id: 'page-1',
    page_access_token: 'tok',
    ...overrides,
  }
}

function ctx(): BulkContext {
  return {
    lastInboundByThread: new Map(),
    optinByThread: new Map(),
    otnByThread: new Map(),
    cooldownThreadIds: new Set(),
    dailyCapUsed: 0,
    projectInstructionsByLead: new Map(),
  }
}

function intent(instruction: string): ParsedIntent {
  return {
    audience: { stage_name: null, last_active_within_days: null },
    instruction,
    tone: 'friendly',
    ambiguities: [],
  }
}

// Stub LLM: records the prompts it was handed and returns a canned completion.
function stubLlm(reply: string) {
  const calls: Array<{ system: string; user: string }> = []
  const llm = {
    complete: vi.fn(async (messages: Array<{ role: string; content: string }>) => {
      calls.push({
        system: messages.find((m) => m.role === 'system')?.content ?? '',
        user: messages.find((m) => m.role === 'user')?.content ?? '',
      })
      return reply
    }),
  }
  return { llm: llm as never, calls }
}

describe('generateDraft — personalization tags', () => {
  it('resolves tags in the instruction before the model sees them', async () => {
    // Arrange
    const { llm, calls } = stubLlm('Hello!')

    // Act
    await generateDraft(lead(), intent('Greet [first_name] about the new offer'), ctx(), llm)

    // Assert
    expect(calls[0].user).toContain('Greet Juan about the new offer')
    expect(calls[0].user).not.toContain('[first_name]')
  })

  it('resolves a tag the model echoed into its draft', async () => {
    const { llm } = stubLlm('Hi [first_name], following up!')
    const draft = await generateDraft(lead(), intent('follow up'), ctx(), llm)
    expect(draft).toBe('Hi Juan, following up!')
  })

  it('substitutes the full name for [name]', async () => {
    const { llm } = stubLlm('Hi [name]!')
    const draft = await generateDraft(lead(), intent('greet'), ctx(), llm)
    expect(draft).toBe('Hi Juan Dela Cruz!')
  })

  it('never ships a literal tag for a nameless lead', async () => {
    const { llm } = stubLlm('Hi [first_name]!')
    const draft = await generateDraft(lead({ name: null }), intent('greet'), ctx(), llm)
    expect(draft).toBe('Hi there!')
  })

  it('leaves a draft with no tags untouched', async () => {
    const { llm } = stubLlm('Just checking in on your order.')
    const draft = await generateDraft(lead(), intent('check in'), ctx(), llm)
    expect(draft).toBe('Just checking in on your order.')
  })

  it('falls back to a personalized template when the model fails', async () => {
    const llm = { complete: vi.fn(async () => { throw new Error('provider down') }) }
    const draft = await generateDraft(lead(), intent('check in'), ctx(), llm as never)
    expect(draft).toContain('Juan')
    expect(draft).not.toContain('[')
  })
})
