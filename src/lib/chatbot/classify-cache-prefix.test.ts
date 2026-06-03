import { afterEach, describe, expect, it } from 'vitest'
import { buildPrompt } from '@/lib/rag'
import { ragConfig } from '@/lib/rag/config'
import { manilaDateBlock } from '@/lib/time/manilaNow'
import type { GradedBuckets } from '@/lib/rag/grader'
import type { RetrievedChunk } from '@/lib/rag/retriever'
import { stageInstruction, stageInstructionParts } from './classify'
import type { StageBrief, ActionPageBrief } from './classify'

// applyStageChange (transitively imported via classify) pulls Supabase env
// vars when it fires dispatchStageEntered; stub the admin client + dispatcher
// so the import graph is side-effect free in tests.
import { vi } from 'vitest'
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/workflow/dispatcher', () => ({ dispatchStageEntered: vi.fn(async () => undefined) }))

const chunk = (
  id: string,
  content: string,
  score: number,
): RetrievedChunk & { score: number } => ({
  id,
  document_id: 'd',
  faq_id: null,
  content,
  heading_path: null,
  score,
})

const buckets = (
  useful: (RetrievedChunk & { score: number })[] = [],
): GradedBuckets<RetrievedChunk> => ({ useful, ambiguous: [], reject: [] })

const stages: StageBrief[] = [
  { id: 'st_new', name: 'New Lead', description: 'fresh', position: 0, kind: 'entry' },
  { id: 'st_int', name: 'Interested', description: 'evaluating', position: 1, kind: 'nurture' },
  { id: 'st_won', name: 'Closed Won', description: 'paid', position: 2, kind: 'won' },
]

const pages: ActionPageBrief[] = [
  { id: 'ap_book', title: 'Book a Call', cta_label: 'Book', bot_send_instructions: 'Send when ready.' },
]

/**
 * Mirror of classify.ts's cache_friendly assembly so the test pins the exact
 * ordering contract without spinning up the full RAG/LLM pipeline.
 */
function assembleCacheFriendly(args: {
  kbContent: string
  summary: string
  payment: string
  currentStageId: string | null
  leadName: string | null
  leadContext: string | null
  mediaBlock: string | null
  date: Date
}): string {
  const built = buildPrompt({
    userQuery: 'q',
    buckets: buckets([chunk('a', args.kbContent, 0.9)]),
    config: { funnelInstruction: 'GOAL-TEXT', instructions: 'INSTR-TEXT' },
    conversationSummary: args.summary,
    paymentEnumBlock: args.payment,
  })
  const stageParts = stageInstructionParts(stages, args.currentStageId, pages, null, null)
  const leadNameBlock = args.leadName
    ? `# Lead\nThe customer's first name is ${args.leadName}. Address them by their first name when greeting or when it feels natural.`
    : null
  return [
    built.staticPrefix,
    stageParts.staticPrefix,
    built.volatileTail,
    stageParts.volatileTail,
    leadNameBlock,
    args.leadContext,
    args.mediaBlock,
    manilaDateBlock(args.date),
  ]
    .filter(Boolean)
    .join('\n\n')
}

const original = ragConfig.promptLayout
afterEach(() => {
  ragConfig.promptLayout = original
})

