import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActionPageBrief, ActionPageChoice, StageBrief, StageChange } from '@/lib/chatbot/classify'
import type { AnswerHistory } from '@/lib/chatbot/answer'
import { leadCacheGet, leadCacheSet } from '@/lib/leads/cache'
import { HfRouterLlm } from '@/lib/rag'
import { ragConfig } from '@/lib/rag/config'

const SKIP_STAGE_KINDS = new Set(['lost', 'dormant', 'won'])

export function isSendableStage(stage: StageBrief | null): boolean {
  if (!stage) return true
  return !SKIP_STAGE_KINDS.has(stage.kind)
}

export function resolveFallbackFromList(
  primaryId: string | null,
  pages: ActionPageBrief[],
): ActionPageBrief | null {
  if (primaryId) return pages.find((p) => p.id === primaryId) ?? null
  return pages[0] ?? null
}

const PROCEED_RE =
  /\b(sige|kunin ko|let'?s go|i'?m in|game na|okay na|magkano|how (do i|much)|paano (mag|sumali|umorder|magbayad|avail)|sign me up|book na|tara|gusto ko na|ready na|proceed|interested po|payment|bayad)\b/i

export function detectProceedRegex(message: string): boolean {
  if (!message) return false
  return PROCEED_RE.test(message)
}

// A customer asking WHERE or HOW to fill up the form is explicitly requesting the
// link — the strongest possible send signal (stronger than generic proceed
// intent). Covers EN / TL / Taglish: "Where to fill up?", "saan po mag-fill up",
// "paano mag-fill up", "san yung form", "anong link". This is the exact reported
// bug: the customer asked "Where to fill up?" and got prose with no button.
const FORM_REQUEST_RE =
  /\b(?:where|saan|san)\b[^.?!\n]*\b(?:fill[-\s]*up|form|link|mag[-\s]?fill)\b|\b(?:pa?ano|how)\b[^.?!\n]*\b(?:fill[-\s]*up|mag[-\s]?fill)\b|\ban[oó]ng?\b[^.?!\n]*\blink\b|\bwhere'?s\s+the\s+form\b/i

export function detectFormRequest(message: string): boolean {
  if (!message) return false
  return FORM_REQUEST_RE.test(message)
}

const FORWARD_KINDS = new Set(['qualifying', 'decision', 'won'])

export function detectStageForward(
  change: StageChange | null,
  currentPosition: number | null,
  stages: StageBrief[],
): boolean {
  if (!change) return false
  const to = stages.find((s) => s.id === change.to_stage_id)
  if (!to) return false
  if (FORWARD_KINDS.has(to.kind)) return true
  if (currentPosition === null) return true
  return to.position >= currentPosition
}

const QUALIFIED_STAGE_KINDS = new Set(['qualifying', 'decision'])

export function isStageQualified(stage: StageBrief | null): boolean {
  if (!stage) return false
  return QUALIFIED_STAGE_KINDS.has(stage.kind)
}

interface SubmissionRow {
  outcome: string | null
  action_pages: { kind: string } | { kind: string }[] | null
}

export async function hasQualifiedQuizSubmission(
  supabase: SupabaseClient,
  leadId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('action_page_submissions')
    .select('outcome, action_pages(kind)')
    .eq('lead_id', leadId)
    .eq('outcome', 'qualified')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error || !data) return false

  for (const row of data as unknown as SubmissionRow[]) {
    if (row.outcome !== 'qualified') continue
    const ap = Array.isArray(row.action_pages) ? row.action_pages[0] : row.action_pages
    if (ap?.kind === 'qualification') return true
  }
  return false
}

export interface LlmCheckClient {
  checkPrerequisites(args: { instructionsText: string; history: AnswerHistory }): Promise<boolean>
}

