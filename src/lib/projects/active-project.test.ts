import { describe, it, expect } from 'vitest'
import { pickActiveProject, renderProjectContextBlock, type ProjectForResolution } from './active-project'
import type { ActiveProjectContext } from './types'

function project(p: Partial<ProjectForResolution> & { id: string; updated_at: string }): ProjectForResolution {
  return {
    title: p.title ?? `Project ${p.id}`,
    value: p.value ?? null,
    currency: p.currency ?? 'PHP',
    ai_instructions: p.ai_instructions ?? null,
    stage_id: p.stage_id ?? null,
    stage: p.stage ?? { name: 'New', kind: 'open' },
    ...p,
  }
}

describe('pickActiveProject', () => {
  it('returns null when there are no projects', () => {
    expect(pickActiveProject([])).toBeNull()
  })

  it('picks the most-recently-updated open project', () => {
    const rows = [
      project({ id: 'a', updated_at: '2026-06-10T00:00:00Z' }),
      project({ id: 'b', updated_at: '2026-06-15T00:00:00Z' }),
      project({ id: 'c', updated_at: '2026-06-12T00:00:00Z' }),
    ]
    expect(pickActiveProject(rows)?.id).toBe('b')
  })

  it('skips won and lost projects even if they are newer', () => {
    const rows = [
      project({ id: 'won', updated_at: '2026-06-20T00:00:00Z', stage: { name: 'Won', kind: 'won' } }),
      project({ id: 'lost', updated_at: '2026-06-19T00:00:00Z', stage: { name: 'Lost', kind: 'lost' } }),
      project({ id: 'open', updated_at: '2026-06-10T00:00:00Z', stage: { name: 'Scoping', kind: 'open' } }),
    ]
    expect(pickActiveProject(rows)?.id).toBe('open')
  })

  it('treats a null stage kind as open', () => {
    const rows = [project({ id: 'x', updated_at: '2026-06-10T00:00:00Z', stage: { name: 'Custom', kind: null } })]
    expect(pickActiveProject(rows)?.id).toBe('x')
  })

  it('returns null when every project is terminal', () => {
    const rows = [
      project({ id: 'won', updated_at: '2026-06-20T00:00:00Z', stage: { name: 'Won', kind: 'won' } }),
      project({ id: 'lost', updated_at: '2026-06-19T00:00:00Z', stage: { name: 'Lost', kind: 'lost' } }),
    ]
    expect(pickActiveProject(rows)).toBeNull()
  })
})

describe('renderProjectContextBlock', () => {
  const base: ActiveProjectContext = {
    id: 'p1', title: 'Kitchen remodel', stage_name: 'Proposal', stage_kind: 'open',
    value: 50000, currency: 'PHP', ai_instructions: 'Emphasize the bundle discount.',
    stage_instructions: null, stage_do_rules: [], stage_dont_rules: [],
  }

  it('returns empty string for null context', () => {
    expect(renderProjectContextBlock(null)).toBe('')
  })

  it('includes title, stage, value, and instructions', () => {
    const block = renderProjectContextBlock(base)
    expect(block).toContain('Kitchen remodel')
    expect(block).toContain('Proposal')
    expect(block).toContain('PHP 50000')
    expect(block).toContain('Emphasize the bundle discount.')
  })

  it('omits the value line when value is null', () => {
    const block = renderProjectContextBlock({ ...base, value: null })
    expect(block).not.toContain('Deal value')
  })

  it('omits the instructions line when ai_instructions is blank', () => {
    const block = renderProjectContextBlock({ ...base, ai_instructions: '   ' })
    expect(block).not.toContain('follow strictly')
  })

  it('always emits the "not a new inquiry" guard when a project is active', () => {
    // Even with no per-stage rules, an active project must switch the AI out of
    // cold-lead mode: no re-introduction, no re-asking, no re-sending forms.
    const block = renderProjectContextBlock({
      ...base, ai_instructions: null, stage_instructions: null, stage_do_rules: [], stage_dont_rules: [],
    })
    expect(block).toContain('not a new inquiry')
    expect(block).toContain('do NOT re-ask')
    expect(block.toLowerCase()).toContain('action page')
  })

  it('injects per-stage instructions and do/dont rules as priority guidance', () => {
    const block = renderProjectContextBlock({
      ...base,
      stage_instructions: 'Push for a signed proposal this week.',
      stage_do_rules: ['Reference the agreed scope', 'Offer a clear next step'],
      stage_dont_rules: ['Do not reopen pricing', 'Do not sound desperate'],
    })
    expect(block).toContain('Push for a signed proposal this week.')
    expect(block).toContain('Reference the agreed scope')
    expect(block).toContain('Offer a clear next step')
    expect(block).toContain('Do not reopen pricing')
    expect(block).toContain('Do not sound desperate')
    // Stage rules must be framed as taking priority over the general rules.
    expect(block.toLowerCase()).toContain('priority')
  })

  it('omits stage rule sections when none are configured', () => {
    const block = renderProjectContextBlock(base)
    expect(block).not.toContain('At this stage, DO:')
    expect(block).not.toContain("At this stage, DON'T:")
  })

  it('drops blank stage rule entries', () => {
    const block = renderProjectContextBlock({
      ...base, stage_do_rules: ['  ', 'Keep it warm'], stage_dont_rules: ['   '],
    })
    expect(block).toContain('Keep it warm')
    expect(block).not.toContain("At this stage, DON'T:")
  })
})
