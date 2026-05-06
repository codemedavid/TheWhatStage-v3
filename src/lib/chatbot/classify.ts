import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { dispatchStageEntered } from '@/lib/workflow/dispatcher'
import {
  HfRouterLlm,
  buildPrompt,
  createEmbedder,
  createReranker,
  retrieve,
} from '@/lib/rag'
import { ragConfig } from '@/lib/rag/config'
import { getChatbotConfig } from './config'
import type { AnswerHistory, AnswerOptions, AnswerResult } from './answer'

export interface StageBrief {
  id: string
  name: string
  description: string | null
}

export interface StageChange {
  to_stage_id: string
  confidence: 'low' | 'medium' | 'high'
  reason: string
}

export interface ActionPageBrief {
  id: string
  title: string
  cta_label: string
  bot_send_instructions: string
}

export interface ActionPageChoice {
  action_page_id: string
  reason: string
  button_text: string
}

export interface AnswerWithClassificationResult extends AnswerResult {
  stageChange: StageChange | null
  actionPage: ActionPageChoice | null
}

/**
 * Single LLM call that returns BOTH a customer-facing reply and (optionally) a
 * stage classification decision. Falls back to a plain reply on JSON parse
 * failure so a malformed classifier output never blocks the bot reply.
 */
export async function answerWithClassification(
  supabase: SupabaseClient,
  userId: string,
  message: string,
  history: AnswerHistory,
  stages: StageBrief[],
  currentStageId: string | null,
  options: AnswerOptions & { actionPages?: ActionPageBrief[] } = {},
): Promise<AnswerWithClassificationResult> {
  const baseConfig = await getChatbotConfig(supabase, userId)
  const cp = options.campaignPersona
  const config = cp
    ? {
        ...baseConfig,
        ...(cp.persona ? { persona: cp.persona } : {}),
        doRules: [...baseConfig.doRules, ...(cp.doRules ?? [])],
        dontRules: [...baseConfig.dontRules, ...(cp.dontRules ?? [])],
        ...(cp.funnelInstruction ? { funnelInstruction: cp.funnelInstruction } : {}),
      }
    : baseConfig

  const embedder = createEmbedder()
  const reranker = createReranker()
  const llm = new HfRouterLlm()

  const ctx = await retrieve(
    {
      client: supabase,
      embedder,
      reranker,
      rewriteQuery: (q) => llm.rewriteQuery(q),
      rpcName: options.rpcName,
    },
    { userId, query: message },
  )

  const built = buildPrompt({
    userQuery: message,
    buckets: ctx.buckets,
    config,
    maxContext: config.maxContext,
    conversationSummary: options.conversationSummary,
  })

  const actionPages = options.actionPages ?? []
  const stageSystem = stageInstruction(stages, currentStageId, actionPages)
  const system = `${built.system}\n\n${stageSystem}`

  const raw = await llm.complete(
    [
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: built.user },
    ],
    { temperature: config.temperature, maxTokens: 1600, responseFormat: 'json_object' },
  )

  const parsed = parseJson(raw)
  let text = ''
  let stageChange: StageChange | null = null
  let actionPage: ActionPageChoice | null = null
  if (parsed && typeof parsed === 'object') {
    const r = parsed as { reply?: unknown; stage_change?: unknown; action_page?: unknown }
    if (typeof r.reply === 'string') text = r.reply.trim()
    stageChange = coerceStageChange(r.stage_change, stages, currentStageId)
    actionPage = coerceActionPage(r.action_page, actionPages)
  }

  // Fallback: if JSON parse / shape failed, run a plain follow-up generation
  // so the customer still gets a reply. Skip stage change in this branch.
  if (!text) {
    const fallback = await llm.complete(
      [
        { role: 'system', content: built.system },
        ...history,
        { role: 'user', content: built.user },
      ],
      { temperature: config.temperature, maxTokens: 1500 },
    )
    text = fallback.trim()
    stageChange = null
    actionPage = null
  }

  const sourceTitles = await resolveSourceTitles(supabase, userId, built.contextChunkIds)
  return { text, sourceTitles, media: [], stageChange, actionPage }
}

/**
 * Lightweight classifier-only call. No RAG, no big model — used when the bot
 * is OFF for a thread and we only want to decide stage placement.
 */
export async function classifyOnly(
  history: AnswerHistory,
  latestMessage: string,
  stages: StageBrief[],
  currentStageId: string | null,
): Promise<StageChange | null> {
  const llm = new HfRouterLlm({ model: ragConfig.classifierModel })
  const system =
    'You classify which pipeline stage a sales lead belongs to based on the conversation. ' +
    'Output JSON only, matching this schema exactly: ' +
    '{"stage_change": {"to_stage_id": string, "confidence": "low"|"medium"|"high", "reason": string} | null}. ' +
    'Return null when the lead should stay in the current stage. ' +
    'Use only stage_ids from the provided list.\n\n' +
    stageList(stages, currentStageId)

  const userBlock =
    `Conversation so far (most recent last):\n${formatHistory(history)}\n\n` +
    `Latest customer message:\n${latestMessage}\n\n` +
    `Decide the correct stage_id for this lead, or null if no change.`

  const raw = await llm.complete(
    [
      { role: 'system', content: system },
      { role: 'user', content: userBlock },
    ],
    { temperature: 0, maxTokens: 200, responseFormat: 'json_object' },
  )
  const parsed = parseJson(raw)
  if (!parsed || typeof parsed !== 'object') return null
  return coerceStageChange((parsed as { stage_change?: unknown }).stage_change, stages, currentStageId)
}