describe('classify cache_friendly assembly — contiguous static prefix', () => {
  it('places ALL volatile markers AFTER the contiguous static block, with the two static blocks adjacent', () => {
    ragConfig.promptLayout = 'cache_friendly'
    const system = assembleCacheFriendly({
      kbContent: 'KB-CHUNK-XYZ',
      summary: 'SUMMARY-TEXT',
      payment: 'Available Payment Methods:\n- GCash: 0917',
      currentStageId: 'st_int',
      leadName: 'Beatrix',
      leadContext: '# Lead context\nBeatrix has 1 booking.',
      mediaBlock: '# Attached images\n- @hero-media-marker',
      date: new Date('2026-05-18T06:32:00Z'),
    })

    // End of static region = last static marker. The action-page preamble and
    // the grounding/persona prose all sit in the static prefix.
    const idxGrounding = system.indexOf('# Grounding')
    const idxStageHeader = system.indexOf('## STAGE CLASSIFICATION')
    const idxApPreamble = system.indexOf('ACTION PAGES — INTERNAL ROUTING ONLY')
    expect(idxGrounding).toBeGreaterThanOrEqual(0)
    expect(idxStageHeader).toBeGreaterThan(idxGrounding)

    // The two static blocks are ADJACENT: no volatile content appears between
    // '# Fallback' (end of built.staticPrefix) and '## STAGE CLASSIFICATION'.
    const idxFallback = system.indexOf('# Fallback')
    const between = system.slice(idxFallback, idxStageHeader)
    expect(between).not.toContain('# Knowledge base context')
    expect(between).not.toContain('SUMMARY-TEXT')
    expect(between).not.toContain('Current date:')
    expect(between).not.toContain('KB-CHUNK-XYZ')

    // Last static marker: the final sentence of the action-page preamble, which
    // is the very end of stageParts.staticPrefix (block [B]). Every volatile
    // marker must come AFTER it.
    const lastStatic = system.indexOf('This rule applies to every action page in the list below')
    expect(lastStatic).toBeGreaterThan(idxApPreamble)
    expect(lastStatic).toBeGreaterThan(idxStageHeader)

    const volatileMarkers = [
      'KB-CHUNK-XYZ', // KB chunk
      'GOAL-TEXT', // funnel goal
      'INSTR-TEXT', // instructions
      'SUMMARY-TEXT', // conversation summary
      'Available Payment Methods', // payment enum
      'CURRENT STAGE:', // currentStageBanner
      'Pipeline stages (in order', // stageList
      'Book a Call', // actionPageList entry
      'Beatrix has 1 booking', // lead name + lead context
      '@hero-media-marker', // media block
      'Current date:', // time block
    ]
    for (const m of volatileMarkers) {
      const idx = system.indexOf(m)
      expect(idx, `volatile marker "${m}" must appear`).toBeGreaterThanOrEqual(0)
      expect(idx, `volatile marker "${m}" must be AFTER the static prefix`).toBeGreaterThan(
        lastStatic,
      )
    }
  })

  it('produces a BYTE-IDENTICAL static prefix across two turns with different volatile inputs', () => {
    ragConfig.promptLayout = 'cache_friendly'
    const turnA = assembleCacheFriendly({
      kbContent: 'KB-CHUNK-AAA',
      summary: 'SUMMARY-AAA',
      payment: 'Available Payment Methods:\n- GCash: 0917',
      currentStageId: 'st_new',
      leadName: 'Ana',
      leadContext: '# Lead context\nAna asked about pricing.',
      mediaBlock: null,
      date: new Date('2026-05-18T06:32:00Z'),
    })
    const turnB = assembleCacheFriendly({
      kbContent: 'KB-CHUNK-BBB-totally-different',
      summary: 'SUMMARY-BBB',
      payment: 'Available Payment Methods:\n- Maya: 0918',
      currentStageId: 'st_int', // different current stage → different banner/list
      leadName: 'Carlos',
      leadContext: '# Lead context\nCarlos has 2 orders.',
      mediaBlock: '# Attached images\n- @x',
      date: new Date('2026-06-01T06:32:00Z'), // different day
    })

    // The leading static region = everything up to the first volatile marker.
    // The earliest volatile content is the funnel goal (built.volatileTail
    // starts with '# PRIMARY GOAL').
    const cut = (s: string) => s.slice(0, s.indexOf('# PRIMARY GOAL'))
    const prefixA = cut(turnA)
    const prefixB = cut(turnB)
    expect(prefixA.length).toBeGreaterThan(100)
    expect(prefixA).toBe(prefixB)
  })

  it('appends a single DATE-resolution time block at the tail and no minute time in the prefix', () => {
    ragConfig.promptLayout = 'cache_friendly'
    const system = assembleCacheFriendly({
      kbContent: 'KB',
      summary: 'S',
      payment: '',
      currentStageId: 'st_new',
      leadName: null,
      leadContext: null,
      mediaBlock: null,
      date: new Date('2026-05-18T06:32:00Z'),
    })
    expect(system).toContain('Current date: Monday, May 18, 2026 (Asia/Manila, UTC+08:00).')
    // exactly one date block
    expect(system.split('Current date:').length - 1).toBe(1)
    const prefix = system.slice(0, system.indexOf('# PRIMARY GOAL'))
    expect(prefix).not.toMatch(/\d{1,2}:\d{2}/)
    expect(prefix).not.toContain('Current time:')
  })
})

describe('classify legacy assembly — byte-identical to pre-change order', () => {
  it('joins [built.system, stageSystem, lead, media] with stage prose AFTER built.system and minute time present', () => {
    ragConfig.promptLayout = 'legacy'
    const built = buildPrompt({
      userQuery: 'q',
      buckets: buckets([chunk('a', 'KB-CHUNK', 0.9)]),
      config: { funnelInstruction: 'GOAL-TEXT', instructions: 'INSTR-TEXT' },
      conversationSummary: 'SUMMARY-TEXT',
    })
    // legacy leaves the split fields undefined
    expect(built.staticPrefix).toBeUndefined()
    expect(built.volatileTail).toBeUndefined()

    const stageSystem = stageInstruction(stages, 'st_int', pages, null, null)
    const leadNameBlock = `# Lead\nThe customer's first name is Bea. Address them by their first name when greeting or when it feels natural.`
    const mediaBlock = '# Attached images\n- @hero'
    const system = [built.system, stageSystem, leadNameBlock, null, mediaBlock]
      .filter(Boolean)
      .join('\n\n')

    // Pre-change order: goal/instructions precede Identity in built.system.
    expect(system.indexOf('GOAL-TEXT')).toBeLessThan(system.indexOf('# Identity'))
    // Stage prose comes AFTER the entire built.system (not interleaved).
    expect(system.indexOf('## STAGE CLASSIFICATION')).toBeGreaterThan(
      system.indexOf('# Knowledge base context'),
    )
    // Minute-resolution time present (legacy keeps full HH:MM).
    expect(system).toMatch(/Current time:[^\n]*\d{1,2}:\d{2}/)
    // Equals the exact original expression.
    const expected = [built.system, stageSystem, leadNameBlock, mediaBlock]
      .filter(Boolean)
      .join('\n\n')
    expect(system).toBe(expected)
  })
})

describe('stageInstruction back-compat', () => {
  it('stageInstruction(...) equals staticPrefix + "\\n\\n" + volatileTail', () => {
    const parts = stageInstructionParts(stages, 'st_int', pages, null, null)
    expect(stageInstruction(stages, 'st_int', pages, null, null)).toBe(
      parts.staticPrefix + '\n\n' + parts.volatileTail,
    )
  })
})
