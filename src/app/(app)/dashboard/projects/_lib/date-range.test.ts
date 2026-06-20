import { describe, it, expect } from 'vitest'
import { resolveProjectsDateRange } from './date-range'
import { ProjectsQuery } from './schemas'

// A fixed "now": Wednesday, 2026-06-17 14:30 local time.
const NOW = new Date(2026, 5, 17, 14, 30)

function query(overrides: Partial<ProjectsQuery> = {}): ProjectsQuery {
  return ProjectsQuery.parse(overrides)
}

describe('resolveProjectsDateRange', () => {
  it('defaults to all (no bounds) for the projects board', () => {
    const out = resolveProjectsDateRange(query(), NOW)
    expect(out.from).toBeUndefined()
    expect(out.to).toBeUndefined()
  })

  it('today sets both bounds to the current day', () => {
    const out = resolveProjectsDateRange(query({ range: 'today' }), NOW)
    expect(out.from).toBe('2026-06-17')
    expect(out.to).toBe('2026-06-17')
  })

  it('week spans Monday of the current week through today', () => {
    const out = resolveProjectsDateRange(query({ range: 'week' }), NOW)
    expect(out.from).toBe('2026-06-15') // Monday
    expect(out.to).toBe('2026-06-17')
  })

  it('month spans the 1st through today', () => {
    const out = resolveProjectsDateRange(query({ range: 'month' }), NOW)
    expect(out.from).toBe('2026-06-01')
    expect(out.to).toBe('2026-06-17')
  })

  it('all clears both bounds', () => {
    const out = resolveProjectsDateRange(
      query({ range: 'all', from: '2020-01-01', to: '2020-02-01' }),
      NOW,
    )
    expect(out.from).toBeUndefined()
    expect(out.to).toBeUndefined()
  })

  it('custom passes explicit bounds through unchanged', () => {
    const out = resolveProjectsDateRange(
      query({ range: 'custom', from: '2026-01-01', to: '2026-03-01' }),
      NOW,
    )
    expect(out.from).toBe('2026-01-01')
    expect(out.to).toBe('2026-03-01')
  })

  it('does not mutate the input params', () => {
    const input = query({ range: 'today' })
    resolveProjectsDateRange(input, NOW)
    expect(input.from).toBeUndefined()
    expect(input.to).toBeUndefined()
  })
})
