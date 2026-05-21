import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { dispatchStageEntered } from '@/lib/workflow/dispatcher'
import {
  HfRouterLlm,
  buildPrompt,
  createEmbedder,
  retrieve,
} from '@/lib/rag'
import { ragConfig } from '@/lib/rag/config'
import {
  getActionPageRecommendationRules,
  getChatbotConfig,
  type ActionPageRecommendationRules,
} from './config'
import { selectMediaForReply, type SelectedMediaAsset } from '@/lib/media/selector'
import { logChatbotUsage, type AnswerHistory, type AnswerOptions, type AnswerResult } from './answer'
import { decideForceSend } from '@/lib/action-pages/force-send'

export interface StageBrief {
  id: string
  name: string
  description: string | null
  /** 0-based ordering within the user's pipeline. Lower = earlier. */
  position: number
  /** Pipeline-stage semantic kind. Drives hierarchy reasoning in the prompt. */
  kind: 'entry' | 'qualifying' | 'nurture' | 'decision' | 'won' | 'lost' | 'dormant'
  /** Entry signals shown to the classifier. Optional — older call sites omit them. */
  entry_signals?: string[] | null
  /** Exit signals shown to the classifier. Optional — older call sites omit them. */
  exit_signals?: string[] | null
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
    leadId?: string | null
    threadId?: string | null
  } = {},
): Promise<AnswerWithClassificationResult> {
  const baseConfig = options.preloadedConfig ?? (await getChatbotConfig(supabase, userId))
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
  const llm = new HfRouterLlm()

  const ctx = await retrieve(
    {
      client: supabase,
      embedder,
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

  const t0 = Date.now()
  const completion = await llm.completeWithUsage(
    [
      { role: 'system', content: system },
      ...history,
      { role: 'user', content: built.user },
    ],
    // 600 = ~400 tokens of reply + headroom for the JSON envelope and
    // structured fields (stage_change, action_page, recommend_*). The old
    // 1600 ceiling was 4× what we ever actually emit.
    { temperature: config.temperature, maxTokens: 600, responseFormat: 'json_object' },
  )
  const raw = completion.text
  logChatbotUsage('chatbot.classify', {
    model: completion.model,
    promptTokens: completion.usage?.promptTokens ?? null,
    completionTokens: completion.usage?.completionTokens ?? null,
    finishReason: completion.finishReason,
    kbChunks: built.contextChunks.length,
    historyTurns: history.length,
    summaryLen: options.conversationSummary?.length ?? 0,
    systemChars: system.length,
    ms: Date.now() - t0,
  })

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
    const rawReply = typeof r.reply === 'string' ? r.reply : ''
    if (rawReply) text = sanitizeReply(rawReply)
    stageChange = coerceStageChange(r.stage_change, stages, currentStageId)
    actionPage = coerceActionPage(r.action_page, actionPages)
    // The model occasionally announces a link in `reply` ("Eto na yung link…")
    // but doesn't set the structured `action_page` field, so the customer sees
    // a broken promise. sanitizeReply strips the tease sentence, but we log
    // every detection so we can track how often the model misbehaves.
    if (!actionPage && rawReply && rawReply !== text && LINK_TEASE_RE.test(rawReply)) {
      console.warn('[classify.tease] model teased a link with no action_page attached', {
        userId,
        actionPagesAvailable: actionPages.length,
        rawPreview: rawReply.slice(0, 200),
        sanitizedPreview: text.slice(0, 200),
      })
    }
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
    const tFb = Date.now()
    const fb = await llm.completeWithUsage(
      [
        { role: 'system', content: fallbackSystem },
        ...history,
        { role: 'user', content: built.user },
      ],
      { temperature: config.temperature, maxTokens: 400 },
    )
    logChatbotUsage('chatbot.answer.fallback', {
      model: fb.model,
      promptTokens: fb.usage?.promptTokens ?? null,
      completionTokens: fb.usage?.completionTokens ?? null,
      finishReason: fb.finishReason,
      kbChunks: built.contextChunks.length,
      historyTurns: history.length,
      summaryLen: options.conversationSummary?.length ?? 0,
      systemChars: fallbackSystem.length,
      ms: Date.now() - tFb,
    })
    text = sanitizeReply(fb.text)
    stageChange = null
    actionPage = null
    productRecommendation = null
    propertyRecommendation = null
  }

  try {
    const forced = await decideForceSend({
      userId,
      leadId: options.leadId ?? null,
      threadId: options.threadId ?? null,
      history,
      latestCustomerMessage: message,
      currentStage: stages.find((s) => s.id === currentStageId) ?? null,
      stages,
      stageChangeThisTurn: stageChange,
      llmActionPage: actionPage,
      actionPages,
      primaryActionPageId: config.primaryActionPageId ?? null,
      supabase,
    })
    if (forced.overrideFired) {
      console.info('[force-send] override fired', {
        userId,
        leadId: options.leadId ?? null,
        threadId: options.threadId ?? null,
        reason: forced.reason,
        pageId: forced.actionPage?.action_page_id ?? null,
      })
    }
    actionPage = forced.actionPage
  } catch (e) {
    console.error('[force-send] decideForceSend threw — keeping LLM choice', e)
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
    'The conversation may be in English, Tagalog, Taglish, or any language. ' +
    'Output JSON only, matching this schema exactly: ' +
    '{"stage_change": {"to_stage_id": string, "confidence": "low"|"medium"|"high", "reason": string} | null}. ' +
    'Only use stage_ids from the list below.\n\n' +
    'PRIMARY GOAL: keep the lead moving forward. Default to moving forward (with lower confidence) when the customer added any new buying signal. ' +
    'Return null only when the latest message is pure greeting / off-topic / adds nothing new.\n\n' +
    'STAGE HIERARCHY:\n' +
    '- Each stage may list "enter when" signals — paraphrases, Tagalog equivalents, and equivalent intents all count. Do not require literal keyword matches.\n' +
    '- `entry`-kind stages exist to be EXITED — leave them as soon as the customer sends any meaningful inbound.\n' +
    '- Forward moves are encouraged; adjacent-forward is the default. Skip-ahead is allowed when the message clearly fits a later stage.\n' +
    '- Backward moves require confidence="high" AND an explicit disqualifying signal (e.g. "not interested", "ayaw na", "hindi na po ituloy").\n\n' +
    'CONFIDENCE CALIBRATION:\n' +
    '- high   = latest message contains an explicit, direct match for the destination stage (e.g. "interested po", "magkano?", "book na ako", "ayaw na").\n' +
    '- medium = destination is the clear best fit across the last 2–3 customer turns.\n' +
    '- low    = implicit, indirect, or ambiguous signal. Still useful — the system accepts low for one-step-forward moves. Do NOT inflate to medium just to feel safer.\n\n' +
    'EXAMPLES (Tagalog/Taglish):\n' +
    '- "Hi po interested po ako, magkano po?" → move to Interested-equivalent, confidence high.\n' +
    '- "Hello po" (currently on entry-kind stage) → move to first nurture stage, confidence medium.\n' +
    '- "Sige, kunin ko na po. Paano magbayad?" → move to Qualified/Proposal-equivalent, confidence high.\n' +
    '- "Sorry po, hindi na po ituloy." → move to Lost, confidence high, reason cites disengage.\n\n' +
    stageList(stages, currentStageId)

  const userBlock =
    `Conversation so far (most recent last):\n${formatHistory(history)}\n\n` +
    `Latest customer message:\n${latestMessage}\n\n` +
    `Decide the correct stage_id for this lead, or null if no change is warranted.`

  const raw = await llm.complete(
    [
      { role: 'system', content: system },
      { role: 'user', content: userBlock },
    ],
    { temperature: 0, maxTokens: 400, responseFormat: 'json_object' },
  )
  const parsed = parseJson(raw)
  if (!parsed || typeof parsed !== 'object') return null
  return coerceStageChange((parsed as { stage_change?: unknown }).stage_change, stages, currentStageId)
}

/**
 * Apply a validated stage change. Returns null when the change was rejected
 * (insufficient confidence for the kind of move, no-op, unknown stage) or the
 * RPC declined it. Never throws — caller can safely fire-and-forget.
 *
 * Confidence policy — bias toward forward movement:
 *   - `high`   accepted for any move.
 *   - `medium` accepted for any move.
 *   - `low`    accepted ONLY for adjacent-forward moves (position == current+1)
 *              and into-objection moves. The classifier is poorly calibrated
 *              on low/medium, so treating `low` as a hard floor stranded
 *              clearly-interested leads at "New Lead". We trust the structural
 *              guardrails (forward-only, single step) for low confidence.
 *
 *   - low confidence INTO a terminal (won/lost) or SKIPPING ahead more than
 *     one position is still rejected — those are the moves where we want a
 *     stronger signal.
 *   - backward moves still require non-low confidence AND a disqualifying
 *     reason (enforced upstream by the prompt's hierarchy rules).
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
    /** Idempotency suffix — typically the inbound message id. Required to keep
     *  the audit row + workflow trigger unique per move on a thread. Without
     *  it, the second move on the same thread silently drops its audit row
     *  AND its `stage_entered` workflow run (the workflow dispatcher uses the
     *  idempotency_key as part of its dedup key). */
    idempotencySuffix?: string | null
  },
): Promise<string | null> {
  try {
    const { leadId, threadId, fromStageId, change, stages } = args
    if (change.to_stage_id === fromStageId) return null
    if (!stages.some((s) => s.id === change.to_stage_id)) return null

    const from = fromStageId ? stages.find((s) => s.id === fromStageId) ?? null : null
    const to = stages.find((s) => s.id === change.to_stage_id)
    if (!to) return null

    // Backward-move guard. The prompt tells the classifier that backward moves
    // require an explicit disengage signal, but the LLM regularly hallucinates
    // the source stage (e.g. reasons like "moving from entry stage to engaged"
    // when the lead is actually on Interested) and emits high-confidence
    // backward moves anyway. Structurally restrict backward moves to terminal
    // / parking kinds where moving back is a legitimate outcome.
    if (from && to.position < from.position) {
      const allowedBackwardKinds = new Set(['lost', 'dormant', 'objection'])
      if (!allowedBackwardKinds.has(to.kind as string)) {
        console.warn('[classify] rejected backward move', {
          from: from.name,
          to: to.name,
          confidence: change.confidence,
          reason: change.reason?.slice(0, 200),
        })
        return null
      }
    }

    if (change.confidence === 'low') {
      if (!from) return null
      const isAdjacentForward = to.position === from.position + 1
      const isIntoObjection = (to.kind as string) === 'objection'
      if (!isAdjacentForward && !isIntoObjection) return null
    }

    const suffix = args.idempotencySuffix ?? Date.now().toString(36)
    const idempotencyKey = `classify:${threadId}:${leadId}:${suffix}`
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
  // Split the action-page block into a stable prose preamble (placed BEFORE
  // the volatile stageList/actionPageList) and a volatile list (placed at the
  // very end). The preamble text is byte-identical across every turn, so
  // hoisting it above the volatile sections lengthens the cacheable prefix
  // when RAG_PROMPT_LAYOUT=cache_friendly.
  const apPreamble = hasActionPages
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
      'CONCRETE BAD/GOOD EXAMPLES — do not repeat the bad pattern under any circumstance:\n' +
      '- BAD `reply`: "Sige, eto ang link para makita mo kung paano namin inaayos ang ganyang setup: check it" — this paraphrases "here\'s the link" AND inserts a placeholder ("check it"). Both are forbidden. The customer sees this as gibberish because the actual button is sent separately.\n' +
      '- BAD `reply`: "Heto na po ang link 👇", "Click the link below", "I-tap ang link sa baba", "Check this out", "Tingnan mo \'to", "Here\'s the form" — every one of these is a violation, in every language.\n' +
      '- GOOD `reply` (action_page set): "Usually sa ganyang volume, 60–70% talaga nasasayang. Eto na ang ginagawa namin para sa mga ganyang setup —" (warm, conversational, references NOTHING about a link/button/form). The button arrives on its own as a separate message.\n' +
      '- GOOD `reply` (action_page set): "Got it — same pattern as ibang clients namin. Tingnan mo kung magagamit niyo \'to sa team niyo." (no link reference; the button card follows automatically).\n' +
      'IRON RULE: if you find yourself writing the word "link", "button", "form", "check", "tap", "click", "tingnan", "heto", "eto", "here\'s" or any synonym referring to the action page inside `reply`, STOP and rewrite. Set `action_page.action_page_id` instead and let `reply` stay conversational.\n\n' +
      'BUTTON_TEXT RULES (the card caption shown above the button):\n' +
      '- Write a short, action-pushing call-to-action in the SAME language as the customer (e.g. Tagalog/Taglish if they wrote Tagalog).\n' +
      '- Max ~80 chars. One line. No greetings, no page title, no URL.\n' +
      '- Include a downward-pointing emoji like 👇 (or 📝/📅 when fitting) to draw the eye to the button.\n' +
      '- Examples: "I-tap ang button sa baba para mag-book ng call 👇", "Fill out the quick form below 👇".\n' +
      '- NEVER use the action page title (e.g. "Lead Gen", "Booking") as the button_text.' +
      '\n\n' +
      'SEND NOW — when all prerequisites are met:\n' +
      '- Once the conversation shows that every prerequisite in the page\'s "send when" guidance has been answered, AND the customer\'s latest message shows any forward intent (agreement, "sige"/"okay"/"magkano"/"how do I"/"sign me up"/"book na"/equivalents in any language), you MUST set `action_page.action_page_id` to that page on this turn.\n' +
      '- Do not stall with one more qualifying question once everything is answered. Do not wait for a more explicit ask. The button arrives as a separate message — your `reply` stays conversational and references nothing about a link/button/form.\n' +
      '- This rule applies to every action page in the list below, not only the primary goal.'
    : ''
  const apListSection = hasActionPages ? '\n\n' + actionPageList(actionPages) : ''
  const recommendSection = hasRecommend ? recommendInstruction(recommendRules!, 'product') : ''
  const recommendPropertySection = hasRecommendProperty
    ? recommendInstruction(recommendPropertyRules!, 'property')
    : ''
  const hierarchyBlock =
    'STAGE HIERARCHY RULES — read carefully:\n' +
    '- Stages are listed in pipeline order. Earlier position = earlier in the customer journey.\n' +
    '- The stage NAME is first-class evidence. A customer message clearly invoking the destination stage\'s name (e.g. "cancel my booking", "I\'m ready to buy", "interested po") is direct evidence to move there.\n' +
    '- Each stage may list "enter when" signals. Treat them as canonical examples of what triggers a move INTO that stage — paraphrases, translations (Tagalog/Taglish/English), and equivalent intents all count. Do not require literal keyword matches.\n' +
    '- Forward moves (later position, or any move into a `won`/`lost` terminal stage) are allowed AND ENCOURAGED whenever the customer\'s intent matches the destination stage\'s name, description, or enter signals. Adjacent-forward moves (one step forward) are the default — pick them generously.\n' +
    '- Skip-ahead moves (more than one step forward) are allowed when the latest message clearly fits a later stage (e.g. first inbound is already a pricing question → skip "Engaged" straight to "Interested").\n' +
    '- Backward moves (earlier position) require BOTH:\n' +
    '    (a) `confidence` = "high", AND\n' +
    '    (b) `reason` MUST cite an explicit disqualifying signal — e.g. customer cancelled, said "not interested" / "ayaw na" / "hindi na po ituloy", changed their mind, asked to be removed from the funnel.\n' +
    '- Never move backward on tone alone. A frustrated message is not a backward signal unless the customer explicitly disengages.\n' +
    '- `entry`-kind stages exist to be EXITED. The moment the customer sends a meaningful inbound message, leave the entry stage — never linger there.\n' +
    '- If the lead is genuinely already on the right stage and the latest message adds no new signal, return `stage_change: null`. Otherwise prefer a move.'

  const calibrationBlock =
    'CONFIDENCE CALIBRATION — anchor to evidence, not feeling:\n' +
    '- `high`   = the LATEST customer message contains a direct, explicit match for the destination stage\'s name or enter signals (e.g. "interested po", "magkano?", "book na ako", "ayaw na"). One clean quote is enough.\n' +
    '- `medium` = the destination is the best fit when you read the LAST 2–3 customer turns combined (asked about price + asked about delivery + asked when available → Interested). No single sentence is decisive, but the pattern is.\n' +
    '- `low`    = you are guessing, the signal is implicit, or two stages are close to equally plausible. The system still accepts `low` for one-step-forward moves and into-Objection moves, so do NOT inflate to medium just to be safe. When unsure but the customer clearly engaged, pick `low` adjacent-forward over `null`.\n' +
    'Default UPWARD when in doubt between `low` and `medium`. Default to MOVE (forward, possibly low) rather than `null` whenever the customer added new information.'

  const examplesBlock =
    'EXAMPLES — Filipino Messenger:\n' +
    '- Customer (currently New Lead): "Hi po interested po ako, magkano po yung small?"\n' +
    '  → stage_change to "Interested" / closest equivalent, confidence "high", reason "explicit interest + pricing question".\n' +
    '- Customer (currently New Lead): "Hello po"\n' +
    '  → stage_change to "Engaged" / first nurture stage, confidence "medium", reason "first inbound greeting — exit entry stage". NEVER stay on an entry-kind stage after the first inbound.\n' +
    '- Customer (currently Interested): "Sige, kunin ko na po, paano magbayad?"\n' +
    '  → stage_change to "Qualified" / "Proposal" / closest forward stage, confidence "high", reason "commit + asks how to pay".\n' +
    '- Customer (currently Interested): "Ay mahal naman po, may discount po ba?"\n' +
    '  → stage_change to "Objection" if available, confidence "high", reason "price objection".\n' +
    '- Customer (currently Interested): "Sorry po, hindi na po ituloy."\n' +
    '  → stage_change to "Lost", confidence "high", reason "customer changed mind — explicit disengage".'

  // Ordering note: every section above stageList is stable across turns
  // (header, schema shape, hierarchy/calibration/examples prose, action-page
  // preamble, recommend instructions). The volatile per-turn pieces
  // (stageList interpolates currentStageId; actionPageList interpolates the
  // page set) sit at the tail so provider prompt caches hit on the long
  // stable prefix in cache_friendly mode.
  return (
    '## STAGE CLASSIFICATION — PRIMARY TASK\n' +
    'You are responsible for classifying the lead\'s pipeline stage on every turn. This is the most important structured output in your response. Your job is to keep the lead moving forward through the funnel — when in doubt between moving forward and staying, MOVE FORWARD with lower confidence rather than return null.\n\n' +
    'Output a single JSON object with this exact shape and NOTHING ELSE:\n' +
    schema +
    '\nABSOLUTELY FORBIDDEN inside `reply` (any of these will be stripped and may produce an empty message): tool-call syntax of any kind, function-call notation, control tokens, role headers, XML-ish tags. NEVER write things like `<|tool_call>...<tool_call|>`, `<tool_call>`, `</tool_call>`, `call:action_page.action_page_id(...)`, `function_call:...`, ```json blocks, or any `<|...|>` token. To trigger an action page you set the structured `action_page` field — never describe the call in prose.\n' +
    '`reply` is what the customer sees — write it in the same persona/rules above. ' +
    'Only use stage_ids from the list below. Pick the stage whose name, description, and enter signals best match the customer\'s intent in the latest message + conversation history.\n\n' +
    hierarchyBlock +
    '\n\n' +
    calibrationBlock +
    '\n\n' +
    examplesBlock +
    apPreamble +
    recommendSection +
    recommendPropertySection +
    '\n\n' +
    currentStageBanner(stages, currentStageId) +
    stageList(stages, currentStageId) +
    apListSection
  )
}

function currentStageBanner(stages: StageBrief[], currentStageId: string | null): string {
  const cur = currentStageId ? stages.find((s) => s.id === currentStageId) : null
  if (!cur) {
    return 'CURRENT STAGE: (none — lead has no stage yet). Pick the best fit for the very first inbound message.\n\n'
  }
  return (
    `CURRENT STAGE: "${cur.name}" (kind: ${cur.kind}, position: ${cur.position}). ` +
    'The lead has ALREADY ADVANCED to this stage in prior turns. Do NOT reason as if it is on an earlier stage. ' +
    'Do NOT say things like "exit entry stage" or "first inbound" unless the kind above is literally "entry". ' +
    'A move to a stage with a SMALLER position than ' + cur.position + ' is a BACKWARD move and is only allowed when the customer explicitly disengages ' +
    '(e.g. "not interested", "ayaw na", "cancel", "hindi na po ituloy"). Otherwise pick forward or null.\n\n'
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
    const entry = (s.entry_signals ?? []).filter((x) => !!x?.trim())
    const exit = (s.exit_signals ?? []).filter((x) => !!x?.trim())
    const entryLine = entry.length > 0 ? `\n  enter when:\n${entry.map((e) => `    • ${e}`).join('\n')}` : ''
    const exitLine = exit.length > 0 ? `\n  leave when:\n${exit.map((e) => `    • ${e}`).join('\n')}` : ''
    return (
      `- [${s.position} · ${s.kind}] ${s.name}${cur}\n` +
      `  id: ${s.id}\n` +
      `  description: ${desc}` +
      entryLine +
      exitLine
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

/**
 * Strip control-token / tool-call artifacts the LLM occasionally leaks into
 * `reply`. A real customer must never see strings like
 *   <|tool_call>call:action_page.action_page_id("WhatStage")<tool_call|>
 * which a model emitted once when it confused our JSON-only contract with a
 * tool-calling format. Also strips ChatML-style role headers and code fences.
 *
 * Conservative: removes known artifact patterns, collapses the resulting
 * whitespace, then trims. If the entire reply was an artifact, returns ''.
 * The caller already short-circuits empty replies.
 */
export function sanitizeReply(raw: string): string {
  let s = raw

  // 1. Multiline tool-call / function-call BLOCKS — any wrapper variant we've
  //    seen models emit, including ChatML, XML, square-bracket, and
  //    parenthesised forms. Strip the whole block (open delim + body + close
  //    delim) so nothing inside leaks out.
  const blockPatterns: RegExp[] = [
    // <|tool_call|> ... <|/tool_call|> or <|tool_call|> ... <|tool_call|>
    /<\|\/?(?:tool[_ ]?call|function[_ ]?call|tool[_ ]?use)\|?>[\s\S]*?<\|\/?(?:tool[_ ]?call|function[_ ]?call|tool[_ ]?use)\|?>/gi,
    // <tool_call> ... </tool_call> (both well- and mal-formed close tags)
    /<\/?(?:tool[_ ]?call|function[_ ]?call|tool[_ ]?use)>[\s\S]*?<\/?(?:tool[_ ]?call|function[_ ]?call|tool[_ ]?use)>/gi,
    // [[tool_call]] ... [[/tool_call]]
    /\[\[\/?(?:tool[_ ]?call|function[_ ]?call|tool[_ ]?use)\]\][\s\S]*?\[\[\/?(?:tool[_ ]?call|function[_ ]?call|tool[_ ]?use)\]\]/gi,
  ]
  for (const re of blockPatterns) s = s.replace(re, '')

  // 2. Stray ChatML / Llama / Mistral control tokens — every shape of `<|...>`,
  //    `<...|>`, `<|...|>`. Order matters: do the both-pipes form first so
  //    we don't half-strip and leave a dangling `|>`.
  s = s.replace(/<\|[\s\S]*?\|>/g, '') // <|...|>
  s = s.replace(/<\|[\s\S]*?>/g, '') // <|...>
  s = s.replace(/<[^<>]*?\|>/g, '') // ...|>

  // 3. Lone tool-call open/close tags that survived (no matching pair).
  s = s.replace(/<\/?\s*(?:tool[_ ]?call|function[_ ]?call|tool[_ ]?use)\s*>/gi, '')
  s = s.replace(/\[\[\/?\s*(?:tool[_ ]?call|function[_ ]?call|tool[_ ]?use)\s*\]\]/gi, '')

  // 4. ChatML role headers: <|im_start|>assistant, <|start_header_id|>user…
  //    (mostly covered by step 2, but catch a few common bare forms.)
  s = s.replace(/^\s*(?:assistant|system|user|tool)\s*:?\s*$/gim, '')

  // 5. Bare function-call fragments: any `call:identifier(...)` / `name(args)`
  //    that looks like a serialised tool call. Conservative — only strips
  //    when prefixed by `call:`, `tool_call:`, or `function_call:`.
  s = s.replace(/\b(?:tool_call|function_call|call)\s*:\s*[\w.$]+\s*\([^)]*\)/gi, '')

  // 6. JSON fragments leaking the structured action_page decision into prose
  //    e.g. `{"action_page_id":"x"}` or `action_page.action_page_id("…")`.
  s = s.replace(/\{[^{}]*"action_page[\w]*"[^{}]*\}/gi, '')
  s = s.replace(/\baction_page\.[\w.]+\s*\([^)]*\)/gi, '')

  // 7. Stray fenced code blocks that occasionally escape into reply.
  s = s.replace(/```[a-z]*\s*[\s\S]*?```/gi, '')

  // 8. Bracketed link placeholder leakage like [Insert Link] / [form link here].
  s = s.replace(
    /\[(?:insert\s+)?(?:link|url|form\s+link[^\]]*|action\s+page[^\]]*)\]/gi,
    '',
  )

  // 8b. Link-tease sentences. Models occasionally announce a link in `reply`
  //     ("Sige, eto ang link... check it") without actually setting the
  //     structured `action_page` field, so the customer sees a teaser with no
  //     button. The prompt forbids this in any language; strip any sentence
  //     that contains a tease phrase so the customer at worst gets a shorter
  //     (or empty) reply rather than a broken promise of a link.
  s = stripLinkTeaseSentences(s)

  // 9. Collapse whitespace runs and trim.
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

  return s
}

