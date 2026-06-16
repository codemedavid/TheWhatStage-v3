import { describe, it, expect } from 'vitest'
import { stageInstructionParts } from './classify'

describe('stageInstructionParts — pause schema gating', () => {
  it('adds the pause schema field and AUTO-PAUSE block when hasPauseRules is true', () => {
    const parts = stageInstructionParts([], null, [], null, null, true)
    expect(parts.staticPrefix).toContain('"pause"')
    expect(parts.staticPrefix).toContain('AUTO-PAUSE')
  })

  it('omits the pause field entirely when hasPauseRules is false', () => {
    const parts = stageInstructionParts([], null, [], null, null, false)
    expect(parts.staticPrefix).not.toContain('"pause"')
    expect(parts.staticPrefix).not.toContain('AUTO-PAUSE')
  })

  it('defaults to no pause field when the flag is omitted (back-compat)', () => {
    const parts = stageInstructionParts([], null, [], null, null)
    expect(parts.staticPrefix).not.toContain('"pause"')
  })
})
