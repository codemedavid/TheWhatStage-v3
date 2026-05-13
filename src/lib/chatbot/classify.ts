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
import {
  getActionPageRecommendationRules,
  getChatbotConfig,
  type ActionPageRecommendationRules,
} from './config'
import { selectMediaForReply, type SelectedMediaAsset } from '@/lib/media/selector'
import type { AnswerHistory, AnswerOptions, AnswerResult } from './answer'

export interface StageBrief {
  id: string
  name: string
  description: string | null
  /** 0-based ordering within the user's pipeline. Lower = earlier. */
  position: number
  /** Pipeline-stage semantic kind. Drives hierarchy reasoning in the prompt. */
  kind: 'entry' | 'qualifying' | 'nurture' | 'decision' | 'won' | 'lost' | 'dormant'
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

export interface ProductRecommendationRequest {
  /** Distilled query the LLM extracted from the conversation, used for retrieval. */
  query: string
  /** Filters the LLM extracted (budget range, tags). All optional. */
  filters: {
    priceMin: number | null
    priceMax: number | null
    tags: string[]
  }
  /** The action page id whose catalog should be searched. */
  actionPageId: string
  /** Threshold to apply when matching — comes from the page's rules. */
  confidenceThreshold: number
}

export type PropertyRecommendationRequest = ProductRecommendationRequest

export interface AnswerWithClassificationResult extends AnswerResult {
  stageChange: StageChange | null
  actionPage: ActionPageChoice | null
  productRecommendation: ProductRecommendationRequest | null
  propertyRecommendation: PropertyRecommendationRequest | null
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
  options: AnswerOptions & {
    actionPages?: ActionPageBrief[]
    /** When the lead is on a catalog action page, pass its id so we can attach
     *  the matching recommendation rules from chatbot_configs.recommendation_rules. */
    activeCatalogPageId?: string | null
    /** Same idea, but for a realestate action page — gates `recommend_property`. */
    activeRealestatePageId?: string | null
  } = {},
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
        ...(cp.instructions !== undefined ? { instructions: cp.instructions } : {}),
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
  const recommendRules = getActionPageRecommendationRules(config, options.activeCatalogPageId)
  const recommendPropertyRules = getActionPageRecommendationRules(
    config,
    options.activeRealestatePageId,
  )
  const stageSystem = stageInstruction(
    stages,
    currentStageId,
    actionPages,
    recommendRules,
    recommendPropertyRules,
  )
  const firstName = options.leadName?.split(' ')[0]?.trim()
  const leadNameBlock = firstName
    ? `# Lead\nThe customer's first name is ${firstName}. Address them by their first name when greeting or when it feels natural.`
    : null
  const leadContext = options.leadContextBlock?.trim()
  const system = [built.system, stageSystem, leadNameBlock, leadContext].filter(Boolean).join('\n\n')

  // Scan ALL retrieved chunks (including grader-rejected ones) for @asset /
  // #folder references — a slug-only paragraph often scores low in the
  // reranker and lands in `reject`, which would otherwise hide its image.
  const refChunks = [
    ...ctx.buckets.useful,
    ...ctx.buckets.ambiguous,
    ...ctx.buckets.reject,
  ]
  const mediaPromise = selectMediaForReply({
    client: supabase,
    embedder,
    userId,
    customerMessage: message,
    retrievedChunks: refChunks,
    rpcName: options.rpcName === 'match_knowledge_hybrid_service' ? 'match_media_assets_service' : 'match_media_assets',
    limit: 4,
  }).catch((err) => {
    console.warn('[classify.media] selection failed', err)
    return [] as SelectedMediaAsset[]
  })

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
  let productRecommendation: ProductRecommendationRequest | null = null
  let propertyRecommendation: PropertyRecommendationRequest | null = null
  if (parsed && typeof parsed === 'object') {
    const r = parsed as {
      reply?: unknown
      stage_change?: unknown
      action_page?: unknown
      recommend_product?: unknown
      recommend_property?: unknown
    }
    if (typeof r.reply === 'string') text = r.reply.trim()
    stageChange = coerceStageChange(r.stage_change, stages, currentStageId)
    actionPage = coerceActionPage(r.action_page, actionPages)
    if (recommendRules && options.activeCatalogPageId) {
      productRecommendation = coerceRecommendation(
        r.recommend_product,
        options.activeCatalogPageId,
        recommendRules.confidenceThreshold,
      )
    }
    if (recommendPropertyRules && options.activeRealestatePageId) {
      propertyRecommendation = coerceRecommendation(
        r.recommend_property,
        options.activeRealestatePageId,
        recommendPropertyRules.confidenceThreshold,
      )
    }
  }