/**
 * Apply a validated stage change. Returns null when the change was rejected
 * (low confidence, no-op, unknown stage) or the RPC declined it.
 * Never throws — caller can safely fire-and-forget.
 */
export async function applyStageChange(
  admin: SupabaseClient,
  args: {
    leadId: string
    userId: string
    threadId: string | null
    fromStageId: string | null
    change: StageChange
    stages: StageBrief[]
  },
): Promise<string | null> {
  try {
    const { leadId, threadId, fromStageId, change, stages } = args
    if (change.confidence === 'low') return null
    if (change.to_stage_id === fromStageId) return null
    if (!stages.some((s) => s.id === change.to_stage_id)) return null

    const idempotencyKey = `classify:${threadId}:${leadId}`
    const { data, error } = await admin
      .rpc('set_lead_stage', {
        p_lead_id: leadId,
        p_to_stage_id: change.to_stage_id,
        p_source: 'classifier',
        p_reason: change.reason?.slice(0, 500) ?? null,
        p_idempotency_key: idempotencyKey,
        p_expected_version: null,
        p_confidence: change.confidence,
        p_thread_id: threadId ?? null,
      })
    if (error) {
      console.error('[classify] applyStageChange rpc failed', error.message)
      return null
    }
    if (data) {
      const adminClient = createAdminClient()
      // Fire-and-forget — trigger dispatch must never block the reply path.
      dispatchStageEntered(adminClient, {
        userId: args.userId,
        leadId,
        threadId: threadId ?? null,
        toStageId: change.to_stage_id,
        fromStageId: fromStageId ?? null,
        idempotencyKey,
      }).catch((e) => console.error('[classify] dispatchStageEntered threw', e))
    }
    return data ? leadId : null
  } catch (e) {
    console.error('[classify] applyStageChange threw', e)
    return null
  }
}

function stageInstruction(
  stages: StageBrief[],
  currentStageId: string | null,
  actionPages: ActionPageBrief[],
): string {
  const hasActionPages = actionPages.length > 0
  const schema = hasActionPages
    ? '{"reply": string, "stage_change": {"to_stage_id": string, "confidence": "low"|"medium"|"high", "reason": string} | null, "action_page": {"action_page_id": string, "reason": string, "button_text": string} | null}'
    : '{"reply": string, "stage_change": {"to_stage_id": string, "confidence": "low"|"medium"|"high", "reason": string} | null}'
  const apSection = hasActionPages
    ? '\n\n' +
      'ACTION PAGES — INTERNAL ROUTING ONLY:\n' +
      'When the latest customer message matches one action page\'s "send when" guidance, set `action_page.action_page_id` to that page\'s id. ' +
      'Pick at most one. Only use action_page_ids from the list below. ' +
      'The system will automatically attach the button as a SEPARATE message right after your reply — you do NOT need to send, link, or describe the button yourself.\n\n' +
      'STRICT REPLY RULES when attaching an action page:\n' +
      '- `reply` must be a normal conversational message — respond to what the customer said, nothing else.\n' +
      '- Do NOT mention the button, form, booking link, or action page in `reply` at all. The system will send the button as a completely separate message automatically.\n' +
      '- NEVER copy, paraphrase, or echo the "send when" guidance text into `reply`.\n' +
      '- NEVER write any reference to a form, link, button, or action page in `reply` — in ANY language (English, Tagalog, Taglish, or other). This includes but is not limited to: "Fill out the form", "I-fill out ang form", "heto ang link", "link sa form", "i-click ang button", "Check the link", etc.\n' +
      '- NEVER insert placeholder text like "[Insert Link]", "[form link here]", "[link]", or any bracketed template. If you would normally insert a link or URL, do NOT — the system sends the button separately.\n' +
      '- The "send when" text below is INTERNAL routing guidance only — never mention it or act on it in the reply text.\n\n' +
      'BUTTON_TEXT RULES (the card caption shown above the button):\n' +
      '- Write a short, action-pushing call-to-action in the SAME language as the customer (e.g. Tagalog/Taglish if they wrote Tagalog).\n' +
      '- Max ~80 chars. One line. No greetings, no page title, no URL.\n' +
      '- Include a downward-pointing emoji like 👇 (or 📝/📅 when fitting) to draw the eye to the button.\n' +
      '- Examples: "I-tap ang button sa baba para mag-book ng call 👇", "Fill out the quick form below 👇".\n' +
      '- NEVER use the action page title (e.g. "Lead Gen", "Booking") as the button_text.\n\n' +
      actionPageList(actionPages)
    : ''
  return (
    'You are also responsible for classifying the lead\'s pipeline stage' +
    (hasActionPages ? ' and deciding whether to attach an action page button to your reply' : '') +
    '. Output a single JSON object with this exact shape and NOTHING ELSE:\n' +
    schema +
    '\n`reply` is what the customer sees — write it in the same persona/rules above. ' +
    '`stage_change` is null when the lead should stay in the current stage. ' +
    'Only use stage_ids from the list. Pick the stage whose description best matches the customer\'s intent in the latest message + conversation.\n\n' +
    stageList(stages, currentStageId) +
    apSection
  )
}