export function hashInstructions(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

interface CacheEntry {
  hash: string
  allAnswered: true
}

const CACHE_NS = 'qual_check'

export async function prerequisitesAnsweredCached(args: {
  leadId: string
  actionPageId: string
  instructionsText: string
  history: AnswerHistory
  llm: LlmCheckClient
}): Promise<boolean> {
  const text = args.instructionsText.trim()
  if (!text) return true

  const hash = hashInstructions(text)
  const cached = leadCacheGet<CacheEntry>(CACHE_NS, args.leadId, args.actionPageId)
  if (cached && cached.hash === hash) return true

  const ok = await args.llm.checkPrerequisites({ instructionsText: text, history: args.history })
  if (ok) {
    leadCacheSet<CacheEntry>(CACHE_NS, args.leadId, args.actionPageId, {
      hash,
      allAnswered: true,
    })
  }
  return ok
}

export function parseLlmJsonResponse(raw: string): { ok: boolean } {
  if (!raw) return { ok: false }
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    const m = stripped.match(/\{[\s\S]*?\}/)
    if (!m) return { ok: false }
    try {
      parsed = JSON.parse(m[0])
    } catch {
      return { ok: false }
    }
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false }
  const ok = (parsed as { ok?: unknown }).ok
  return { ok: ok === true }
}

function formatRecentHistory(history: AnswerHistory, maxTurns = 6): string {
  if (history.length === 0) return '(no prior messages)'
  return history
    .slice(-maxTurns)
    .map((m) => `${m.role === 'assistant' ? 'Bot' : 'Customer'}: ${m.content}`)
    .join('\n')
}

export const defaultLlmCheckClient: LlmCheckClient & {
  detectProceed(args: { history: AnswerHistory }): Promise<boolean>
} = {
  async checkPrerequisites({ instructionsText, history }) {
    const llm = new HfRouterLlm({ model: ragConfig.classifierModel })
    const system =
      'You decide whether every prerequisite question listed in the operator\'s "send when" guidance has already been answered in the conversation. ' +
      'Return JSON only: {"ok": true} when EVERY prerequisite is visibly answered (in any language), otherwise {"ok": false}. ' +
      'A prerequisite is anything the guidance says to collect/ask/confirm first (e.g. "ask budget first", "only after they share location", "kapag nasagot na ang …").'
    const user =
      `OPERATOR "SEND WHEN" GUIDANCE:\n${instructionsText}\n\n` +
      `CONVERSATION (most recent last):\n${formatRecentHistory(history)}\n\n` +
      'Return JSON only.'
    const raw = await llm.complete(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0, maxTokens: 60, responseFormat: 'json_object' },
    )
    return parseLlmJsonResponse(raw).ok
  },

  async detectProceed({ history }) {
    const llm = new HfRouterLlm({ model: ragConfig.classifierModel })
    const system =
      'You decide whether the customer\'s latest message signals they want to PROCEED, BUY, BOOK, SIGN UP, AVAIL, or otherwise take the next step. ' +
      'Return JSON only: {"ok": true} when there\'s any forward-intent signal (in any language, including Tagalog/Taglish), otherwise {"ok": false}. ' +
      'Examples that are TRUE: "sige", "kunin ko na", "magkano", "paano mag-avail", "I\'m in", "book na", "tara". ' +
      'Examples that are FALSE: greetings, generic questions, "thinking about it", "maybe later".'
    const user = `CONVERSATION (most recent last):\n${formatRecentHistory(history)}\n\nReturn JSON only.`
    const raw = await llm.complete(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0, maxTokens: 30, responseFormat: 'json_object' },
    )
    return parseLlmJsonResponse(raw).ok
  },
}

export interface ForceSendContext {
  userId: string
  leadId: string | null
  threadId: string | null
  history: AnswerHistory
  latestCustomerMessage: string
  currentStage: StageBrief | null
  stages: StageBrief[]
  stageChangeThisTurn: StageChange | null
  llmActionPage: ActionPageChoice | null
  actionPages: ActionPageBrief[]
  primaryActionPageId: string | null
  supabase: SupabaseClient
  llm?: LlmCheckClient & { detectProceed(args: { history: AnswerHistory }): Promise<boolean> }
  /** True when the model teased a link/form in `reply` (e.g. "eto na po yung
   *  form") but left the structured action_page null. The tease is itself an
   *  explicit "send it now" decision, so we force-send the fallback page and
   *  bypass the qualification + readiness gates. Stage/page guards still apply. */
  teasedLinkThisTurn?: boolean
}

export interface ForceSendDecision {
  actionPage: ActionPageChoice | null
  overrideFired: boolean
  reason: string
}

