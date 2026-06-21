import { describe, it, expect } from 'vitest'
import { splitStageProjects } from './board-split'
import type { ProjectCardRow } from './queries'

function card(over: Partial<ProjectCardRow>): ProjectCardRow {
  return {
    id: 'p', user_id: 'u', lead_id: 'l', origin_submission_id: null,
    stage_id: 's', title: 't', description: null, value: null,
    currency: 'PHP', ai_instructions: null, notes: null, position: 0,
    archived_at: null, created_at: '2026-06-01', updated_at: '2026-06-01',
    lead_name: null, lead_email: null, lead_phone: null, lead_company: null,
    lead_picture_url: null, stage_name: null, stage_kind: 'open',
    origin_submission_kind: null, unread_count: 0, missed_count: 0,
    is_archived: false,
    ...over,
  }
}

describe('splitStageProjects', () => {
  it('hides archived cards by default', () => {
    const rows = [
      card({ id: 'a', is_archived: false }),
      card({ id: 'b', is_archived: true }),
    ]
    const { active, archived, archivedCount } = splitStageProjects(rows, false)
    expect(active.map((p) => p.id)).toEqual(['a'])
    expect(archived).toEqual([])
    expect(archivedCount).toBe(1)
  })

  it('reveals archived cards when showArchived is true', () => {
    const rows = [
      card({ id: 'a', is_archived: false }),
      card({ id: 'b', is_archived: true }),
    ]
    const { active, archived, archivedCount } = splitStageProjects(rows, true)
    expect(active.map((p) => p.id)).toEqual(['a'])
    expect(archived.map((p) => p.id)).toEqual(['b'])
    expect(archivedCount).toBe(1)
  })

  it('keeps active cards in their original order', () => {
    const rows = [
      card({ id: 'a', position: 0 }),
      card({ id: 'z', is_archived: true }),
      card({ id: 'b', position: 1 }),
    ]
    const { active } = splitStageProjects(rows, false)
    expect(active.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('reports zero archived when none are archived', () => {
    const rows = [card({ id: 'a' }), card({ id: 'b' })]
    const { archivedCount, archived } = splitStageProjects(rows, true)
    expect(archivedCount).toBe(0)
    expect(archived).toEqual([])
  })
})
