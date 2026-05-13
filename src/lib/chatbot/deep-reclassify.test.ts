import { describe, it, expect } from 'vitest'
import { coerceDecision, classifyMoveType } from './deep-reclassify'

const stages = [
  { id: 's1', name: 'New', kind: 'entry', position: 0 },
  { id: 's2', name: 'Engaged', kind: 'nurture', position: 1 },
  { id: 's3', name: 'Interested', kind: 'nurture', position: 2 },
  { id: 's4', name: 'Qualified', kind: 'qualifying', position: 3 },
  { id: 's5', name: 'Objection', kind: 'objection', position: 4 },
  { id: 's7', name: 'Won', kind: 'won', position: 6 },
] as const

describe('classifyMoveType', () => {
  it('adjacent forward', () => {
    expect(classifyMoveType(stages, 's2', 's3')).toBe('adjacent_forward')
  })
  it('skip ahead', () => {
    expect(classifyMoveType(stages, 's2', 's4')).toBe('skip_ahead')
  })
  it('into terminal', () => {
    expect(classifyMoveType(stages, 's3', 's7')).toBe('into_terminal')
  })
  it('into objection', () => {
    expect(classifyMoveType(stages, 's3', 's5')).toBe('into_objection')
  })
  it('out of objection', () => {
    expect(classifyMoveType(stages, 's5', 's3')).toBe('out_of_objection')
  })
  it('backward', () => {
    expect(classifyMoveType(stages, 's4', 's2')).toBe('backward')
  })
})

describe('coerceDecision', () => {
  const base = {
    to_stage_id: 's3',
    matched_signals: ['asked price'],
    reason: 'lead asked magkano',
    move_type: 'adjacent_forward',
  }

  it('accepts medium confidence on adjacent forward', () => {
    const json = JSON.stringify({ stage_change: { ...base, confidence: 'medium' } })
    expect(coerceDecision(json)).not.toBeNull()
  })

  it('rejects medium confidence on skip_ahead', () => {
    const json = JSON.stringify({
      stage_change: { ...base, move_type: 'skip_ahead', confidence: 'medium' },
    })
    expect(coerceDecision(json)).toBeNull()
  })

  it('rejects medium confidence on into_terminal', () => {
    const json = JSON.stringify({
      stage_change: { ...base, move_type: 'into_terminal', confidence: 'medium' },
    })
    expect(coerceDecision(json)).toBeNull()
  })

  it('rejects when matched_signals is empty', () => {
    const json = JSON.stringify({
      stage_change: { ...base, matched_signals: [], confidence: 'high' },
    })
    expect(coerceDecision(json)).toBeNull()
  })

  it('accepts high confidence on backward only with regression in reason', () => {
    const okJson = JSON.stringify({
      stage_change: { ...base, move_type: 'backward', confidence: 'high', reason: 'regression: lead un-confirmed budget' },
    })
    const badJson = JSON.stringify({
      stage_change: { ...base, move_type: 'backward', confidence: 'high', reason: 'lead said nothing' },
    })
    expect(coerceDecision(okJson)).not.toBeNull()
    expect(coerceDecision(badJson)).toBeNull()
  })
})
