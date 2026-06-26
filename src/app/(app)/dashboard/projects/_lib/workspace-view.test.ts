import { describe, expect, test } from 'vitest'
import {
  filterAndSortWorkspaces,
  formatRelativeUpdated,
  workspaceAvatar,
} from './workspace-view'
import type { WorkspaceSummary } from './workspaces'

function ws(over: Partial<WorkspaceSummary> = {}): WorkspaceSummary {
  return {
    id: 'w1',
    name: 'Welcome',
    description: null,
    position: 0,
    is_default: false,
    color: null,
    updated_at: null,
    stageCount: 0,
    projectCount: 0,
    activeProjectCount: 0,
    openValue: 0,
    currency: 'PHP',
    ...over,
  }
}

describe('workspaceAvatar', () => {
  test('uses the brand accent for the default workspace', () => {
    const a = workspaceAvatar(ws({ is_default: true, name: 'Welcome' }))
    expect(a).toEqual({ initial: 'W', bg: '#E6F0E9', fg: '#2F7A53' })
  })

  test('derives an uppercase initial from the trimmed name', () => {
    expect(workspaceAvatar(ws({ name: '  acme leads' })).initial).toBe('A')
  })

  test('falls back to ? for an empty name', () => {
    expect(workspaceAvatar(ws({ name: '   ' })).initial).toBe('?')
  })

  test('is stable for the same id and varies the palette by id', () => {
    const a1 = workspaceAvatar(ws({ id: 'abc', is_default: false }))
    const a2 = workspaceAvatar(ws({ id: 'abc', is_default: false }))
    expect(a1).toEqual(a2)
    expect(AVATAR_HEXES).toContain(a1.bg)
  })
})

const AVATAR_HEXES = ['#FBEAE0', '#E5EBFA', '#F3E6F7', '#FBF0DC', '#E0F0F2', '#F7E6E6']

describe('formatRelativeUpdated', () => {
  const now = Date.parse('2026-06-26T12:00:00.000Z')
  const ago = (ms: number) => new Date(now - ms).toISOString()

  test('returns a placeholder when the timestamp is missing', () => {
    expect(formatRelativeUpdated(null, now)).toBe('No activity yet')
  })

  test('handles sub-minute, hours, yesterday, days and weeks', () => {
    expect(formatRelativeUpdated(ago(30_000), now)).toBe('Updated just now')
    expect(formatRelativeUpdated(ago(2 * 3_600_000), now)).toBe('Updated 2 hours ago')
    expect(formatRelativeUpdated(ago(26 * 3_600_000), now)).toBe('Updated yesterday')
    expect(formatRelativeUpdated(ago(3 * 86_400_000), now)).toBe('Updated 3 days ago')
    expect(formatRelativeUpdated(ago(8 * 86_400_000), now)).toBe('Updated last week')
    expect(formatRelativeUpdated(ago(21 * 86_400_000), now)).toBe('Updated 3 weeks ago')
  })

  test('singularizes the unit at exactly one', () => {
    expect(formatRelativeUpdated(ago(3_600_000), now)).toBe('Updated 1 hour ago')
  })
})

describe('filterAndSortWorkspaces', () => {
  const list = [
    ws({ id: 'a', name: 'Auto Care', openValue: 100, activeProjectCount: 5, updated_at: '2026-06-20T00:00:00Z' }),
    ws({ id: 'b', name: 'Real Estate', openValue: 300, activeProjectCount: 2, updated_at: '2026-06-25T00:00:00Z' }),
    ws({ id: 'c', name: 'Coaching', description: 'auto follow-up', openValue: 50, activeProjectCount: 9, updated_at: '2026-06-10T00:00:00Z' }),
  ]

  test('does not mutate the input array', () => {
    const copy = [...list]
    filterAndSortWorkspaces(list, '', 'name')
    expect(list).toEqual(copy)
  })

  test('filters by name or description, case-insensitively', () => {
    const r = filterAndSortWorkspaces(list, 'AUTO', 'name')
    expect(r.map((w) => w.id).sort()).toEqual(['a', 'c'])
  })

  test('sorts by name, value, projects and recency', () => {
    expect(filterAndSortWorkspaces(list, '', 'name').map((w) => w.id)).toEqual(['a', 'c', 'b'])
    expect(filterAndSortWorkspaces(list, '', 'value').map((w) => w.id)).toEqual(['b', 'a', 'c'])
    expect(filterAndSortWorkspaces(list, '', 'projects').map((w) => w.id)).toEqual(['c', 'a', 'b'])
    expect(filterAndSortWorkspaces(list, '', 'recent').map((w) => w.id)).toEqual(['b', 'a', 'c'])
  })
})