// Patterns that announce "here's the link / button / form" in any language we
// see in Messenger threads (EN / TL / Taglish). A sentence containing any of
// these is treated as a tease and dropped from `reply` — the prompt forbids
// referencing the action-page button in prose regardless of whether the
// structured `action_page` field was actually set.
const LINK_TEASE_RE =
  /\b(?:e?to|heto|nandito|narito)\b[^.!?\n]{0,30}?\b(?:link|button|form|page)\b|\bhere(?:'?s|\s+is)\s+(?:the|a|your)?\s*(?:link|form|button|page)\b|\bcheck\s+(?:it|this|out|the\s+(?:link|page|form|button)|sa|ang|yung|ito|'to|niyo|mo|niya)\b|\btingnan\s+(?:mo|niyo|nyo)\b|\bi[-\s]?(?:click|tap|fill)\b|\bclick\s+(?:the|this|here|sa|yung|ito|'to)\b|\btap\s+(?:the|this|here|sa|yung)\b|\bfill\s+(?:out|in|up)\s+(?:the|this|na|yung)?\s*form\b|\bsundin\s+ang\s+link\b|\bpara\s+(?:ma)?kita\s+mo\b/i

export function stripLinkTeaseSentences(s: string): string {
  if (!s) return s
  // Split on sentence enders (including `:` since Tagalog tease lines often
  // end on a colon → "eto ang link para makita mo: check it"). Keep the
  // delimiters by capturing them so we can drop them along with the tease.
  const parts = s.split(/([.!?:\n]+)/)
  const out: string[] = []
  for (let i = 0; i < parts.length; i += 2) {
    const seg = parts[i] ?? ''
    const delim = parts[i + 1] ?? ''
    if (seg && LINK_TEASE_RE.test(seg)) continue
    out.push(seg + delim)
  }
  return out.join('')
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