/** A forced action-page choice. The button text/label are left empty on
 *  purpose so the Messenger worker falls back to its guiding caption + the
 *  page's configured cta_label. Shared by every override path so the shape
 *  never drifts between them. */
function buildForcedChoice(pageId: string, reason: string): ActionPageChoice {
  return { action_page_id: pageId, reason, button_text: '', button_label: '' }
}

export async function decideForceSend(ctx: ForceSendContext): Promise<ForceSendDecision> {
  const llm = ctx.llm ?? defaultLlmCheckClient

  if (!isSendableStage(ctx.currentStage)) {
    return { actionPage: ctx.llmActionPage, overrideFired: false, reason: 'skip:stage' }
  }

  const page = resolveFallbackFromList(ctx.primaryActionPageId, ctx.actionPages)
  if (!page) {
    return { actionPage: ctx.llmActionPage, overrideFired: false, reason: 'skip:no-page' }
  }

  const hadPriorCustomerTurn = ctx.history.some((m) => m.role === 'user')
  if (!hadPriorCustomerTurn) {
    return { actionPage: ctx.llmActionPage, overrideFired: false, reason: 'skip:cold-inbound' }
  }

  // Tease recovery: the model already decided to send a form this turn (it
  // teased it in prose) but forgot to fill the structured field. Attaching the
  // fallback page now is the whole point — a missed action page kills the sale.
  // We deliberately bypass the qualification + readiness gates (the tease IS the
  // readiness signal) and the leadId guard (the deeplink is attributed by
  // psid + page_id, not leadId — see route.ts). The stage, page, and
  // cold-inbound guards above still apply, so we never blast a form on a first
  // cold inbound or in a lost/won/dormant stage.
  if (ctx.teasedLinkThisTurn) {
    return {
      actionPage: buildForcedChoice(page.id, 'tease-recovery: model teased a form without attaching it'),
      overrideFired: true,
      reason: 'override:tease',
    }
  }

  // Explicit form-location request ("Where to fill up?", "saan po mag-fill up").
  // The customer is literally asking for the link — the strongest send signal
  // there is, so (like the tease path) we bypass the qualification + readiness
  // gates AND the leadId guard (the deeplink is attributed by psid + page_id, not
  // leadId). The stage, page, and cold-inbound guards above still apply, so we
  // never blast a form on a first cold inbound or in a lost/won/dormant stage.
  if (detectFormRequest(ctx.latestCustomerMessage)) {
    return {
      actionPage: buildForcedChoice(page.id, 'form-request: customer asked where to fill up the form'),
      overrideFired: true,
      reason: 'override:form-request',
    }
  }

  if (!ctx.leadId) {
    return { actionPage: ctx.llmActionPage, overrideFired: false, reason: 'skip:no-lead' }
  }

  if (ctx.llmActionPage && ctx.llmActionPage.action_page_id === page.id) {
    return { actionPage: ctx.llmActionPage, overrideFired: false, reason: 'noop:llm-already-picked' }
  }

  let qualified = isStageQualified(ctx.currentStage)
  if (!qualified) qualified = await hasQualifiedQuizSubmission(ctx.supabase, ctx.leadId)
  if (!qualified) {
    qualified = await prerequisitesAnsweredCached({
      leadId: ctx.leadId,
      actionPageId: page.id,
      instructionsText: page.bot_send_instructions ?? '',
      history: ctx.history,
      llm,
    })
  }
  if (!qualified) {
    return { actionPage: ctx.llmActionPage, overrideFired: false, reason: 'skip:not-qualified' }
  }

  let ready = detectProceedRegex(ctx.latestCustomerMessage)
  if (!ready) {
    ready = detectStageForward(
      ctx.stageChangeThisTurn,
      ctx.currentStage?.position ?? null,
      ctx.stages,
    )
  }
  if (!ready) ready = await llm.detectProceed({ history: ctx.history })
  if (!ready) {
    return { actionPage: ctx.llmActionPage, overrideFired: false, reason: 'skip:not-ready' }
  }

  return {
    actionPage: buildForcedChoice(page.id, 'force-send: qualified + ready'),
    overrideFired: true,
    reason: 'override',
  }
}
