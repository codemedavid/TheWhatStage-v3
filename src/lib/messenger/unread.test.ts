import { describe, expect, it } from 'vitest'
import { normalizeThreadCounts, formatBadgeCount, sumUnread } from './unread'

describe('normalizeThreadCounts', () => {
  it('returns zeroed counts when the thread join is null', () => {
    expect(normalizeThreadCounts(null)).toEqual({ unread_count: 0, missed_count: 0 })
  })

  it('reads counts from an object-shaped join', () => {
    expect(normalizeThreadCounts({ unread_count: 3, missed_count: 7 })).toEqual({
      unread_count: 3,
      missed_count: 7,
    })
  })

  it('reads counts from the first element of an array-shaped join', () => {
    expect(normalizeThreadCounts([{ unread_count: 2, missed_count: 5 }])).toEqual({
      unread_count: 2,
      missed_count: 5,
    })
  })

  it('treats null/undefined/negative column values as zero', () => {
    expect(normalizeThreadCounts({ unread_count: null, missed_count: undefined })).toEqual({
      unread_count: 0,
      missed_count: 0,
    })
    expect(normalizeThreadCounts({ unread_count: -4, missed_count: -1 })).toEqual({
      unread_count: 0,
      missed_count: 0,
    })
  })

  it('returns zeroed counts for an empty array join', () => {
    expect(normalizeThreadCounts([])).toEqual({ unread_count: 0, missed_count: 0 })
  })
})

describe('formatBadgeCount', () => {
  it('returns an empty string for zero or negative counts (no badge)', () => {
    expect(formatBadgeCount(0)).toBe('')
    expect(formatBadgeCount(-3)).toBe('')
  })

  it('renders a plain number under the cap', () => {
    expect(formatBadgeCount(1)).toBe('1')
    expect(formatBadgeCount(42)).toBe('42')
  })

  it('caps at the max with a plus suffix', () => {
    expect(formatBadgeCount(100)).toBe('99+')
    expect(formatBadgeCount(99)).toBe('99')
  })

  it('honours a custom max', () => {
    expect(formatBadgeCount(15, 9)).toBe('9+')
    expect(formatBadgeCount(9, 9)).toBe('9')
  })

  it('floors fractional counts and ignores non-finite input', () => {
    expect(formatBadgeCount(3.9)).toBe('3')
    expect(formatBadgeCount(Number.NaN)).toBe('')
  })
})

describe('sumUnread', () => {
  it('returns 0 for an empty list', () => {
    expect(sumUnread([])).toBe(0)
  })

  it('sums unread counts, treating missing/negative as zero', () => {
    expect(
      sumUnread([{ unread_count: 3 }, { unread_count: null }, { unread_count: -2 }, { unread_count: 4 }]),
    ).toBe(7)
  })
})
