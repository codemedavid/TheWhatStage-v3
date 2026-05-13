import type { SupabaseClient } from '@supabase/supabase-js'
import { HfRouterLlm } from '@/lib/rag'
import type { LlmMessage } from '@/lib/rag/llm'
import { ragConfig } from '@/lib/rag/config'

type LlmLike = { complete: (messages: LlmMessage[], opts?: { temperature?: number; maxTokens?: number; responseFormat?: 'json_object' }) => Promise<string> }

function createLlm(): LlmLike {
  return new HfRouterLlm({ model: ragConfig.classifierModel })
}

export interface RunDeepReclassifyArgs {
  adminClient: SupabaseClient
  leadId: string
  threadId: string
  userId: string
  windowIndex: number
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LeadRow {
  id: string
  user_id: string
  name: string
  stage_id: string
  entered_stage_at: string
  score: number | null
}

interface StageRow {
  id: string
  name: string
  description: string | null
  position: number
  kind: string
  entry_signals: string[] | null
  exit_signals: string[] | null
}

interface MessageRow {
  direction: 'inbound' | 'outbound'
  body: string
  created_at: string
}

interface EventRow {
  id: string
  from_stage_id: string | null
  to_stage_id: string
  source: string
  reason: string | null
  confidence: string | null
  created_at: string
}

interface SubmissionRow {
  id: string
  outcome: string
  created_at: string
  action_page_id: string
}

interface PageRow {
  id: string
  title: string
  kind: string
}

interface DeepContext {
  lead: LeadRow
  stages: StageRow[]
  messages: MessageRow[]
  events: EventRow[]
  submissions: SubmissionRow[]
  pages: PageRow[]
}

interface DeepDecision {
  to_stage_id: string
  confidence: 'high'
  reason: string
}

// ---------------------------------------------------------------------------
// Public entry point — never throws
// ---------------------------------------------------------------------------

/**
 * Background deep stage re-evaluation. Uses a focused LLM call with full
 * conversation + event history to decide whether the lead should move stages.
 * Only acts on `high`-confidence decisions. Never throws.
 */
export async function runDeepReclassify(args: RunDeepReclassifyArgs): Promise<void> {
  const { adminClient: admin, leadId, threadId, userId, windowIndex } = args
  try {
    const ctx = await loadContext(admin, leadId, threadId)
    if (!ctx) {
      console.warn('[deep-reclassify] context load failed', { leadId })
      return
    }

    const decision = await callLlm(ctx)
    if (!decision) return

    // Same-stage skip
    if (decision.to_stage_id === ctx.lead.stage_id) return

    // Unknown-stage skip
    if (!ctx.stages.some((s) => s.id === decision.to_stage_id)) return

    const idempotencyKey = `deep:${threadId}:${leadId}:${windowIndex}`
    const { error } = await admin.rpc('set_lead_stage', {
      p_lead_id: leadId,
      p_to_stage_id: decision.to_stage_id,
      p_source: 'deep_classifier',
      p_reason: decision.reason.slice(0, 500),
      p_idempotency_key: idempotencyKey,
      p_expected_version: null,
      p_confidence: 'high',
      p_thread_id: threadId,
    })

    if (error) {
      console.error('[deep-reclassify] set_lead_stage error', (error as { message?: string }).message ?? error)
      return
    }

    console.log('[deep-reclassify] applied', {
      leadId,
      windowIndex,
      from: ctx.lead.stage_id,
      to: decision.to_stage_id,
    })
    void userId
  } catch (e) {
    console.error('[deep-reclassify] threw', e)
  }
}

// ---------------------------------------------------------------------------
// Context loader
// ---------------------------------------------------------------------------

async function loadContext(
  admin: SupabaseClient,
  leadId: string,
  threadId: string,
): Promise<DeepContext | null> {
  try {
    const { data: lead, error: leadErr } = await admin
      .from('leads')
      .select('id, user_id, name, stage_id, entered_stage_at, score')
      .eq('id', leadId)
      .maybeSingle()

    if (leadErr || !lead) return null

    const userId = (lead as LeadRow).user_id

    const [
      { data: stages },
      { data: messages },
      { data: events },
      { data: submissions },
      { data: pages },
    ] = await Promise.all([
      admin
        .from('pipeline_stages')
        .select('id, name, kind, position, description, entry_signals, exit_signals')
        .eq('user_id', userId)
        .order('position', { ascending: true }),
      admin
        .from('messenger_messages')
        .select('direction, body, created_at')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: true })
        .limit(60),
      admin
        .from('lead_stage_events')
        .select('id, from_stage_id, to_stage_id, source, reason, confidence, created_at')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
        .limit(20),
      admin
        .from('action_page_submissions')
        .select('id, outcome, created_at, action_page_id')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
        .limit(10),
      admin
        .from('action_pages')
        .select('id, title, kind')
        .eq('user_id', userId),
    ])

    return {
      lead: lead as LeadRow,
      stages: (stages ?? []) as StageRow[],
      messages: (messages ?? []) as MessageRow[],
      events: (events ?? []) as EventRow[],
      submissions: (submissions ?? []) as SubmissionRow[],
      pages: (pages ?? []) as PageRow[],
    }
  } catch (e) {
    console.error('[deep-reclassify] loadContext threw', e)
    return null
  }
}

// ---------------------------------------------------------------------------
// LLM call
// ---------------------------------------------------------------------------

