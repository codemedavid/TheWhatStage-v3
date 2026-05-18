import { describe, expect, it } from 'vitest'
import { manilaNow, manilaNowBlock, MANILA_TZ } from './manilaNow'

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
})
