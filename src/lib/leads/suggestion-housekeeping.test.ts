import { describe, it, expect } from 'vitest'
import { computeStaleSuggestionIds } from './suggestion-housekeeping'

describe('computeStaleSuggestionIds', () => {
  it('flags suggestions older than stage.updated_at', () => {
    const suggestions = [
      { id: 'S1', stage_id: 'stg', created_at: '2026-05-01T00:00:00Z' },
      { id: 'S2', stage_id: 'stg', created_at: '2026-05-10T00:00:00Z' },
    ]
    const stages = [{ id: 'stg', updated_at: '2026-05-05T00:00:00Z' }]
    expect(computeStaleSuggestionIds(suggestions, stages)).toEqual(['S1'])
  })

  it('keeps suggestions for stages with no updated_at change since creation', () => {
    const suggestions = [{ id: 'S1', stage_id: 'stg', created_at: '2026-05-10T00:00:00Z' }]
    const stages = [{ id: 'stg', updated_at: '2026-05-01T00:00:00Z' }]
    expect(computeStaleSuggestionIds(suggestions, stages)).toEqual([])
  })
})
