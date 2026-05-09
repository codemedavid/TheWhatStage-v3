import { describe, expect, it, vi } from 'vitest'
import { loadFollowupContext, formatRelative } from './followup-context'

describe('formatRelative', () => {
  const now = new Date('2026-05-31T01:00:00Z').getTime()

  it('returns "in 24 hours" 24h before', () => {
    expect(formatRelative('2026-06-01T01:00:00Z', now)).toBe('in 24 hours')
  })
  it('returns "in 10 minutes"', () => {
    expect(formatRelative('2026-05-31T01:10:00Z', now)).toBe('in 10 minutes')
  })
  it('returns "now" within plus or minus 30s', () => {
    expect(formatRelative('2026-05-31T01:00:15Z', now)).toBe('now')
    expect(formatRelative('2026-05-31T00:59:45Z', now)).toBe('now')
  })
  it('returns past phrasing', () => {
    expect(formatRelative('2026-05-30T01:00:00Z', now)).toBe('1 day ago')
    expect(formatRelative('2026-05-31T00:50:00Z', now)).toBe('10 minutes ago')
  })
})

describe('loadFollowupContext', () => {
  function makeAdmin(rows: { booking?: unknown; property?: unknown }) {
    const from = vi.fn((table: string) => {
      if (table === 'booking_events') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: rows.booking ?? null, error: null })),
            })),
          })),
        }
      }
      if (table === 'action_pages') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: rows.property ?? null, error: null })),
            })),
          })),
        }
      }
      throw new Error(`unexpected table ${table}`)
    })
    return { from } as unknown as Parameters<typeof loadFollowupContext>[0]
  }

  it('returns booking only when no property id present', async () => {
    const admin = makeAdmin({
      booking: {
        event_at: '2026-06-01T01:00:00Z',
        timezone: 'Asia/Manila',
        title: null,
      },
    })
    const ctx = await loadFollowupContext(admin, {
      booking_event_id: 'be_1',
      now: new Date('2026-05-31T01:00:00Z').getTime(),
    })
    expect(ctx.booking).toEqual({
      event_at: '2026-06-01T01:00:00Z',
      event_at_relative: 'in 24 hours',
      title: '',
    })
    expect(ctx.property).toBeUndefined()
  })

  it('returns property when property id present and page is realestate', async () => {
    const admin = makeAdmin({
      booking: {
        event_at: '2026-06-01T01:00:00Z',
        timezone: 'UTC',
        title: 'Sunset Villa viewing',
      },
      property: {
        id: 'prop_1',
        kind: 'realestate',
        title: 'Sunset Villa',
        slug: 'sunset-villa',
        config: { address: '123 Coastal Rd', price: 'PHP 25M' },
      },
    })
    const ctx = await loadFollowupContext(admin, {
      booking_event_id: 'be_1',
      source_property_action_page_id: 'prop_1',
      now: new Date('2026-05-31T01:00:00Z').getTime(),
    })
    expect(ctx.booking?.title).toBe('Sunset Villa viewing')
    expect(ctx.property?.title).toBe('Sunset Villa')
    expect(ctx.property?.address).toBe('123 Coastal Rd')
    expect(ctx.property?.price).toBe('PHP 25M')
    expect(ctx.property?.deeplink_url).toContain('/a/sunset-villa')
  })

  it('returns no booking when booking_event_id missing', async () => {
    const admin = makeAdmin({})
    const ctx = await loadFollowupContext(admin, {
      now: Date.now(),
    })
    expect(ctx.booking).toBeUndefined()
    expect(ctx.property).toBeUndefined()
  })

  it('skips property when row is not realestate', async () => {
    const admin = makeAdmin({
      booking: { event_at: '2026-06-01T01:00:00Z', timezone: 'UTC', title: 't' },
      property: { id: 'p1', kind: 'form', title: 'x', slug: 's', config: {} },
    })
    const ctx = await loadFollowupContext(admin, {
      booking_event_id: 'be_1',
      source_property_action_page_id: 'p1',
      now: new Date('2026-05-31T01:00:00Z').getTime(),
    })
    expect(ctx.property).toBeUndefined()
  })
})
