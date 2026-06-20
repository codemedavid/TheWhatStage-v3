import { describe, it, expect } from 'vitest'
import { parseMatchedSignals, fetchLeadsTotal, buildLeadSearchOr } from './queries'
import { LeadsQuery } from './schemas'

// Minimal chainable stand-in for a PostgREST count query. Records every filter
// call so we can assert which column/bounds the date window is applied to.
function makeCountClient() {
  const calls = {
    gte: [] as unknown[][],
    lte: [] as unknown[][],
    eq: [] as unknown[][],
    or: [] as unknown[][],
  }
  const builder: Record<string, unknown> = {}
  const chain = (key: keyof typeof calls) => (...args: unknown[]) => {
    calls[key].push(args)
    return builder
  }
  builder.select = () => builder
  builder.eq = chain('eq')
  builder.or = chain('or')
  builder.gte = chain('gte')
  builder.lte = chain('lte')
  builder.not = () => builder
  // Awaited at the end of fetchLeadsTotal: resolves to a PostgREST count shape.
  builder.then = (resolve: (v: { count: number; error: null }) => unknown) =>
    resolve({ count: 0, error: null })
  const client = { from: () => builder } as never
  return { client, calls }
}

describe('fetchLeadsTotal date window', () => {
  it('filters by last_activity_at using Manila day bounds (UTC instants)', async () => {
    const { client, calls } = makeCountClient()
    const params = LeadsQuery.parse({ range: 'custom', from: '2026-06-20', to: '2026-06-20' })

    await fetchLeadsTotal(client, 'user-1', params)

    expect(calls.gte).toContainEqual(['last_activity_at', '2026-06-19T16:00:00.000Z'])
    expect(calls.lte).toContainEqual(['last_activity_at', '2026-06-20T15:59:59.999Z'])
    // Must not fall back to the created_at-only window.
    expect(calls.gte.some(([col]) => col === 'created_at')).toBe(false)
  })
})

describe('buildLeadSearchOr', () => {
  it('wraps a plain term in quoted ilike patterns across all columns', () => {
    expect(buildLeadSearchOr('acme')).toBe(
      'name.ilike."%acme%",email.ilike."%acme%",phone.ilike."%acme%",company.ilike."%acme%"',
    )
  })

  it('keeps a comma inside the quoted value so PostgREST does not read it as a separator', () => {
    // A raw comma would split the .or() into bogus extra conditions and throw.
    const or = buildLeadSearchOr('smith, john')
    expect(or).toContain('name.ilike."%smith, john%"')
    // Exactly the four intended conditions, not six.
    expect(or.split('.ilike.').length - 1).toBe(4)
  })

  it('escapes embedded double quotes and backslashes', () => {
    expect(buildLeadSearchOr('a"b\\c')).toBe(
      'name.ilike."%a\\"b\\\\c%",email.ilike."%a\\"b\\\\c%",phone.ilike."%a\\"b\\\\c%",company.ilike."%a\\"b\\\\c%"',
    )
  })

  it('tolerates parentheses without breaking the filter grouping', () => {
    expect(buildLeadSearchOr('(test)')).toContain('name.ilike."%(test)%"')
  })
})

describe('parseMatchedSignals', () => {
  it('returns empty matched array on null reason', () => {
    expect(parseMatchedSignals(null)).toEqual({ matched: [], freeReason: '' })
  })
  it('returns matched array when reason follows the "matched: X, Y — Z" pattern', () => {
    expect(parseMatchedSignals('matched: asked price, asked schedule — lead asked magkano')).toEqual({
      matched: ['asked price', 'asked schedule'],
      freeReason: 'lead asked magkano',
    })
  })
  it('returns empty matched and original reason as freeReason for non-matching format', () => {
    expect(parseMatchedSignals('just some free text')).toEqual({
      matched: [],
      freeReason: 'just some free text',
    })
  })
})
