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
})
