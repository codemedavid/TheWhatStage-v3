import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/facebook/crypto', () => ({ decryptToken: (s: string) => `dec:${s}` }))

import { resolveAudience, pickStageIds, StageNotFoundError } from './resolveAudience'
import type { ParsedIntent } from './types'

const STAGES = [
  { id: 's-interested', name: 'Interested' },
  { id: 's-engaged', name: 'Engaged' },
  // Real data has users whose boards repeat a column name (two "Won" stages).
  { id: 's-won-a', name: 'Won' },
  { id: 's-won-b', name: 'won' },
]

function leadRow(i: number) {
  return {
    id: `lead-${String(i).padStart(5, '0')}`,
    name: `Lead ${i}`,
    custom_fields: {},
    user_id: 'u1',
    messenger_threads: {
      id: `thread-${i}`,
      psid: `psid-${i}`,
      last_inbound_at: null,
      page_id: 'page-1',
      facebook_pages: { id: 'page-1', page_access_token: 'enc' },
    },
  }
}

// Fake admin client: records the filters applied to `leads` and serves
// `.range()` slices out of `allLeads` so pagination can be asserted.
function makeAdmin(allLeads: ReturnType<typeof leadRow>[]) {
  const leadFilters: Array<Record<string, unknown>> = []
  const ranges: Array<[number, number]> = []
  const admin = {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      let range: [number, number] = [0, allLeads.length]
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => { filters[col] = val; return chain },
        in: (col: string, val: unknown) => { filters[`${col} in`] = val; return chain },
        gte: (col: string, val: unknown) => { filters[`${col}>=`] = val; return chain },
        order: () => chain,
        range: (from: number, to: number) => { range = [from, to]; return chain },
        then: (resolve: (v: unknown) => void) => {
          if (table === 'pipeline_stages') return resolve({ data: STAGES, error: null })
          leadFilters.push({ ...filters })
          ranges.push(range)
          const page = allLeads.slice(range[0], range[1] + 1)
          return resolve({ data: page, error: null })
        },
      }
      return chain
    },
  }
  return { admin: admin as never, leadFilters, ranges }
}

function intent(stage: string | null, days: number | null = null): ParsedIntent {
  return {
    audience: { stage_name: stage, last_active_within_days: days },
    instruction: 'hi',
    tone: 'friendly',
    ambiguities: [],
  }
}

describe('resolveAudience', () => {
  it('returns every lead across multiple PostgREST pages (no 200 cap)', async () => {
    // Arrange: 2,350 leads => 3 pages of 1000.
    const leads = Array.from({ length: 2350 }, (_, i) => leadRow(i))
    const { admin, ranges } = makeAdmin(leads)

    // Act
    const audience = await resolveAudience(admin, 'u1', intent(null))

    // Assert
    expect(audience).toHaveLength(2350)
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
    expect(audience[0]).toMatchObject({
      id: 'lead-00000',
      thread_id: 'thread-0',
      page_access_token: 'dec:enc',
    })
  })

  it('does not filter by stage when stage_name is null (send to everyone)', async () => {
    const { admin, leadFilters } = makeAdmin([leadRow(1)])
    await resolveAudience(admin, 'u1', intent(null))
    expect(leadFilters[0]).toEqual({ user_id: 'u1' })
  })

  it('filters by the matched stage id when a stage is named', async () => {
    const { admin, leadFilters } = makeAdmin([leadRow(1)])
    await resolveAudience(admin, 'u1', intent('interested'))
    expect(leadFilters[0]).toEqual({ user_id: 'u1', 'stage_id in': ['s-interested'] })
  })

  it('covers EVERY stage sharing the named stage name (duplicate stage names)', async () => {
    // Arrange: this user has two boards that both have a "Won" column. A
    // campaign aimed at "Won" must reach the leads sitting in both of them.
    const { admin, leadFilters } = makeAdmin([leadRow(1)])

    // Act
    await resolveAudience(admin, 'u1', intent('Won'))

    // Assert
    expect(leadFilters[0]['stage_id in']).toEqual(['s-won-a', 's-won-b'])
  })

  it('throws instead of widening to everyone when the stage does not exist', async () => {
    const { admin, leadFilters } = makeAdmin([leadRow(1)])
    await expect(resolveAudience(admin, 'u1', intent('Nonexistent'))).rejects.toBeInstanceOf(
      StageNotFoundError,
    )
    expect(leadFilters).toHaveLength(0)
  })

  it('applies the last-active cutoff on the thread join', async () => {
    const { admin, leadFilters } = makeAdmin([leadRow(1)])
    await resolveAudience(admin, 'u1', intent(null, 3))
    expect(Object.keys(leadFilters[0])).toContain('messenger_threads.last_inbound_at>=')
  })
})

describe('pickStageIds', () => {
  it('prefers exact, then prefix, then substring matches', () => {
    expect(pickStageIds(STAGES, 'ENGAGED')).toEqual(['s-engaged'])
    expect(pickStageIds(STAGES, 'inter')).toEqual(['s-interested'])
    expect(pickStageIds(STAGES, 'gag')).toEqual(['s-engaged'])
    expect(pickStageIds(STAGES, 'zzz')).toEqual([])
    expect(pickStageIds(STAGES, '   ')).toEqual([])
  })

  it('returns every stage that matches the name, case-insensitively', () => {
    expect(pickStageIds(STAGES, 'Won')).toEqual(['s-won-a', 's-won-b'])
  })

  it('does not mix tiers: an exact match suppresses looser matches', () => {
    const stages = [
      { id: 'exact', name: 'Won' },
      { id: 'loose', name: 'Won Back' },
    ]
    expect(pickStageIds(stages, 'Won')).toEqual(['exact'])
  })

  it('returns all loose matches when no stage matches exactly', () => {
    const stages = [
      { id: 'a', name: 'Won Back' },
      { id: 'b', name: 'Won Deal' },
    ]
    expect(pickStageIds(stages, 'Won')).toEqual(['a', 'b'])
  })
})
