// RED-first spec for the follow-up draft prompt assembler. This is the fix for
// two reported bugs:
//  1) Follow-ups ignored the chatbot's instructions / Do / Don't rules and the
//     knowledge base (only the bare persona was used).
//  2) One customer's specifics leaked into every lead's follow-up. The assembler
//     must label the per-PROJECT ai_instructions as the authoritative facts for
//     THIS customer and carry an explicit anti-leak grounding guard.

import { describe, expect, it } from 'vitest'
import { buildFollowupDraftPrompt, buildSequenceBatchPrompt } from './draftPrompt'

const base = {
  leadName: 'Ana',
  persona: 'You are an excited, friendly sales closer.',
  instructions: 'Always confirm the package before asking for payment.',
  doRules: ['Mirror the customer’s language', 'Keep it to 1-2 sentences'],
  dontRules: ['Never invent prices', 'Never re-ask an answered question'],
  knowledge: '[1] [faq]\nThe business package is P699 all-in.',
  contextTitle: 'Ana’s Jingle',
  aiInstructions: 'Draft is done; waiting for her GCash payment before sending the full song.',
  stepInstruction: 'Follow up on the pending payment for their song.',
  recentMessages: [
    { role: 'user' as const, content: 'How much po?' },
    { role: 'assistant' as const, content: 'P699 all-in po!' },
  ],
}

describe('buildFollowupDraftPrompt', () => {
  it('injects persona, free-form instructions, and Do/Don’t rules into the system prompt', () => {
    const { system } = buildFollowupDraftPrompt(base)
    expect(system).toContain('excited, friendly sales closer')
    expect(system).toContain('Always confirm the package before asking for payment.')
    expect(system).toContain('Mirror the customer’s language')
    expect(system).toContain('Keep it to 1-2 sentences')
    expect(system).toContain('Never invent prices')
    expect(system).toContain('Never re-ask an answered question')
  })

  it('injects the knowledge-base block', () => {
    const { system } = buildFollowupDraftPrompt(base)
    expect(system).toContain('The business package is P699 all-in.')
  })

  it('labels the per-project ai_instructions as the authoritative facts for THIS customer', () => {
    const { system } = buildFollowupDraftPrompt(base)
    expect(system).toContain('Ana') // the customer name
    expect(system).toContain('Ana’s Jingle') // the project title
    expect(system).toContain('Draft is done; waiting for her GCash payment before sending the full song.')
  })

  it('carries an anti-leak grounding guard (only THIS customer; no other customers/projects; no invented facts)', () => {
    const { system } = buildFollowupDraftPrompt(base)
    const lc = system.toLowerCase()
    expect(lc).toContain('only')
    expect(lc).toMatch(/this customer|this conversation/)
    expect(lc).toMatch(/other (customers|projects|leads)/)
    expect(lc).toMatch(/do not (invent|make up)|never (invent|make up)/)
  })

  it('puts the step instruction as the GOAL and includes the recent conversation in the user message', () => {
    const { user } = buildFollowupDraftPrompt(base)
    expect(user).toContain('Follow up on the pending payment for their song.')
    expect(user).toContain('How much po?')
    expect(user).toContain('P699 all-in po!')
  })

  it('does NOT fabricate a project when there are no per-project ai_instructions (only mentions the title generically)', () => {
    const { system } = buildFollowupDraftPrompt({
      ...base,
      aiInstructions: null,
      knowledge: null,
    })
    // No authoritative-facts section, but the title may still be named generically.
    expect(system).not.toContain('Draft is done; waiting for her GCash payment')
    expect(system).toContain('Ana’s Jingle')
    // Still grounded + guarded even with no project facts.
    expect(system.toLowerCase()).toMatch(/other (customers|projects|leads)/)
  })

  it('omits empty sections cleanly (no "undefined"/"null" leaks) when persona/rules/knowledge are blank', () => {
    const { system, user } = buildFollowupDraftPrompt({
      leadName: null,
      persona: null,
      instructions: null,
      doRules: [],
      dontRules: [],
      knowledge: null,
      contextTitle: null,
      aiInstructions: null,
      stepInstruction: 'Just check in.',
      recentMessages: [],
    })
    expect(system).not.toMatch(/undefined|null/)
    expect(user).not.toMatch(/undefined|null/)
    expect(user).toContain('Just check in.')
  })

  it('prepends an optional time/now block when provided', () => {
    const { system } = buildFollowupDraftPrompt({ ...base, nowBlock: 'CURRENT TIME: Manila 3pm' })
    expect(system.startsWith('CURRENT TIME: Manila 3pm')).toBe(true)
  })

  it('injects the per-stage instructions and per-stage Do/Don’t rules when present', () => {
    const { system } = buildFollowupDraftPrompt({
      ...base,
      stageInstructions: 'This is the negotiation stage — be assertive about closing the deal.',
      stageDoRules: ['Reference the agreed scope', 'Offer a clear next step'],
      stageDontRules: ['Don’t reopen pricing', 'Don’t sound desperate'],
    })
    expect(system).toContain('This is the negotiation stage — be assertive about closing the deal.')
    expect(system).toContain('Reference the agreed scope')
    expect(system).toContain('Offer a clear next step')
    expect(system).toContain('Don’t reopen pricing')
    expect(system).toContain('Don’t sound desperate')
  })

  it('omits the stage sections cleanly when stage config is empty', () => {
    const { system } = buildFollowupDraftPrompt({
      ...base,
      stageInstructions: null,
      stageDoRules: [],
      stageDontRules: [],
    })
    expect(system).not.toMatch(/undefined|null/)
    // Stage section header must not appear with no stage data.
    expect(system).not.toContain('this stage')
  })
})