function actionPageList(pages: ActionPageBrief[]): string {
  const lines = pages.map((p) => {
    const guide = p.bot_send_instructions.trim() || '(no guidance — never send)'
    return `- id: ${p.id}\n  title: ${p.title}\n  cta: ${p.cta_label}\n  send when: ${guide}`
  })
  return `Action pages:\n${lines.join('\n')}`
}

function coerceActionPage(
  raw: unknown,
  pages: ActionPageBrief[],
): ActionPageChoice | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { action_page_id?: unknown; reason?: unknown; button_text?: unknown }
  const id = typeof r.action_page_id === 'string' ? r.action_page_id : null
  if (!id) return null
  if (!pages.some((p) => p.id === id)) return null
  const reason = typeof r.reason === 'string' ? r.reason : ''
  const button_text =
    typeof r.button_text === 'string' ? r.button_text.trim().slice(0, 200) : ''
  return { action_page_id: id, reason, button_text }
}

function stageList(stages: StageBrief[], currentStageId: string | null): string {
  const lines = stages.map((s) => {
    const cur = s.id === currentStageId ? '  [CURRENT]' : ''
    const desc = (s.description ?? '').trim() || '(no description)'
    return `- id: ${s.id}${cur}\n  name: ${s.name}\n  description: ${desc}`
  })
  return `Pipeline stages:\n${lines.join('\n')}`
}

function formatHistory(history: AnswerHistory): string {
  if (history.length === 0) return '(no prior messages)'
  return history
    .map((m) => `${m.role === 'assistant' ? 'Bot' : 'Customer'}: ${m.content}`)
    .join('\n')
}

function parseJson(raw: string): unknown {
  if (!raw) return null
  // Some models wrap JSON in fences even with response_format set.
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')
  try {
    return JSON.parse(stripped)
  } catch {
    // Try to extract the first {...} block.
    const m = stripped.match(/\{[\s\S]*\}/)
    if (!m) return null
    try {
      return JSON.parse(m[0])
    } catch {
      return null
    }
  }
}

function coerceStageChange(
  raw: unknown,
  stages: StageBrief[],
  currentStageId: string | null,
): StageChange | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { to_stage_id?: unknown; confidence?: unknown; reason?: unknown }
  const id = typeof r.to_stage_id === 'string' ? r.to_stage_id : null
  if (!id) return null
  if (id === currentStageId) return null
  if (!stages.some((s) => s.id === id)) return null
  const confidence =
    r.confidence === 'high' || r.confidence === 'medium' || r.confidence === 'low'
      ? r.confidence
      : 'medium'
  const reason = typeof r.reason === 'string' ? r.reason : ''
  return { to_stage_id: id, confidence, reason }
}

async function resolveSourceTitles(
  supabase: SupabaseClient,
  userId: string,
  chunkIds: string[],
): Promise<string[]> {
  if (chunkIds.length === 0) return []
  const { data: chunks } = await supabase
    .from('knowledge_chunks')
    .select('id, document_id, faq_id')
    .eq('user_id', userId)
    .in('id', chunkIds)
  if (!chunks || chunks.length === 0) return []

  const docIds = Array.from(new Set(chunks.map((c) => c.document_id).filter(Boolean) as string[]))
  const faqIds = Array.from(new Set(chunks.map((c) => c.faq_id).filter(Boolean) as string[]))
  const [docsRes, faqsRes] = await Promise.all([
    docIds.length
      ? supabase.from('knowledge_documents').select('id, title').in('id', docIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    faqIds.length
      ? supabase.from('knowledge_faqs').select('id, question').in('id', faqIds)
      : Promise.resolve({ data: [] as { id: string; question: string }[] }),
  ])
  const docTitle = new Map((docsRes.data ?? []).map((d) => [d.id, d.title]))
  const faqTitle = new Map((faqsRes.data ?? []).map((f) => [f.id, f.question]))
  const seen = new Set<string>()
  const titles: string[] = []
  for (const c of chunks) {
    const title =
      (c.document_id && docTitle.get(c.document_id)) ||
      (c.faq_id && faqTitle.get(c.faq_id)) ||
      null
    if (title && !seen.has(title)) {
      seen.add(title)
      titles.push(title)
    }
  }
  return titles
}
