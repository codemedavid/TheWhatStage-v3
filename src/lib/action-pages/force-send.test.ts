import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ActionPageBrief, ActionPageChoice, StageBrief, StageChange } from '@/lib/chatbot/classify'
import { __leadCacheResetForTests } from '@/lib/leads/cache'
import {
  isSendableStage,
  resolveFallbackFromList,
  detectProceedRegex,
  detectStageForward,
  hasQualifiedQuizSubmission,
  isStageQualified,
  hashInstructions,
  prerequisitesAnsweredCached,
  parseLlmJsonResponse,
  type LlmCheckClient,
} from './force-send'

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

describe('isStageQualified', () => {
  it('returns false when stage is null', () => {
    expect(isStageQualified(null)).toBe(false)
  })

  it.each(['qualifying', 'decision'] as const)('returns true for kind %s', (k) => {
    expect(isStageQualified(stage(k))).toBe(true)
  })

  it.each(['entry', 'nurture', 'lost', 'dormant', 'won'] as const)(
    'returns false for kind %s',
    (k) => {
      expect(isStageQualified(stage(k))).toBe(false)
    },
  )
})

describe('hasQualifiedQuizSubmission', () => {
  function mockSupabase(rows: Array<{ outcome: string; action_pages: { kind: string } }>) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({ data: rows, error: null }),
              }),
            }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof hasQualifiedQuizSubmission>[0]
  }

  it('returns true when a qualified submission on a qualification page exists', async () => {
    const s = mockSupabase([{ outcome: 'qualified', action_pages: { kind: 'qualification' } }])
    expect(await hasQualifiedQuizSubmission(s, 'lead-1')).toBe(true)
  })

  it('ignores non-qualification page submissions', async () => {
    const s = mockSupabase([{ outcome: 'qualified', action_pages: { kind: 'form' } }])
    expect(await hasQualifiedQuizSubmission(s, 'lead-1')).toBe(false)
  })

  it('ignores submissions whose outcome is not "qualified"', async () => {
    const s = mockSupabase([{ outcome: 'pending_review', action_pages: { kind: 'qualification' } }])
    expect(await hasQualifiedQuizSubmission(s, 'lead-1')).toBe(false)
  })

  it('returns false when no submissions found', async () => {
    const s = mockSupabase([])
    expect(await hasQualifiedQuizSubmission(s, 'lead-1')).toBe(false)
  })
})

beforeEach(() => __leadCacheResetForTests())

describe('hashInstructions', () => {
  it('produces a stable hex string', () => {
    expect(hashInstructions('hello')).toBe(hashInstructions('hello'))
  })

  it('differs when text differs', () => {
    expect(hashInstructions('a')).not.toBe(hashInstructions('b'))
  })

  it('returns the same hash for empty inputs', () => {
    expect(hashInstructions('')).toBe(hashInstructions(''))
  })
})

