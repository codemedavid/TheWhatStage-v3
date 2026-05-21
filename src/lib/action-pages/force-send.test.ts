import { describe, expect, it } from 'vitest'
import type { ActionPageBrief, StageBrief, StageChange } from '@/lib/chatbot/classify'
import { isSendableStage, resolveFallbackFromList, detectProceedRegex, detectStageForward } from './force-send'

const stage = (kind: StageBrief['kind']): StageBrief => ({
  id: 's1',
  name: 'Stage',
  description: null,
  position: 1,
  kind,
})

describe('isSendableStage', () => {
  it('returns true when stage is null', () => {
    expect(isSendableStage(null)).toBe(true)
  })

  it.each(['lost', 'dormant', 'won'] as const)('returns false for kind %s', (k) => {
    expect(isSendableStage(stage(k))).toBe(false)
  })

  it.each(['entry', 'qualifying', 'nurture', 'decision'] as const)(
    'returns true for kind %s',
    (k) => {
      expect(isSendableStage(stage(k))).toBe(true)
    },
  )
})

describe('resolveFallbackFromList', () => {
  const pageA: ActionPageBrief = { id: 'a', title: 'A', cta_label: 'a', bot_send_instructions: '' }
  const pageB: ActionPageBrief = { id: 'b', title: 'B', cta_label: 'b', bot_send_instructions: '' }

  it('returns the primary when found in the list', () => {
    const r = resolveFallbackFromList('b', [pageA, pageB])
    expect(r?.id).toBe('b')
  })

  it('returns the first page when primary id is null', () => {
    const r = resolveFallbackFromList(null, [pageA, pageB])
    expect(r?.id).toBe('a')
  })

  it('returns null when primary id is set but not in list and list empty', () => {
    expect(resolveFallbackFromList('x', [])).toBeNull()
  })

  it('returns null when primary id is null and list empty', () => {
    expect(resolveFallbackFromList(null, [])).toBeNull()
  })
})

describe('detectProceedRegex', () => {
  it.each([
    'sige po, kunin ko na',
    'Sige na',
    'magkano po yung small?',
    'paano mag-avail',
    'paano magbayad',
    "let's go",
    "I'm in",
    'book na ako',
    'tara na po',
    'sign me up',
    'game na ako',
    'okay na po ako',
    'ready na ako',
    'gusto ko na po',
    'interested po',
    'paano sumali',
    'how do I sign up',
    'how much po',
  ])('matches proceed signal "%s"', (msg) => {
    expect(detectProceedRegex(msg)).toBe(true)
  })

  it.each([
    'hello po',
    'good morning',
    'what do you sell',
    'magandang umaga po',
    '',
  ])('does not match small talk "%s"', (msg) => {
    expect(detectProceedRegex(msg)).toBe(false)
  })
})

describe('detectStageForward', () => {
  const stages: StageBrief[] = [
    { id: 'entry', name: 'Entry', description: null, position: 0, kind: 'entry' },
    { id: 'nurt', name: 'Nurture', description: null, position: 1, kind: 'nurture' },
    { id: 'qual', name: 'Qualifying', description: null, position: 2, kind: 'qualifying' },
    { id: 'dec', name: 'Decision', description: null, position: 3, kind: 'decision' },
    { id: 'won', name: 'Won', description: null, position: 4, kind: 'won' },
  ]

  it('returns false when stageChange is null', () => {
    expect(detectStageForward(null, 1, stages)).toBe(false)
  })

  it('returns false when target stage is unknown', () => {
    const change: StageChange = { to_stage_id: 'ghost', confidence: 'high', reason: '' }
    expect(detectStageForward(change, 1, stages)).toBe(false)
  })

  it('returns true when target is qualifying-kind regardless of position', () => {
    const change: StageChange = { to_stage_id: 'qual', confidence: 'low', reason: '' }
    expect(detectStageForward(change, 2, stages)).toBe(true)
  })

  it('returns true when target position >= current', () => {
    const change: StageChange = { to_stage_id: 'nurt', confidence: 'low', reason: '' }
    expect(detectStageForward(change, 1, stages)).toBe(true)
  })

  it('returns false when target position < current and kind not qualifying/decision/won', () => {
    const change: StageChange = { to_stage_id: 'entry', confidence: 'high', reason: '' }
    expect(detectStageForward(change, 2, stages)).toBe(false)
  })

  it('returns true when target is decision-kind even backward', () => {
    const change: StageChange = { to_stage_id: 'dec', confidence: 'high', reason: '' }
    expect(detectStageForward(change, 4, stages)).toBe(true)
  })

  it('returns true when currentPosition is null (no current stage)', () => {
    const change: StageChange = { to_stage_id: 'nurt', confidence: 'low', reason: '' }
    expect(detectStageForward(change, null, stages)).toBe(true)
  })
})
