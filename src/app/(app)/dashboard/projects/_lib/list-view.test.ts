import { describe, it, expect } from 'vitest'
import { formatListDate, deriveProjectPriority } from './list-view'
import type { ProjectCardRow } from './queries'

function card(over: Partial<ProjectCardRow>): ProjectCardRow {
  return {
    id: 'p', user_id: 'u', workspace_id: 'w', lead_id: 'l', origin_submission_id: null,
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

describe('formatListDate', () => {
  it('formats a valid ISO date as a short month/day/year', () => {
    // 'Jun 8, 2025' style — assert the parts so the test is locale-tolerant.
    const out = formatListDate('2025-06-08T00:00:00.000Z')
    expect(out).toContain('2025')
    expect(out).toMatch(/Jun/i)
    expect(out).toContain('8')
  })

  it('returns an em dash for an empty value', () => {
    expect(formatListDate('')).toBe('—')
  })

  it('returns an em dash for an unparseable value', () => {
    expect(formatListDate('not-a-date')).toBe('—')
  })
})

describe('deriveProjectPriority', () => {
  it('reports Won for a won-stage project regardless of value', () => {
    const out = deriveProjectPriority(card({ stage_kind: 'won', value: 0 }))
    expect(out).toEqual({ label: 'Won', tone: 'won' })
  })

  it('reports Lost for a lost-stage project regardless of value', () => {
    const out = deriveProjectPriority(card({ stage_kind: 'lost', value: 999999 }))
    expect(out).toEqual({ label: 'Lost', tone: 'lost' })
  })

  it('reports High for an open project at or above the high-value threshold', () => {
    const out = deriveProjectPriority(card({ stage_kind: 'open', value: 50_000 }))
    expect(out).toEqual({ label: 'High', tone: 'high' })
  })

  it('reports Medium for an open project in the medium band', () => {
    const out = deriveProjectPriority(card({ stage_kind: 'open', value: 10_000 }))
    expect(out).toEqual({ label: 'Medium', tone: 'medium' })
  })

  it('reports Low for a small open project', () => {
    const out = deriveProjectPriority(card({ stage_kind: 'open', value: 100 }))
    expect(out).toEqual({ label: 'Low', tone: 'low' })
  })

  it('treats a missing value as Low', () => {
    const out = deriveProjectPriority(card({ stage_kind: 'open', value: null }))
    expect(out).toEqual({ label: 'Low', tone: 'low' })
  })

  it('treats a missing stage kind as an open project', () => {
    const out = deriveProjectPriority(card({ stage_kind: null, value: 50_000 }))
    expect(out).toEqual({ label: 'High', tone: 'high' })
  })
})