describe('prerequisitesAnsweredCached', () => {
  const history = [{ role: 'user' as const, content: 'My budget is 50k and I want delivery next week' }]
  const instructions = 'Ask for budget and delivery timeline before sending'

  it('calls the LLM once and caches the result for a (leadId, pageId, hash) key', async () => {
    const fake: LlmCheckClient = {
      checkPrerequisites: vi.fn(async () => true),
    }

    const first = await prerequisitesAnsweredCached({
      leadId: 'lead-1',
      actionPageId: 'page-1',
      instructionsText: instructions,
      history,
      llm: fake,
    })
    const second = await prerequisitesAnsweredCached({
      leadId: 'lead-1',
      actionPageId: 'page-1',
      instructionsText: instructions,
      history,
      llm: fake,
    })

    expect(first).toBe(true)
    expect(second).toBe(true)
    expect(fake.checkPrerequisites).toHaveBeenCalledTimes(1)
  })

  it('recomputes when instructions text changes (hash differs)', async () => {
    const fake: LlmCheckClient = {
      checkPrerequisites: vi.fn(async () => true),
    }

    await prerequisitesAnsweredCached({
      leadId: 'lead-1',
      actionPageId: 'page-1',
      instructionsText: 'old text',
      history,
      llm: fake,
    })
    await prerequisitesAnsweredCached({
      leadId: 'lead-1',
      actionPageId: 'page-1',
      instructionsText: 'new text',
      history,
      llm: fake,
    })

    expect(fake.checkPrerequisites).toHaveBeenCalledTimes(2)
  })

  it('returns true without calling the LLM when instructionsText is empty', async () => {
    const fake: LlmCheckClient = { checkPrerequisites: vi.fn(async () => false) }
    const r = await prerequisitesAnsweredCached({
      leadId: 'lead-1',
      actionPageId: 'page-1',
      instructionsText: '',
      history,
      llm: fake,
    })
    expect(r).toBe(true)
    expect(fake.checkPrerequisites).not.toHaveBeenCalled()
  })

  it('does not cache when the LLM returns false (so a later turn can succeed)', async () => {
    const fake: LlmCheckClient = {
      checkPrerequisites: vi
        .fn<[], Promise<boolean>>()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
    }

    const first = await prerequisitesAnsweredCached({
      leadId: 'lead-1',
      actionPageId: 'page-1',
      instructionsText: instructions,
      history,
      llm: fake,
    })
    const second = await prerequisitesAnsweredCached({
      leadId: 'lead-1',
      actionPageId: 'page-1',
      instructionsText: instructions,
      history,
      llm: fake,
    })

    expect(first).toBe(false)
    expect(second).toBe(true)
    expect(fake.checkPrerequisites).toHaveBeenCalledTimes(2)
  })
})

describe('parseLlmJsonResponse', () => {
  it('parses {"ok": true}', () => {
    expect(parseLlmJsonResponse('{"ok": true}')).toEqual({ ok: true })
  })

  it('parses {"ok": false}', () => {
    expect(parseLlmJsonResponse('{"ok": false}')).toEqual({ ok: false })
  })

  it('strips ```json fences', () => {
    expect(parseLlmJsonResponse('```json\n{"ok": true}\n```')).toEqual({ ok: true })
  })

  it('extracts the first {...} block when text contains prose', () => {
    expect(parseLlmJsonResponse('sure: {"ok": true} done')).toEqual({ ok: true })
  })

  it('returns { ok: false } on garbage input', () => {
    expect(parseLlmJsonResponse('lol no')).toEqual({ ok: false })
  })

  it('returns { ok: false } when ok is not a boolean', () => {
    expect(parseLlmJsonResponse('{"ok": "yes"}')).toEqual({ ok: false })
  })
})

import { decideForceSend, type ForceSendContext } from './force-send'

function ctx(over: Partial<ForceSendContext> = {}): ForceSendContext {
  const pages: ActionPageBrief[] = [
    { id: 'primary', title: 'Primary', cta_label: 'Go', bot_send_instructions: '' },
  ]
  const baseStage: StageBrief = {
    id: 'qual',
    name: 'Qualifying',
    description: null,
    position: 2,
    kind: 'qualifying',
  }
  const stages: StageBrief[] = [
    { id: 'entry', name: 'Entry', description: null, position: 0, kind: 'entry' },
    baseStage,
    { id: 'won', name: 'Won', description: null, position: 3, kind: 'won' },
  ]
  return {
    userId: 'u1',
    leadId: 'lead-1',
    threadId: 't1',
    history: [{ role: 'user', content: 'previous msg' }],
    latestCustomerMessage: 'sige po',
    currentStage: baseStage,
    stages,
    stageChangeThisTurn: null,
    llmActionPage: null,
    actionPages: pages,
    primaryActionPageId: 'primary',
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({ data: [], error: null }),
              }),
            }),
          }),
        }),
      }),
    } as unknown as ForceSendContext['supabase'],
    llm: { checkPrerequisites: vi.fn(async () => true), detectProceed: vi.fn(async () => false) },
    ...over,
  }
}

