import { describe, it, expect } from 'vitest'
import {
  computeSlotsForDate,
  type BookingSlotsConfig,
} from './booking.slots'

function baseConfig(overrides: Partial<BookingSlotsConfig> = {}): BookingSlotsConfig {
  const days = Array.from({ length: 7 }, (_, i) => ({
    weekday: i as 0 | 1 | 2 | 3 | 4 | 5 | 6,
    enabled: false,
    windows: [],
  }))
  return {
    appointment: { duration_min: 30, buffer_min: 0, timezone: 'Asia/Manila' },
    availability: days,
    date_range: { from: null, to: null },
    slots_per_window: 1,
    ...overrides,
  }
}

const FAR_PAST_NOW = new Date('2000-01-01T00:00:00Z')

// 2026-04-30 is a Thursday (weekday = 4).
const THURSDAY = '2026-04-30'

describe('computeSlotsForDate', () => {
  it('returns no slots when the weekday is disabled', () => {
    const cfg = baseConfig()
    const slots = computeSlotsForDate({
      config: cfg,
      dateYmd: THURSDAY,
      taken: new Map(),
      now: FAR_PAST_NOW,
    })
    expect(slots).toEqual([])
  })

  it('emits the correct count for a single window honoring duration + buffer', () => {
    const cfg = baseConfig()
    cfg.availability[4] = {
      weekday: 4,
      enabled: true,
      windows: [{ start: '09:00', end: '11:00' }], // 120 minutes
    }
    cfg.appointment = { duration_min: 30, buffer_min: 15, timezone: 'Asia/Manila' }
    // step = 45m, slots fit at 09:00, 09:45, 10:30 (10:30+30=11:00 ✓) -> 3 slots.
    const slots = computeSlotsForDate({
      config: cfg,
      dateYmd: THURSDAY,
      taken: new Map(),
      now: FAR_PAST_NOW,
    })
    expect(slots).toHaveLength(3)
    // Asia/Manila is UTC+8 year-round, so 09:00 PHT == 01:00Z.
    expect(slots[0].start_iso).toBe('2026-04-30T01:00:00.000Z')
    expect(slots[0].end_iso).toBe('2026-04-30T01:30:00.000Z')
    expect(slots[1].start_iso).toBe('2026-04-30T01:45:00.000Z')
    expect(slots[2].start_iso).toBe('2026-04-30T02:30:00.000Z')
  })

  it('returns no slots when the date falls outside date_range', () => {
    const cfg = baseConfig({ date_range: { from: '2030-01-01', to: '2030-12-31' } })
    cfg.availability[4] = {
      weekday: 4,
      enabled: true,
      windows: [{ start: '09:00', end: '17:00' }],
    }
    const slots = computeSlotsForDate({
      config: cfg,
      dateYmd: THURSDAY,
      taken: new Map(),
      now: FAR_PAST_NOW,
    })
    expect(slots).toEqual([])
  })

  it('filters out slots that have already started at `now`', () => {
    const cfg = baseConfig()
    cfg.availability[4] = {
      weekday: 4,
      enabled: true,
      windows: [{ start: '09:00', end: '11:00' }],
    }
    // 09:00, 09:30, 10:00, 10:30 (4 slots) without filtering.
    // now = 2026-04-30T01:30:00Z == 09:30 PHT, so 09:00 + 09:30 are gone.
    const now = new Date('2026-04-30T01:30:00.000Z')
    const slots = computeSlotsForDate({
      config: cfg,
      dateYmd: THURSDAY,
      taken: new Map(),
      now,
    })
    expect(slots).toHaveLength(2)
    expect(slots[0].start_iso).toBe('2026-04-30T02:00:00.000Z')
  })

  it('subtracts taken count from capacity', () => {
    const cfg = baseConfig({ slots_per_window: 3 })
    cfg.availability[4] = {
      weekday: 4,
      enabled: true,
      windows: [{ start: '09:00', end: '10:00' }],
    }
    // step = 30m -> 09:00 + 09:30 (2 slots). Mark 09:00 PHT as taken twice.
    const taken = new Map<string, number>([['2026-04-30T01:00:00.000Z', 2]])
    const slots = computeSlotsForDate({
      config: cfg,
      dateYmd: THURSDAY,
      taken,
      now: FAR_PAST_NOW,
    })
    expect(slots).toHaveLength(2)
    expect(slots[0].capacity).toBe(3)
    expect(slots[0].taken).toBe(2)
    expect(slots[0].available).toBe(1)
    expect(slots[1].taken).toBe(0)
    expect(slots[1].available).toBe(3)
  })
})
