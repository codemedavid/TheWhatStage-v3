import { describe, expect, it } from 'vitest'
import { manilaNow, manilaNowBlock, manilaDateBlock, MANILA_TZ } from './manilaNow'

describe('manilaNow', () => {
  it('formats a known UTC date as Asia/Manila (UTC+08)', () => {
    // 2026-05-18T06:32:00Z -> 2026-05-18 14:32 Asia/Manila (Monday)
    const n = manilaNow(new Date('2026-05-18T06:32:00Z'))
    expect(n.iso).toBe('2026-05-18 14:32')
    expect(n.weekday).toBe('Monday')
    expect(n.dateLong).toBe('Monday, May 18, 2026')
    expect(n.utcIso).toBe('2026-05-18T06:32:00.000Z')
  })

  it('rolls into the next Manila day across UTC midnight', () => {
    // 2026-05-18T16:30:00Z -> 2026-05-19 00:30 Asia/Manila
    const n = manilaNow(new Date('2026-05-18T16:30:00Z'))
    expect(n.iso).toBe('2026-05-19 00:30')
    expect(n.weekday).toBe('Tuesday')
  })

  it('exports the timezone constant', () => {
    expect(MANILA_TZ).toBe('Asia/Manila')
  })
})

describe('manilaNowBlock', () => {
  it('returns a one-line system-prompt prefix with the formatted time', () => {
    const block = manilaNowBlock(new Date('2026-05-18T06:32:00Z'))
    expect(block).toBe(
      'Current time: Monday, May 18, 2026, 14:32 (Asia/Manila, UTC+08:00).',
    )
  })

  // Regression pin: the default (minute-resolution) block MUST be unchanged so
  // RAG_PROMPT_LAYOUT=legacy reproduces pre-change output byte-for-byte.
  it('keeps the full minute string at the default/minute resolution', () => {
    const block = manilaNowBlock(new Date('2026-05-18T06:32:00Z'), { resolution: 'minute' })
    expect(block).toBe(
      'Current time: Monday, May 18, 2026, 14:32 (Asia/Manila, UTC+08:00).',
    )
  })
})

describe('manilaDateBlock (cache-stable, date resolution)', () => {
  it('returns a DATE-resolution block with weekday + date and NO HH:MM time', () => {
    const block = manilaDateBlock(new Date('2026-05-18T06:32:00Z'))
    expect(block).toBe('Current date: Monday, May 18, 2026 (Asia/Manila, UTC+08:00).')
    // No minute-of-day time (the only "HH:MM" allowed is the +08:00 TZ offset).
    expect(block).not.toContain('14:32')
    expect(block).not.toMatch(/,\s*\d{1,2}:\d{2}\s*\(/) // not the ", HH:MM (" minute form
    expect(block).not.toContain('Current time:')
  })

  it('manilaNowBlock(d, { resolution: "date" }) matches manilaDateBlock(d)', () => {
    const d = new Date('2026-05-18T06:32:00Z')
    expect(manilaNowBlock(d, { resolution: 'date' })).toBe(manilaDateBlock(d))
  })

  it('is cache-stable intra-day: two times in the same Manila day produce identical output', () => {
    // 2026-05-18 14:32 and 2026-05-18 23:59 Asia/Manila are the same Manila day.
    const morning = manilaDateBlock(new Date('2026-05-18T06:32:00Z')) // 14:32 Manila
    const evening = manilaDateBlock(new Date('2026-05-18T15:59:00Z')) // 23:59 Manila
    expect(morning).toBe(evening)
  })

  it('rotates once per Manila day: crossing UTC midnight into the next Manila day changes it', () => {
    // 2026-05-18T15:00Z -> 2026-05-18 23:00 Manila (still the 18th)
    // 2026-05-18T16:30Z -> 2026-05-19 00:30 Manila (now the 19th)
    const day18 = manilaDateBlock(new Date('2026-05-18T15:00:00Z'))
    const day19 = manilaDateBlock(new Date('2026-05-18T16:30:00Z'))
    expect(day18).toContain('May 18, 2026')
    expect(day19).toContain('May 19, 2026')
    expect(day18).not.toBe(day19)
  })
})