describe('decideForceSend', () => {
  beforeEach(() => __leadCacheResetForTests())

  it('overrides null LLM choice when all conditions are met', async () => {
    const c = ctx()
    const r = await decideForceSend(c)
    expect(r.overrideFired).toBe(true)
    expect(r.actionPage?.action_page_id).toBe('primary')
  })

  it('does not override when LLM already picked the resolved page', async () => {
    const llmChoice: ActionPageChoice = {
      action_page_id: 'primary',
      reason: 'LLM said so',
      button_text: 'Tap below 👇',
    }
    const r = await decideForceSend(ctx({ llmActionPage: llmChoice }))
    expect(r.overrideFired).toBe(false)
    expect(r.actionPage).toBe(llmChoice)
  })

  it.each(['lost', 'dormant', 'won'] as const)('skips when stage kind is %s', async (k) => {
    const r = await decideForceSend(
      ctx({
        currentStage: { id: 'x', name: 'X', description: null, position: 5, kind: k },
      }),
    )
    expect(r.overrideFired).toBe(false)
    expect(r.actionPage).toBeNull()
  })

  it('falls back to first page when no primary configured', async () => {
    const r = await decideForceSend(ctx({ primaryActionPageId: null }))
    expect(r.overrideFired).toBe(true)
    expect(r.actionPage?.action_page_id).toBe('primary')
  })

  it('does nothing when no primary AND no published pages', async () => {
    const r = await decideForceSend(ctx({ primaryActionPageId: null, actionPages: [] }))
    expect(r.overrideFired).toBe(false)
    expect(r.actionPage).toBeNull()
  })

  it('does nothing on a cold first inbound (no prior customer messages)', async () => {
    const r = await decideForceSend(ctx({ history: [] }))
    expect(r.overrideFired).toBe(false)
  })

  it('does nothing when leadId is null', async () => {
    const r = await decideForceSend(ctx({ leadId: null }))
    expect(r.overrideFired).toBe(false)
  })

  it('does not call the proceed LLM when regex hits', async () => {
    const llm = { checkPrerequisites: vi.fn(async () => true), detectProceed: vi.fn(async () => false) }
    await decideForceSend(ctx({ latestCustomerMessage: 'sige po', llm }))
    expect(llm.detectProceed).not.toHaveBeenCalled()
  })

  it('does not call the proceed LLM when regex misses but stage moved forward', async () => {
    const change: StageChange = { to_stage_id: 'qual', confidence: 'medium', reason: 'asked price' }
    const llm = { checkPrerequisites: vi.fn(async () => true), detectProceed: vi.fn(async () => false) }
    await decideForceSend(
      ctx({ latestCustomerMessage: 'hmm interesting', stageChangeThisTurn: change, llm }),
    )
    expect(llm.detectProceed).not.toHaveBeenCalled()
  })

  it('calls the proceed LLM once when both regex and stage-forward miss', async () => {
    const llm = { checkPrerequisites: vi.fn(async () => true), detectProceed: vi.fn(async () => true) }
    const r = await decideForceSend(
      ctx({ latestCustomerMessage: 'hmm interesting', stageChangeThisTurn: null, llm }),
    )
    expect(llm.detectProceed).toHaveBeenCalledTimes(1)
    expect(r.overrideFired).toBe(true)
  })

  it('does NOT override when proceed signal is missing', async () => {
    const llm = { checkPrerequisites: vi.fn(async () => true), detectProceed: vi.fn(async () => false) }
    const r = await decideForceSend(
      ctx({ latestCustomerMessage: 'hmm interesting', stageChangeThisTurn: null, llm }),
    )
    expect(r.overrideFired).toBe(false)
    expect(r.actionPage).toBeNull()
  })

  it('skips prerequisite LLM call when stage is already qualified (path A)', async () => {
    const llm = { checkPrerequisites: vi.fn(async () => false), detectProceed: vi.fn(async () => false) }
    const r = await decideForceSend(
      ctx({
        latestCustomerMessage: 'sige po',
        actionPages: [
          { id: 'primary', title: 'Primary', cta_label: 'Go', bot_send_instructions: 'Ask budget first.' },
        ],
        llm,
      }),
    )
    expect(llm.checkPrerequisites).not.toHaveBeenCalled()
    expect(r.overrideFired).toBe(true)
  })
})
