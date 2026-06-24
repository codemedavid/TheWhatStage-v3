import { describe, expect, it } from 'vitest'
import {
  buildFunnel,
  buildStageDistribution,
  computeDelta,
  conversionPct,
  crosstabLookup,
  daysInRange,
  formatDelta,
  formatPct,
  formatRatio,
  perDay,
  previousPeriod,
  ratio,
  reachedFor,
  stageKindGroup,
  toCsv,
  type CrosstabCell,
  type FunnelInputRow,
  type StageCount,
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

describe('buildStageDistribution', () => {
  // Mirrors the real "all-nurture" tenant board: each stage carries the count of
  // leads CURRENTLY sitting in it (what the kanban board shows), NOT a monotonic
  // "reached or beyond" total. Won is a mid-board column with only 26 occupants —
  // the old funnel inflated this to 286 by counting every later column as "beyond".
  const stages: StageCount[] = [
    { stageId: 'g', name: 'Lost', kind: 'nurture', position: 6, count: 48 },
    { stageId: 'a', name: 'New Lead', kind: 'nurture', position: 0, count: 187 },
    { stageId: 'f', name: 'Won', kind: 'nurture', position: 5, count: 26 },
  ]

  it('keeps each stage current count — no monotonic accumulation', () => {
    const d = buildStageDistribution(stages)
    expect(d.rows.find((r) => r.name === 'Won')?.count).toBe(26)
    expect(d.rows.find((r) => r.name === 'Lost')?.count).toBe(48)
    expect(d.total).toBe(187 + 26 + 48)
  })

  it('orders rows by board position regardless of input order', () => {
    const d = buildStageDistribution(stages)
    expect(d.rows.map((r) => r.position)).toEqual([0, 5, 6])
    expect(d.rows.map((r) => r.name)).toEqual(['New Lead', 'Won', 'Lost'])
  })

  it('computes share as percent of total cohort', () => {
    const d = buildStageDistribution(stages)
    expect(d.rows.find((r) => r.name === 'Won')?.share).toBeCloseTo((26 / 261) * 100, 4)
  })

  it('computes barPct relative to the largest stage', () => {
    const d = buildStageDistribution(stages)
    expect(d.rows.find((r) => r.name === 'New Lead')?.barPct).toBe(100)
    expect(d.rows.find((r) => r.name === 'Won')?.barPct).toBeCloseTo((26 / 187) * 100, 4)
  })

  it('handles empty input and a zero-count stage without dividing by zero', () => {
    expect(buildStageDistribution([])).toEqual({ rows: [], total: 0 })
    const zero = buildStageDistribution([
      { stageId: 'x', name: 'Empty', kind: 'nurture', position: 0, count: 0 },
    ])
    expect(zero.total).toBe(0)
    expect(zero.rows[0]).toMatchObject({ share: 0, barPct: 0 })
  })
})

describe('stageKindGroup', () => {
  it('maps the won terminal', () => {
    expect(stageKindGroup('won')).toBe('won')
  })

  it('maps off-ramp kinds to lost', () => {
    for (const k of ['lost', 'objection', 'dormant']) {
      expect(stageKindGroup(k)).toBe('lost')
    }
  })

  it('maps forward / uncurated kinds to active', () => {
    for (const k of ['entry', 'qualifying', 'nurture', 'decision', '', 'whatever']) {
      expect(stageKindGroup(k)).toBe('active')
    }
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

describe('previousPeriod', () => {
  it('returns the immediately-preceding range of equal length', () => {
    // June has 30 days; the prior 30-day window ends the day before `from`.
    expect(previousPeriod('2026-06-01', '2026-06-30')).toEqual({
      from: '2026-05-02',
      to: '2026-05-31',
    })
  })

  it('handles a single-day range', () => {
    expect(previousPeriod('2026-06-20', '2026-06-20')).toEqual({
      from: '2026-06-19',
      to: '2026-06-19',
    })
  })

  it('returns null for missing or inverted bounds (all-time has no prior period)', () => {
    expect(previousPeriod(null, '2026-06-30')).toBeNull()
    expect(previousPeriod('2026-06-30', null)).toBeNull()
    expect(previousPeriod('2026-06-30', '2026-06-01')).toBeNull()
  })
})

describe('computeDelta', () => {
  it('computes absolute and percentage change with direction', () => {
    expect(computeDelta(120, 100)).toEqual({ abs: 20, pct: 20, direction: 'up' })
    expect(computeDelta(80, 100)).toEqual({ abs: -20, pct: -20, direction: 'down' })
    expect(computeDelta(100, 100)).toEqual({ abs: 0, pct: 0, direction: 'flat' })
  })

  it('returns null pct when there is no baseline to compare against', () => {
    expect(computeDelta(5, 0)).toEqual({ abs: 5, pct: null, direction: 'up' })
  })
})

describe('formatDelta', () => {
  it('renders a signed percentage', () => {
    expect(formatDelta({ abs: 20, pct: 20, direction: 'up' })).toBe('+20.0%')
    expect(formatDelta({ abs: -12.5, pct: -12.5, direction: 'down' })).toBe('-12.5%')
  })

  it('renders new when there is no baseline', () => {
    expect(formatDelta({ abs: 5, pct: null, direction: 'up' })).toBe('New')
  })

  it('renders no change for a flat delta', () => {
    expect(formatDelta({ abs: 0, pct: 0, direction: 'flat' })).toBe('No change')
  })
})

describe('crosstabLookup', () => {
  const cells: CrosstabCell[] = [
    { leadStageId: 'q', leadStageName: 'Qualified', leadRank: 1, leadStageTotal: 142,
      projectStageId: 'won', projectStageName: 'Won', projectKind: 'won', projectRank: 2, leads: 37 },
    { leadStageId: 'q', leadStageName: 'Qualified', leadRank: 1, leadStageTotal: 142,
      projectStageId: 'open', projectStageName: 'Open', projectKind: 'open', projectRank: 0, leads: 96 },
  ]

  it('looks up the cell for a lead rank x project rank and derives pct + ratio', () => {
    const r = crosstabLookup(cells, 1, 2)
    expect(r.leads).toBe(37)
    expect(r.total).toBe(142)
    expect(r.pct).toBeCloseTo(26.06, 1)
    // "leads per win" = 142 / 37
    expect(r.ratio).toBeCloseTo(3.84, 1)
  })

  it('returns zeros when the cell is absent', () => {
    expect(crosstabLookup(cells, 9, 9)).toEqual({ leads: 0, total: 0, pct: 0, ratio: 0 })
  })
})

describe('toCsv', () => {
  it('joins headers and rows with newlines', () => {
    const csv = toCsv(['Stage', 'Reached'], [['New', 100], ['Won', 7]])
    expect(csv).toBe('Stage,Reached\nNew,100\nWon,7')
  })

  it('quotes and escapes values containing commas, quotes, or newlines', () => {
    const csv = toCsv(['Name'], [['Acme, Inc.'], ['She said "hi"'], ['line1\nline2']])
    expect(csv).toBe('Name\n"Acme, Inc."\n"She said ""hi"""\n"line1\nline2"')
  })

  it('returns just the header row when there are no data rows', () => {
    expect(toCsv(['A', 'B'], [])).toBe('A,B')
  })
})