async function callLlm(ctx: DeepContext): Promise<DeepDecision | null> {
  const llm = createLlm()
  const system = buildSystemPrompt(ctx)
  const userBlock = buildUserBlock(ctx)

  const raw = await llm.complete(
    [
      { role: 'system', content: system },
      { role: 'user', content: userBlock },
    ],
    { temperature: 0, maxTokens: 400, responseFormat: 'json_object' },
  )

  return coerceDecision(raw)
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildSystemPrompt(ctx: DeepContext): string {
  const currentStage = ctx.stages.find((s) => s.id === ctx.lead.stage_id)

  const stageListText = ctx.stages
    .map((s) => {
      const entry = (s.entry_signals ?? []).map((sig) => `    • ${sig}`).join('\n')
      const exit = (s.exit_signals ?? []).map((sig) => `    • ${sig}`).join('\n')
      return (
        `- id=${s.id} name="${s.name}" kind=${s.kind} pos=${s.position}\n` +
        (s.description ? `  description: ${s.description}\n` : '') +
        (entry ? `  enter_when (≥1 must be observed):\n${entry}\n` : '') +
        (exit ? `  leave_when:\n${exit}` : '')
      )
    })
    .join('\n\n')

  return (
    'You are a deep sales-pipeline classifier. ' +
    'Analyse the full conversation history, form submissions, and prior stage transitions ' +
    'to decide whether this lead should move to a different pipeline stage.\n\n' +
    'Each stage has explicit ENTER signals — ≥1 must be observed in the lead\'s behaviour ' +
    'before you can move them in. The conversation may be in English, Tagalog, Taglish, or any language.\n\n' +
    'Output JSON only, matching this schema exactly:\n' +
    '{"stage_change": {' +
    '"to_stage_id": string, ' +
    '"move_type": "adjacent_forward"|"skip_ahead"|"into_terminal"|"into_objection"|"out_of_objection"|"backward", ' +
    '"confidence": "low"|"medium"|"high", ' +
    '"matched_signals": string[], ' +
    '"reason": string' +
    '} | null}\n\n' +
    'Rules for move_type:\n' +
    '  - adjacent_forward: target position is exactly current position + 1. SPECIAL CASE: if current kind=objection, target can be the stage the lead occupied immediately before entering Objection (visible in prior stage transitions).\n' +
    '  - skip_ahead: target position is more than 1 greater than current.\n' +
    '  - into_terminal: target is Won or Lost (kind=won|lost).\n' +
    '  - into_objection: target kind=objection.\n' +
    '  - out_of_objection: current kind=objection and target is non-objection.\n' +
    '  - backward: target position is lower than current and not an objection move.\n\n' +
    'Return null when no move is warranted.\n' +
    'matched_signals MUST list the exact text of enter_when signals you observed, copied verbatim from the stage list above. Do not paraphrase, shorten, or condense.\n' +
    'If no enter_when signal is observed, return null.\n\n' +
    `Current stage: id=${ctx.lead.stage_id}` +
    (currentStage ? ` name="${currentStage.name}" kind=${currentStage.kind}` : '') +
    '\n\n' +
    'Available stages:\n' +
    stageListText
  )
}

function buildUserBlock(ctx: DeepContext): string {
  const conversationLines = ctx.messages
    .map((m) => `[${m.direction === 'inbound' ? 'LEAD' : 'BOT'}] ${m.body}`)
    .join('\n')

  const eventLines =
    ctx.events.length > 0
      ? ctx.events
          .map(
            (e) =>
              `- ${e.created_at}: ${e.from_stage_id ?? 'start'} → ${e.to_stage_id} (${e.source}, ${e.confidence ?? 'n/a'}${e.reason ? ': ' + e.reason : ''})`,
          )
          .join('\n')
      : 'None'

  const submissionLines =
    ctx.submissions.length > 0
      ? ctx.submissions
          .map((sub) => {
            const page = ctx.pages.find((p) => p.id === sub.action_page_id)
            return `- ${sub.created_at}: ${page ? page.title : sub.action_page_id} (${sub.outcome})`
          })
          .join('\n')
      : 'None'

  return (
    `Lead name: ${ctx.lead.name}\n` +
    `Score: ${ctx.lead.score ?? 'n/a'}\n` +
    `In current stage since: ${ctx.lead.entered_stage_at}\n\n` +
    `## Conversation (oldest → newest)\n${conversationLines || 'No messages'}\n\n` +
    `## Prior stage transitions\n${eventLines}\n\n` +
    `## Form submissions\n${submissionLines}\n\n` +
    `Decide the correct stage_id for this lead, or null if no change is warranted.`
  )
}

// ---------------------------------------------------------------------------
// Decision coercion — only accepts high confidence
// ---------------------------------------------------------------------------

function coerceDecision(raw: string): DeepDecision | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const p = parsed as { stage_change?: unknown }
    const sc = p.stage_change
    if (!sc || typeof sc !== 'object') return null
    const s = sc as { to_stage_id?: unknown; confidence?: unknown; reason?: unknown }
    if (
      typeof s.to_stage_id !== 'string' ||
      typeof s.reason !== 'string' ||
      s.confidence !== 'high'
    ) {
      return null
    }
    return { to_stage_id: s.to_stage_id, confidence: 'high', reason: s.reason }
  } catch {
    return null
  }
}
