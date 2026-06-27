import { describe, expect, it } from 'vitest'
import { AnalyticsQuery } from './schemas'

describe('AnalyticsQuery', () => {
  it('defaults range to this week when absent', () => {
    expect(AnalyticsQuery.parse({}).range).toBe('week')
  })

  it('falls back to week on an invalid range', () => {
    expect(AnalyticsQuery.parse({ range: 'bogus' }).range).toBe('week')
  })

  it('preserves an explicit valid range', () => {
    expect(AnalyticsQuery.parse({ range: 'all' }).range).toBe('all')
    expect(AnalyticsQuery.parse({ range: 'today' }).range).toBe('today')
  })

  it('preserves a valid workspace uuid', () => {
    const ws = '550e8400-e29b-41d4-a716-446655440000'
    expect(AnalyticsQuery.parse({ workspace: ws }).workspace).toBe(ws)
  })

  it('drops a non-uuid workspace value instead of throwing', () => {
    expect(AnalyticsQuery.parse({ workspace: 'not-a-uuid' }).workspace).toBeUndefined()
  })

  it('leaves workspace undefined when absent', () => {
    expect(AnalyticsQuery.parse({}).workspace).toBeUndefined()
  })
})