const batchBase = {
  ...base,
  stageInstructions: 'Discovery stage — be curious, surface their real goal before pitching.',
  stageDoRules: ['Ask one open question'],
  stageDontRules: ['Don’t quote a price yet'],
  steps: [
    { position: 0, delayMinutes: 5, instruction: 'Warmly check in and confirm interest.' },
    { position: 1, delayMinutes: 1440, instruction: 'Share the value and ask about their timeline.' },
    { position: 2, delayMinutes: 4320, instruction: 'Final nudge — make it easy to say yes.' },
  ],
}

describe('buildSequenceBatchPrompt', () => {
  it('carries the same brain: persona, instructions, global + stage Do/Don’t, project facts, knowledge', () => {
    const { system } = buildSequenceBatchPrompt(batchBase)
    expect(system).toContain('excited, friendly sales closer')
    expect(system).toContain('Always confirm the package before asking for payment.')
    expect(system).toContain('Mirror the customer’s language')
    expect(system).toContain('Never invent prices')
    expect(system).toContain('Discovery stage — be curious, surface their real goal before pitching.')
    expect(system).toContain('Ask one open question')
    expect(system).toContain('Don’t quote a price yet')
    expect(system).toContain('The business package is P699 all-in.')
    expect(system).toContain('Draft is done; waiting for her GCash payment before sending the full song.')
  })

  it('keeps the anti-leak grounding guard', () => {
    const { system } = buildSequenceBatchPrompt(batchBase)
    const lc = system.toLowerCase()
    expect(lc).toMatch(/this customer|this conversation/)
    expect(lc).toMatch(/other (customers|projects|leads)/)
    expect(lc).toMatch(/do not (invent|make up)|never (invent|make up)/)
  })

  it('asks for a strict JSON array with one message per step', () => {
    const { system } = buildSequenceBatchPrompt(batchBase)
    const lc = system.toLowerCase()
    expect(lc).toContain('json')
    expect(lc).toContain('array')
    // The count of steps must be communicated.
    expect(system).toContain('3')
  })

  it('lists every step (position + goal) in the user message', () => {
    const { user } = buildSequenceBatchPrompt(batchBase)
    expect(user).toContain('Warmly check in and confirm interest.')
    expect(user).toContain('Share the value and ask about their timeline.')
    expect(user).toContain('Final nudge — make it easy to say yes.')
    // Includes the recent conversation context.
    expect(user).toContain('How much po?')
  })

  it('omits empty sections cleanly with sparse config', () => {
    const { system, user } = buildSequenceBatchPrompt({
      leadName: null,
      persona: null,
      instructions: null,
      doRules: [],
      dontRules: [],
      knowledge: null,
      contextTitle: null,
      aiInstructions: null,
      stageInstructions: null,
      stageDoRules: [],
      stageDontRules: [],
      recentMessages: [],
      steps: [{ position: 0, delayMinutes: 0, instruction: 'Just check in.' }],
    })
    expect(system).not.toMatch(/undefined|null/)
    expect(user).not.toMatch(/undefined|null/)
    expect(user).toContain('Just check in.')
  })
})
