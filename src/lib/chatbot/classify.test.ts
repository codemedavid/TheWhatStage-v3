import { describe, expect, it } from 'vitest'
import type { StageBrief } from './classify'
import { stageInstruction, stageList } from './classify'

const stages: StageBrief[] = [
  { id: 'st_new', name: 'New Lead',    description: 'fresh',    position: 0, kind: 'entry' },
  { id: 'st_q',   name: 'Qualifying',  description: 'asking q', position: 1, kind: 'qualifying' },
  { id: 'st_b',   name: 'Booked Call', description: 'call set', position: 2, kind: 'decision' },
  { id: 'st_won', name: 'Closed Won',  description: 'paid',     position: 3, kind: 'won' },
  { id: 'st_lost',name: 'Lost',        description: 'no go',    position: 4, kind: 'lost' },
]

describe('stageList', () => {
  it('renders stages in position order with [position · kind] name prefix', () => {
    const out = stageList(stages, 'st_q')
    const lines = out.split('\n')
    expect(lines[0]).toMatch(/Pipeline stages \(in order/)
    expect(out).toContain('[0 · entry] New Lead')
    expect(out).toContain('[1 · qualifying] Qualifying')
    expect(out).toContain('[2 · decision] Booked Call')
    expect(out).toContain('[3 · won] Closed Won')
    expect(out).toContain('[4 · lost] Lost')
  })

  it('flags the current stage', () => {
    const out = stageList(stages, 'st_b')
    expect(out).toMatch(/\[2 · decision\] Booked Call\s*\[CURRENT\]/)
  })

  it('handles missing description gracefully', () => {
    const s: StageBrief[] = [
      { id: 'a', name: 'A', description: null, position: 0, kind: 'entry' },
    ]
    expect(stageList(s, null)).toContain('(no description)')
  })

  it('preserves position order even when input is shuffled', () => {
    const shuffled: StageBrief[] = [stages[3], stages[0], stages[2], stages[4], stages[1]]
    const out = stageList(shuffled, null)
    const idxNew  = out.indexOf('New Lead')
    const idxQ    = out.indexOf('Qualifying')
    const idxB    = out.indexOf('Booked Call')
    const idxWon  = out.indexOf('Closed Won')
    const idxLost = out.indexOf('Lost')
    expect(idxNew).toBeLessThan(idxQ)
    expect(idxQ).toBeLessThan(idxB)
    expect(idxB).toBeLessThan(idxWon)
    expect(idxWon).toBeLessThan(idxLost)
  })
})

describe('stageInstruction (hierarchy block)', () => {
  it('includes the HIERARCHY RULES block', () => {
    // stageInstruction signature:
    //   (stages, currentStageId, actionPages, recommendRules, recommendPropertyRules)
    const out = stageInstruction(stages, null, [], null, null)
    expect(out).toContain('STAGE HIERARCHY RULES')
    expect(out).toContain('Forward moves')
    expect(out).toContain('Backward moves')
    expect(out).toContain('"high"')
    expect(out).toContain('disqualifying signal')
  })

  it('renders the position-ordered stage list within the prompt', () => {
    const out = stageInstruction(stages, 'st_q', [], null, null)
    expect(out).toContain('[0 · entry] New Lead')
    // st_q is current — should have [CURRENT]
    expect(out).toMatch(/\[1 · qualifying\] Qualifying\s*\[CURRENT\]/)
  })
})
