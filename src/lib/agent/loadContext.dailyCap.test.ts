import { describe, expect, it, vi } from 'vitest'
import { loadContext } from './loadContext'

// The daily send cap is the only thing standing between a mis-aimed campaign
// and thousands of real Messenger sends. These tests pin the two ways it used
// to fail OPEN: a campaign list silently truncated at PostgREST's max_rows,
// and a swallowed error on the count query that reset usage to zero.

interface Scenario {
  campaignCount: number
  // Fails the agent_campaign_messages count query, as an over-long `.in()`
  // filter or a transient database error would.
  countFails?: boolean
  sentCount?: number
}

function makeAdmin({ campaignCount, countFails = false, sentCount = 0 }: Scenario) {
  const campaignPageRanges: Array<[number, number]> = []
  const countChunkSizes: number[] = []
  const allCampaignIds = Array.from({ length: campaignCount }, (_, i) => ({ id: `c-${i}` }))

  const admin = {
    rpc: async () => ({ data: [], error: null }),
    from(table: string) {
      let range: [number, number] = [0, 999]
      let inIds: string[] = []
      let isCount = false

      const chain: Record<string, unknown> = {
        select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.count) isCount = true
          return chain
        },
        eq: () => chain,
        gte: () => chain,
        is: () => chain,
        or: () => chain,
        order: () => chain,
        in: (_col: string, ids: string[]) => { inIds = ids; return chain },
        range: (from: number, to: number) => { range = [from, to]; return chain },
        then: (resolve: (v: unknown) => void) => {
          if (table === 'agent_campaigns') {
            campaignPageRanges.push(range)
            return resolve({
              data: allCampaignIds.slice(range[0], range[1] + 1),
              error: null,
            })
          }
          if (table === 'agent_campaign_messages' && isCount) {
            countChunkSizes.push(inIds.length)
            if (countFails) {
              return resolve({ count: null, error: { message: 'URL too long' } })
            }
            return resolve({ count: sentCount, error: null })
          }
          return resolve({ data: [], error: null })
        },
      }
      return chain
    },
  }

  return { admin: admin as never, campaignPageRanges, countChunkSizes }
}

describe('loadContext — daily cap accounting', () => {
  it('pages past max_rows so a long campaign history is counted in full', async () => {
    // Arrange: 2,300 campaigns — more than one PostgREST page.
    const { admin, campaignPageRanges } = makeAdmin({ campaignCount: 2300 })

    // Act
    await loadContext(admin, 'u1', ['t1'])

    // Assert
    expect(campaignPageRanges.length).toBeGreaterThan(1)
    expect(campaignPageRanges[0]).toEqual([0, 999])
  })

  it('chunks the campaign id filter instead of sending one huge .in()', async () => {
    const { admin, countChunkSizes } = makeAdmin({ campaignCount: 2300 })
    await loadContext(admin, 'u1', ['t1'])
    expect(countChunkSizes.length).toBeGreaterThan(1)
    for (const size of countChunkSizes) {
      expect(size).toBeLessThanOrEqual(200)
    }
  })

  it('sums the per-chunk counts rather than keeping only the last', async () => {
    const { admin } = makeAdmin({ campaignCount: 400, sentCount: 10 })
    const ctx = await loadContext(admin, 'u1', ['t1'])
    // 400 ids over 200-id chunks = 2 chunks, 10 each.
    expect(ctx.dailyCapUsed).toBe(20)
  })

  it('fails CLOSED when the count query errors, instead of reporting zero usage', async () => {
    // Arrange: the count query fails. Reporting 0 here would hand the caller a
    // full daily budget and let a campaign blast straight past the cap.
    const { admin } = makeAdmin({ campaignCount: 10, countFails: true })

    // Act + Assert
    await expect(loadContext(admin, 'u1', ['t1'])).rejects.toThrow(/daily cap/i)
  })

  it('reports zero usage only when the user genuinely has no campaigns', async () => {
    const { admin } = makeAdmin({ campaignCount: 0 })
    const ctx = await loadContext(admin, 'u1', ['t1'])
    expect(ctx.dailyCapUsed).toBe(0)
  })
})