  // Fallback: if JSON parse / shape failed, run a plain follow-up generation
  // so the customer still gets a reply. Skip stage change in this branch.
  if (!text) {
    const fallbackSystem = leadContext
      ? `${built.system}\n\n${leadContext}`
      : built.system
    const fallback = await llm.complete(
      [
        { role: 'system', content: fallbackSystem },
        ...history,
        { role: 'user', content: built.user },
      ],
      { temperature: config.temperature, maxTokens: 1500 },
    )
    text = fallback.trim()
    stageChange = null
    actionPage = null
    productRecommendation = null
    propertyRecommendation = null
  }

  const [sourceTitles, media] = await Promise.all([
    resolveSourceTitles(supabase, userId, built.contextChunkIds),
    mediaPromise,
  ])
  return { text, sourceTitles, media, stageChange, actionPage, productRecommendation, propertyRecommendation }
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

export function stageInstruction(
  stages: StageBrief[],
  currentStageId: string | null,
  actionPages: ActionPageBrief[],
  recommendRules: ActionPageRecommendationRules | null,
  recommendPropertyRules: ActionPageRecommendationRules | null,
): string {
  const hasActionPages = actionPages.length > 0
  const hasRecommend = !!recommendRules
  const hasRecommendProperty = !!recommendPropertyRules
  const schemaParts = [
    '"reply": string',
    '"stage_change": {"to_stage_id": string, "confidence": "low"|"medium"|"high", "reason": string} | null',
  ]
  if (hasActionPages) {
    schemaParts.push(
      '"action_page": {"action_page_id": string, "reason": string, "button_text": string} | null',
    )
  }
  if (hasRecommend) {
    schemaParts.push(
      '"recommend_product": {"query": string, "filters": {"price_min": number|null, "price_max": number|null, "tags": string[]}} | null',
    )
  }
  if (hasRecommendProperty) {
    schemaParts.push(
      '"recommend_property": {"query": string, "filters": {"price_min": number|null, "price_max": number|null, "tags": string[]}} | null',
    )
  }
  const schema = `{${schemaParts.join(', ')}}`
  const apSection = hasActionPages
    ? '\n\n' +
      'ACTION PAGES — INTERNAL ROUTING ONLY:\n' +
      'When the latest customer message matches one action page\'s "send when" guidance, set `action_page.action_page_id` to that page\'s id. ' +
      'Pick at most one. Only use action_page_ids from the list below. ' +
      'The system will automatically attach the button as a SEPARATE message right after your reply — you do NOT need to send, link, or describe the button yourself.\n\n' +
      'QUALIFY BEFORE SENDING — read carefully:\n' +
      '- Treat each page\'s "send when" text as TWO things at once: (1) the trigger that finally fires the send, AND (2) a checklist of qualifying info you must collect FIRST. Read it literally and look for prerequisites such as "ask X first", "only after the customer says Y", "make sure they\'ve mentioned Z", "after collecting their budget / timeline / event date / location / business type / etc.", "kapag nasagot na ang … bago", or any similar phrasing in any language.\n' +
      '- If ANY prerequisite from that text is not yet visible in the conversation history, set `action_page` to null and ASK the missing qualifying question in `reply` — one focused question at a time, in the customer\'s language. Do NOT send the button yet.\n' +
      '- Only set `action_page` once EVERY prerequisite has been answered AND the customer\'s latest message clearly fits the trigger. When in doubt, ask one more qualifying question instead of sending.\n' +
      '- A page with no prerequisites in its "send when" text may be sent as soon as the trigger condition matches.\n' +
      '- Never re-ask a question the customer already answered earlier in the thread.\n\n' +
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
  const recommendSection = hasRecommend ? recommendInstruction(recommendRules!, 'product') : ''
  const recommendPropertySection = hasRecommendProperty
    ? recommendInstruction(recommendPropertyRules!, 'property')
    : ''
  const hierarchyBlock =
    'STAGE HIERARCHY RULES — read carefully:\n' +
    '- Stages are listed in pipeline order. Earlier position = earlier in the customer journey.\n' +
    '- The stage NAME is first-class evidence. A customer message clearly invoking the destination stage\'s name (e.g. "cancel my booking", "I\'m ready to buy") is direct evidence to move there.\n' +
    '- Forward moves (later position, or any move into a `won`/`lost` terminal stage) are allowed when the customer\'s intent matches the destination stage\'s description or name.\n' +
    '- Backward moves (earlier position) require BOTH:\n' +
    '    (a) `confidence` = "high", AND\n' +
    '    (b) `reason` MUST cite an explicit disqualifying signal — e.g. customer cancelled, said "not interested", changed their mind, asked to be removed from the funnel.\n' +
    '- Never move backward on tone alone. A frustrated message is not a backward signal unless the customer explicitly disengages.\n' +
    '- If the lead is on the right stage, return `stage_change: null`.'

  return (
    'You are also responsible for classifying the lead\'s pipeline stage' +
    (hasActionPages ? ' and deciding whether to attach an action page button to your reply' : '') +
    (hasRecommend ? ' and deciding whether to recommend a specific product' : '') +
    (hasRecommendProperty ? ' and deciding whether to recommend a specific property listing' : '') +
    '. Output a single JSON object with this exact shape and NOTHING ELSE:\n' +
    schema +
    '\n`reply` is what the customer sees — write it in the same persona/rules above. ' +
    '`stage_change` is null when the lead should stay in the current stage. ' +
    'Only use stage_ids from the list. Pick the stage whose name AND description best match the customer\'s intent in the latest message + conversation history.\n\n' +
    hierarchyBlock +
    '\n\n' +
    stageList(stages, currentStageId) +
    apSection +
    recommendSection +
    recommendPropertySection
  )
}

function recommendInstruction(
  rules: ActionPageRecommendationRules,
  kind: 'product' | 'property',
): string {
  const slotsLine =
    rules.requiredSlots.length > 0
      ? `Required info you must collect FIRST before recommending: ${rules.requiredSlots.join(', ')}.`
      : 'No required slots — you may recommend as soon as the customer\'s need is clear.'
  const fieldName = kind === 'product' ? 'recommend_product' : 'recommend_property'
  const heading = kind === 'product' ? 'PRODUCT RECOMMENDATION' : 'PROPERTY RECOMMENDATION'
  const noun = kind === 'product' ? 'product' : 'property listing'
  return (
    '\n\n' +
    `${heading} — INTERNAL ROUTING ONLY:\n` +
    `Set \`${fieldName}\` ONLY when ONE of these is true:\n` +
    `  (a) The customer EXPLICITLY asks for a recommendation, suggestion, or "what do you have for…".\n` +
    '  (b) The operator rules below tell you to recommend at this point.\n' +
    `Otherwise, set \`${fieldName}\` to null and keep chatting normally.\n\n` +
    `Operator rules: ${rules.rules}\n` +
    slotsLine +
    '\n\n' +
    'When you DO recommend:\n' +
    `- \`query\` is a 1-sentence summary of what the customer is looking for, distilled from the conversation. Used for search — write it in clear English even if the customer wrote Tagalog.\n` +
    '- `filters.price_min` / `filters.price_max` are extracted from any budget the customer mentioned (in PHP, numbers only). null when not mentioned.\n' +
    '- `filters.tags` are short keywords (1–3 words each) the customer cares about. Empty array when none.\n' +
    `- The system will pick the actual ${noun}, send the image and a card AUTOMATICALLY in a SEPARATE message. Do NOT name a specific ${noun}, price, or link in \`reply\`.\n` +
    '- `reply` should be a short, warm acknowledgement like "Got it — let me share the best fit 👇" in the customer\'s language. Do NOT describe the result itself.\n' +
    `- If the required slots are not yet filled, set \`${fieldName}\` to null and ask for the missing info in \`reply\` instead.`
  )
}

function coerceRecommendation(
  raw: unknown,
  actionPageId: string,
  confidenceThreshold: number,
): ProductRecommendationRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { query?: unknown; filters?: unknown }
  const query = typeof r.query === 'string' ? r.query.trim() : ''
  if (!query) return null
  const f =
    r.filters && typeof r.filters === 'object'
      ? (r.filters as { price_min?: unknown; price_max?: unknown; tags?: unknown })
      : {}
  const priceMin =
    typeof f.price_min === 'number' && Number.isFinite(f.price_min) && f.price_min >= 0
      ? f.price_min
      : null
  const priceMax =
    typeof f.price_max === 'number' && Number.isFinite(f.price_max) && f.price_max >= 0
      ? f.price_max
      : null
  const tags = Array.isArray(f.tags)
    ? f.tags
        .map((t) => (typeof t === 'string' ? t.trim() : ''))
        .filter((t): t is string => !!t)
        .slice(0, 8)
    : []
  return {
    query: query.slice(0, 400),
    filters: { priceMin, priceMax, tags },
    actionPageId,
    confidenceThreshold,
  }
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

export function stageList(stages: StageBrief[], currentStageId: string | null): string {
  // Render in position order so the hierarchy is visually obvious.
  const ordered = [...stages].sort((a, b) => a.position - b.position)
  const lines = ordered.map((s) => {
    const cur = s.id === currentStageId ? '  [CURRENT]' : ''
    const desc = (s.description ?? '').trim() || '(no description)'
    return (
      `- [${s.position} · ${s.kind}] ${s.name}${cur}\n` +
      `  id: ${s.id}\n` +
      `  description: ${desc}`
    )
  })
  return `Pipeline stages (in order — earlier first):\n${lines.join('\n')}`
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
