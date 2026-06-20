import { describe, it, expect } from 'vitest'
import { stageInstructionParts, type ActionPageBrief } from './classify'

const page: ActionPageBrief = {
  id: 'ap_1',
  title: 'Booking',
  cta_label: 'Book now',
  bot_send_instructions: 'Send when the customer wants to book a call.',
}

describe('stageInstructionParts — in-active-project action-page guard', () => {
  it('adds the in-progress-deal guard to the volatile tail when inActiveProject is true', () => {
    const parts = stageInstructionParts([], null, [page], null, null, false, true)
    expect(parts.volatileTail).toContain('IN-PROGRESS DEAL')
    expect(parts.volatileTail.toLowerCase()).toContain('do not re-send')
    expect(parts.volatileTail.toLowerCase()).toContain('genuinely new')
  })

  it('keeps the guard out of the cacheable static prefix (lead-specific, must stay volatile)', () => {
    const parts = stageInstructionParts([], null, [page], null, null, false, true)
    expect(parts.staticPrefix).not.toContain('IN-PROGRESS DEAL')
  })

  it('omits the guard entirely when inActiveProject is false', () => {
    const parts = stageInstructionParts([], null, [page], null, null, false, false)
    expect(parts.volatileTail).not.toContain('IN-PROGRESS DEAL')
    expect(parts.staticPrefix).not.toContain('IN-PROGRESS DEAL')
  })

  it('defaults to no guard when the flag is omitted (back-compat)', () => {
    const parts = stageInstructionParts([], null, [page], null, null, false)
    expect(parts.volatileTail).not.toContain('IN-PROGRESS DEAL')
  })

  it('does not add the guard when there are no action pages even if in a project', () => {
    const parts = stageInstructionParts([], null, [], null, null, false, true)
    expect(parts.volatileTail).not.toContain('IN-PROGRESS DEAL')
  })
})
