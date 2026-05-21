import { describe, expect, it } from 'vitest'
import type { ActionPageBrief, StageBrief } from '@/lib/chatbot/classify'
import { isSendableStage, resolveFallbackFromList } from './force-send'

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
