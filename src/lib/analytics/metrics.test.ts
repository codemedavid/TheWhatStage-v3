import { describe, expect, it } from 'vitest'
import {
  buildFunnel,
  conversionPct,
  daysInRange,
  formatPct,
  formatRatio,
  perDay,
  ratio,
  reachedFor,
  type FunnelInputRow,
} from './metrics'

describe('daysInRange', () => {
  it('counts inclusive calendar days', () => {
    expect(daysInRange('2026-06-01', '2026-06-30')).toBe(30)
    expect(daysInRange('2026-06-20', '2026-06-20')).toBe(1)
  })

  it('returns 0 for missing or inverted bounds', () => {
    expect(daysInRange(null, '2026-06-30')).toBe(0)
    expect(daysInRange('2026-06-30', undefined)).toBe(0)
    expect(daysInRange('2026-06-30', '2026-06-01')).toBe(0)
    expect(daysInRange('nope', '2026-06-01')).toBe(0)
  })
})

describe('perDay', () => {
  it('divides total by inclusive days', () => {
    expect(perDay(120, '2026-06-01', '2026-06-30')).toBe(4)
  })

  it('returns 0 when range is unknown (all-time)', () => {
    expect(perDay(120, null, null)).toBe(0)
  })
})

describe('ratio', () => {
  it('computes a per b', () => {
    expect(ratio(10, 4)).toBe(2.5)
  })

  it('guards divide-by-zero', () => {
    expect(ratio(10, 0)).toBe(0)
  })
})

describe('conversionPct', () => {
  it('computes a percentage', () => {
    expect(conversionPct(1, 4)).toBe(25)
    expect(conversionPct(2, 8)).toBe(25)
  })

  it('guards divide-by-zero', () => {
    expect(conversionPct(5, 0)).toBe(0)
  })
})

describe('formatRatio', () => {
  it('renders an N -> 1 label', () => {
    expect(formatRatio(42, 10)).toBe('4.2 → 1')
  })

  it('renders em dash when undefined', () => {
    expect(formatRatio(0, 10)).toBe('—')
    expect(formatRatio(10, 0)).toBe('—')
  })
})

describe('formatPct', () => {
  it('renders one decimal by default', () => {
    expect(formatPct(23.84)).toBe('23.8%')
    expect(formatPct(50, 0)).toBe('50%')
  })
})

describe('buildFunnel', () => {
  const rows: FunnelInputRow[] = [
    { stageId: 'c', name: 'Decision', kind: 'decision', rank: 2, reached: 10 },
    { stageId: 'a', name: 'New', kind: 'entry', rank: 0, reached: 100 },
    { stageId: 'b', name: 'Qualified', kind: 'qualifying', rank: 1, reached: 40 },
  ]

  it('sorts by rank and computes step + overall percentages', () => {
    const funnel = buildFunnel(rows)
    expect(funnel.map((s) => s.stageId)).toEqual(['a', 'b', 'c'])
    expect(funnel[0]).toMatchObject({ stepPct: 100, overallPct: 100 })
    expect(funnel[1]).toMatchObject({ stepPct: 40, overallPct: 40 })
    // 10 of 40 from previous = 25%; 10 of 100 overall = 10%
    expect(funnel[2]).toMatchObject({ stepPct: 25, overallPct: 10 })
  })

  it('handles an empty funnel', () => {
    expect(buildFunnel([])).toEqual([])
  })
})

describe('reachedFor', () => {
  const rows: FunnelInputRow[] = [
    { stageId: 'won', name: 'Won', kind: 'won', rank: 1, reached: 7 },
  ]

  it('finds a stage reached count', () => {
    expect(reachedFor(rows, 'won')).toBe(7)
  })

  it('returns 0 for an unknown stage', () => {
    expect(reachedFor(rows, 'missing')).toBe(0)
  })
})
