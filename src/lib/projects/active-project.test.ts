import { describe, it, expect } from 'vitest'
import { pickActiveProject, renderProjectContextBlock, type ProjectForResolution } from './active-project'
import type { ActiveProjectContext } from './types'

function project(p: Partial<ProjectForResolution> & { id: string; updated_at: string }): ProjectForResolution {
  return {
    title: p.title ?? `Project ${p.id}`,
    value: p.value ?? null,
    currency: p.currency ?? 'PHP',
    ai_instructions: p.ai_instructions ?? null,
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
})
