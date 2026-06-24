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
  REPLY_MAX_TOKENS,
  REPLY_WITH_STRUCTURE_MAX_TOKENS,
  type ActionPageRecommendationRules,
  type VirtualSubmissionMode,
} from './config'
import { selectMediaForReply, type SelectedMediaAsset } from '@/lib/media/selector'
import { buildMediaContextBlock } from '@/lib/media/prompt'
import { logChatbotUsage, type AnswerHistory, type AnswerOptions, type AnswerResult } from './answer'
import { decideForceSend } from '@/lib/action-pages/force-send'
import { paymentEnumBlock } from '@/lib/chatbot/payment-enum'
import { guardReply } from '@/lib/chatbot/reply-guard'
import { coercePauseDecision, type PauseDecision } from '@/lib/chatbot/pause'
import { redactForLlm } from '@/lib/chatbot/pii-redact'
import { manilaDateBlock } from '@/lib/time/manilaNow'
import { recordUsageDeferred } from '@/lib/billing/recordUsage'

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

export interface ProceedIntent {
  /** How strong the go-ahead/defer signal is. */
  confidence: 'low' | 'medium' | 'high'
  /** The customer's own words that signaled intent — stored verbatim for the
   *  operator to review the chat-implied submission. */
  quote: string
  /** One short phrase explaining why this counts as proceed-intent. */
  reason: string
}

/** A single useful detail the customer already shared in conversation (e.g.
 *  {label: "Contact number", value: "0917…"}, {label: "Business", value: "…"}).
 *  Mirrors a form field so it renders in the submission detail like a real fill. */
export interface ProceedDetail {
  label: string
  value: string
}

/** Useful info captured PASSIVELY from the conversation to enrich a chat-implied
 *  submission. Never the trigger for asking new questions — only what the
 *  customer already volunteered, distilled by the LLM. */
export interface ProceedInfo {
  details: ProceedDetail[]
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
  /** AI-written caption shown above the button (the card text). */
  button_text: string
  /** AI-written 2-3 word call-to-action shown ON the button. Empty when the
   *  model omitted it — the send path falls back to the page's cta_label. */
  button_label: string
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
  /** AI self-pause decision: when non-null the model judged this turn matches a
   *  configured Auto-Pause Rule and the bot should hand off to a human. The
   *  worker stamps bot_paused_until on this. Always null on the JSON-parse-fail
   *  fallback path (no structured envelope) and when no pause rules are set. */
  pause: PauseDecision | null
  /** Customer expressed intent to proceed / consent in the conversation (e.g.
   *  "kayo na po bahala", "check niyo na lang po page namin") WITHOUT filling a
   *  form. Drives chat-implied ("virtual") submission creation downstream. Null
   *  when no such signal, on the JSON-parse-fail fallback path, or when the
   *  model omitted/under-specified the field. */
  proceedIntent: ProceedIntent | null
  /** Useful info the customer already shared (business, contact, what they sell)
   *  distilled from the conversation, attached to the chat-implied submission as
   *  readable fields. Null when nothing usable or on the fallback path. */
  proceedInfo: ProceedInfo | null
  /** All retrieved chunks (useful + ambiguous + reject) from this turn's RAG
   *  retrieval. Used downstream for source-image attachment. */
  topChunks: Array<{
    document_id: string | null
    faq_id: string | null
    business_item_id: string | null
    media_asset_id: string | null
    payment_method_id: string | null
    content: string
    rrf_score: number
  }>
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
    activeSalesPageId?: string | null
    leadId?: string | null
    threadId?: string | null
    /** Lead has an active (non-terminal) project — relax action-page re-asking
     *  so an existing client is not pushed to re-fill a completed form. */
    inActiveProject?: boolean
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

  // Resolve which action page (if any) the lead is currently on, so we can
  // scope payment methods and pass the page title to the enum block.
  const activePageId =
    options.activeCatalogPageId ??
    options.activeSalesPageId ??
    options.activeRealestatePageId ??
    null

  let activePaymentMethodIds: string[] | null = null
  let activePageTitle: string | null = null

  if (activePageId) {
    const { data: pageRow } = await supabase
      .from('action_pages')
      .select('title, config')
      .eq('id', activePageId)
      .maybeSingle()
    if (pageRow) {
      activePageTitle = pageRow.title ?? null
      const cfg = (pageRow.config ?? {}) as { payment_method_ids?: string[] }
      if (Array.isArray(cfg.payment_method_ids) && cfg.payment_method_ids.length > 0) {
        activePaymentMethodIds = cfg.payment_method_ids
      }
    }
  }

  // paymentEnumBlock and retrieve are independent (neither reads the other's
  // output) — run them concurrently so the slower of the two, not their sum,
  // sits in front of the reply LLM. Both depend only on activePaymentMethodIds,
  // resolved above.
  const [paymentBlock, ctx] = await Promise.all([
    paymentEnumBlock(supabase, userId, activePageTitle, activePaymentMethodIds).catch((err) => {
      console.warn('[classify] paymentEnumBlock failed', err)
      return ''
    }),
    retrieve(
      {
        client: supabase,
        embedder,
        rewriteQuery: (q) => llm.rewriteQuery(q),
        rpcName: options.rpcName,
      },
      { userId, query: message, paymentMethodIds: activePaymentMethodIds },
    ),
  ])

  const built = buildPrompt({
    userQuery: message,
    buckets: ctx.buckets,
    config,
    maxContext: config.maxContext,
    conversationSummary: options.conversationSummary,
    paymentEnumBlock: paymentBlock,
  })

  const actionPages = options.actionPages ?? []
  const recommendRules = getActionPageRecommendationRules(config, options.activeCatalogPageId)
  const recommendPropertyRules = getActionPageRecommendationRules(
    config,
    options.activeRealestatePageId,
  )
  const hasPauseRules = !!config.pauseAiInstructions?.trim()
  const stageParts = stageInstructionParts(
    stages,
    currentStageId,
    actionPages,
    recommendRules,
    recommendPropertyRules,
    hasPauseRules,
    options.inActiveProject ?? false,
    config.virtualSubmissionMode,
    config.virtualSubmissionInstructions,
  )
  // Back-compat concatenation (static prose + '\n\n' + volatile tail) used by
  // the legacy layout, the freeform-persona fallback, and the JSON-parse-fail
  // fallback path below.
  const stageSystem = stageParts.staticPrefix + '\n\n' + stageParts.volatileTail
  const firstName = options.leadName?.split(' ')[0]?.trim()
  const leadNameBlock = firstName
    ? `# Lead\nThe customer's first name is ${firstName}. Address them by their first name when greeting or when it feels natural.`
    : null
  const leadContext = options.leadContextBlock?.trim()

  // Scan retrieved chunks for @asset / #folder references, but ONLY the
  // useful/ambiguous buckets — NOT `reject`. `reject` holds reranker-judged
  // IRRELEVANT chunks; any operator doc that merely mentions a slug (e.g.
  // "see proof in @proof-shot") lands there on unrelated queries and would
  // otherwise re-attach its image on every turn. The LLM's `attach_images`
  // decision (enforced on the returned media below) is the final relevance gate.
  const refChunks = [
    ...ctx.buckets.useful,
    ...ctx.buckets.ambiguous,
  ]
  // Resolve media BEFORE the LLM call so the reply (which is a structured
  // JSON envelope) can tee up the attached images naturally in its `reply` field.
  const media = await selectMediaForReply({
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
  const mediaBlock = buildMediaContextBlock(media)
  // System-prompt assembly.
  //
  // cache_friendly (default): build ONE contiguous, byte-identical-per-persona
  // static prefix so DeepSeek's automatic KV/prefix cache (served via
  // OpenRouter) hits on the bulk of the prompt every turn. The prefix is
  //   [A] built.staticPrefix  (persona + ground rules + grounding + fallback)
  //   [B] stageParts.staticPrefix (## STAGE CLASSIFICATION prose, schema shape,
  //       hierarchy/calibration/examples, attach-images + action-page preamble,
  //       recommend instructions)
  // and EVERY volatile piece trails after it:
  //   [C] built.volatileTail  (goal -> instructions -> summary -> payment -> KB)
  //   [D] stageParts.volatileTail (current-stage banner + stage list + page list)
  //   [E] leadNameBlock  [F] leadContext  [G] mediaBlock
  //   [H] manilaNowTail  (DATE-resolution time — rotates once/day, never busts
  //       the static prefix; appended ONCE here, not in built.system).
  //
  // legacy (rollback) OR when the split fields are absent (freeform-persona
  // override): reproduce the EXACT pre-change expression so output is
  // byte-identical to current main — built.system already carries its own
  // minute-resolution time at its tail in that path.
  const useCachePrefix =
    ragConfig.promptLayout !== 'legacy' &&
    built.staticPrefix !== undefined &&
    built.volatileTail !== undefined
  const system = useCachePrefix
    ? [
        built.staticPrefix, // [A]
        stageParts.staticPrefix, // [B]
        built.volatileTail, // [C]
        stageParts.volatileTail, // [D]
        leadNameBlock, // [E]
        leadContext, // [F]
        mediaBlock, // [G]
        manilaDateBlock(), // [H]
      ]
        .filter(Boolean)
        .join('\n\n')
    : [built.system, stageSystem, leadNameBlock, leadContext, mediaBlock]
        .filter(Boolean)
        .join('\n\n')

  // Redact PII from the LLM payload only. Grounding (below) stays raw so
  // customer-typed contacts are allowed by guardReply.
  const redactedHistory = history.map((h) => ({ ...h, content: redactForLlm(h.content) }))
  const redactedUser = redactForLlm(built.user)
  const grounding = [system, ...built.contextChunks.map((c) => c.content), message].join('\n')

  const t0 = Date.now()
  const completion = await llm.completeWithUsage(
    [
      { role: 'system', content: system },
      ...redactedHistory,
      { role: 'user', content: redactedUser },
    ],
    // Reply text + JSON envelope + structured fields (stage_change,
    // action_page, recommend_*). Cut too low this truncates the reply OR breaks
    // the JSON (forcing a second fallback call) — see REPLY_WITH_STRUCTURE_MAX_TOKENS.
    { temperature: config.temperature, maxTokens: REPLY_WITH_STRUCTURE_MAX_TOKENS, responseFormat: 'json_object' },
  )
  const raw = completion.text
  logChatbotUsage('chatbot.classify', {
    model: completion.model,
    promptTokens: completion.usage?.promptTokens ?? null,
    cachedPromptTokens: completion.usage?.cachedPromptTokens ?? null,
    completionTokens: completion.usage?.completionTokens ?? null,
    finishReason: completion.finishReason,
    kbChunks: built.contextChunks.length,
    historyTurns: history.length,
    summaryLen: options.conversationSummary?.length ?? 0,
    systemChars: system.length,
    ms: Date.now() - t0,
  })
  // Persist to the usage ledger for billing. Deferred past the response so the
  // DB write never delays the reply; best-effort, idempotent per turn.
  recordUsageDeferred(supabase, userId, 'chatbot.classify', completion, options.threadId, options.idempotencyKey)

  const parsed = parseJson(raw)
  let text = ''
  let stageChange: StageChange | null = null
  let actionPage: ActionPageChoice | null = null
  let productRecommendation: ProductRecommendationRequest | null = null
  let propertyRecommendation: PropertyRecommendationRequest | null = null
  let attachImages = false
  let pause: PauseDecision | null = null
  let proceedIntent: ProceedIntent | null = null
  let proceedInfo: ProceedInfo | null = null
  // True when the model teased a link/form in prose but attached no action_page.
  // Fed into decideForceSend so we recover the page instead of dropping it.
  let teasedLink = false
  if (parsed && typeof parsed === 'object') {
    const r = parsed as {
      reply?: unknown
      stage_change?: unknown
      action_page?: unknown
      recommend_product?: unknown
      recommend_property?: unknown
      attach_images?: unknown
      pause?: unknown
      proceed_intent?: unknown
      proceed_info?: unknown
    }
    const rawReply = typeof r.reply === 'string' ? r.reply : ''
    if (rawReply) {
      text = sanitizeReply(rawReply)
      text = guardReply({ text, grounding, fallbackMessage: config.fallbackMessage }).text
    }
    stageChange = coerceStageChange(r.stage_change, stages, currentStageId)
    actionPage = coerceActionPage(r.action_page, actionPages)
    attachImages = r.attach_images === true
    // Only honor `pause` when the user actually configured Auto-Pause Rules, so
    // a hallucinated field on an unconfigured bot can never take it offline.
    pause = hasPauseRules ? coercePauseDecision(r.pause) : null
    proceedIntent = coerceProceedIntent(r.proceed_intent)
    // Only keep captured info when there is an actual proceed signal — info
    // without intent is just conversation, not a submission to enrich.
    proceedInfo = proceedIntent ? coerceProceedInfo(r.proceed_info) : null
    // The model occasionally announces a link in `reply` ("Eto na yung link…")
    // but doesn't set the structured `action_page` field, so the customer sees
    // a broken promise. sanitizeReply strips the tease sentence, but we log
    // every detection so we can track how often the model misbehaves.
    if (!actionPage && rawReply && rawReply !== text && LINK_TEASE_RE.test(rawReply)) {
      // A POSITIVE tease ("eto na po yung form") is an explicit "send the form
      // now" decision → flag it so decideForceSend recovers the action page
      // instead of letting the sanitized reply go out button-less (a dropped
      // sale). LINK_TEASE_RE is deliberately broad (it also strips NEGATIVE
      // mentions like "hindi na kailangan i-fill up yung form" / "optional lang
      // yung form"), so we must NOT force-send on those — that would attach a
      // form right after telling the customer they don't need it.
      teasedLink = hasPositiveLinkTease(rawReply)
      console.warn('[classify.tease] model teased a link with no action_page attached', {
        userId,
        actionPagesAvailable: actionPages.length,
        recovering: teasedLink,
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

  // Cheap salvage BEFORE paying for a second reply. A JSON parse/shape failure
  // here is almost always tail-truncation past REPLY_WITH_STRUCTURE_MAX_TOKENS:
  // the `reply` field is the first key and is already complete in `raw`, only
  // the structured tail got cut. Recover that reply instead of regenerating.
  // The structured envelope is untrusted on this path, so the same field resets
  // as the LLM fallback below apply.
  if (!text) {
    const salvaged = salvageReply(raw)
    if (salvaged) {
      const guarded = guardReply({
        text: sanitizeReply(salvaged),
        grounding,
        fallbackMessage: config.fallbackMessage,
      }).text
      if (guarded) {
        text = guarded
        stageChange = null
        actionPage = null
        productRecommendation = null
        propertyRecommendation = null
        pause = null
        proceedIntent = null
        proceedInfo = null
        teasedLink = false
        attachImages = media.length > 0
        console.log('[chatbot.classify.salvage] recovered reply from truncated JSON — skipped fallback call', {
          userId,
          rawLen: raw.length,
          finishReason: completion.finishReason,
        })
      }
    }
  }

  // Fallback: if JSON parse / shape failed AND salvage found nothing usable,
  // run a plain follow-up generation so the customer still gets a reply. Skip
  // stage change in this branch.
  if (!text) {
    const fallbackSystem = leadContext
      ? `${built.system}\n\n${leadContext}`
      : built.system
    const tFb = Date.now()
    const fb = await llm.completeWithUsage(
      [
        { role: 'system', content: fallbackSystem },
        ...redactedHistory,
        { role: 'user', content: redactedUser },
      ],
      { temperature: config.temperature, maxTokens: REPLY_MAX_TOKENS },
    )
    logChatbotUsage('chatbot.answer.fallback', {
      model: fb.model,
      promptTokens: fb.usage?.promptTokens ?? null,
      cachedPromptTokens: fb.usage?.cachedPromptTokens ?? null,
      completionTokens: fb.usage?.completionTokens ?? null,
      finishReason: fb.finishReason,
      kbChunks: built.contextChunks.length,
      historyTurns: history.length,
      summaryLen: options.conversationSummary?.length ?? 0,
      systemChars: fallbackSystem.length,
      ms: Date.now() - tFb,
    })
    recordUsageDeferred(supabase, userId, 'chatbot.answer.fallback', fb, options.threadId, options.idempotencyKey)
    text = sanitizeReply(fb.text)
    text = guardReply({ text, grounding, fallbackMessage: config.fallbackMessage }).text
    stageChange = null
    actionPage = null
    productRecommendation = null
    propertyRecommendation = null
    // No structured envelope on the fallback path → no pause signal. The bot
    // still gets the "# Auto-Pause Rules" prose in its prompt, but cannot emit
    // a structured pause this turn.
    pause = null
    // No structured envelope on the fallback path → no proceed-intent signal.
    proceedIntent = null
    proceedInfo = null
    // The original (teasing) reply was discarded and regenerated here, so we
    // can no longer claim THIS reply intends a form — clear the tease flag so
    // decideForceSend doesn't attach a button under an unrelated fallback reply.
    teasedLink = false
    // The fallback model didn't produce a structured envelope, so it never
    // reasoned about image attachment. Fall back to the same rule as
    // `answer()`: trust operator-tagged @asset/#folder refs.
    attachImages = media.length > 0
  }

  // decideForceSend (a cheap classifier call + DB reads) and resolveSourceTitles
  // (a single lookup) are both post-reply and independent — run them
  // concurrently so the force-send decision and the source-title resolution
  // overlap instead of stacking serially before the function returns.
  const [, sourceTitles] = await Promise.all([
    (async () => {
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
          teasedLinkThisTurn: teasedLink,
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
    })(),
    resolveSourceTitles(supabase, userId, built.contextChunkIds),
  ])
  console.log('[chatbot.classify] media resolved', {
    userId,
    count: media.length,
    attachImages,
    slugs: media.map((m) => m.slug),
    refChunkCount: refChunks.length,
  })
  const topChunks = refChunks.map((c) => ({
    document_id: c.document_id,
    faq_id: c.faq_id,
    business_item_id: c.business_item_id ?? null,
    media_asset_id: null as string | null,
    payment_method_id: c.payment_method_id ?? null,
    content: c.content,
    rrf_score: ('score' in c ? (c as { score: number }).score : 0),
  }))
  // Enforce the LLM's attach_images decision. The resolved `media` are only
  // CANDIDATES — surfaced to the model via mediaBlock above so it can tee them
  // up — and must be emitted to the caller ONLY when the model opted in.
  // Without this gate the Messenger worker re-sent the same proof/screenshot
  // assets on every turn, even when the message was unrelated.
  const gatedMedia = attachImages ? media : []
  return { text, sourceTitles, media: gatedMedia, attachImages, stageChange, actionPage, productRecommendation, propertyRecommendation, pause, proceedIntent, proceedInfo, topChunks }
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
  /** When supplied (the Messenger worker on a muted thread), the call's tokens
   *  are metered to the usage ledger. Without it the call is unmetered (e.g.
   *  unit tests). This closes the muted-thread spend leak. */
  metering?: {
    supabase: SupabaseClient
    userId: string
    threadId?: string | null
    idempotencyKey?: string | null
  },
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

  const completion = await llm.completeWithUsage(
    [
      { role: 'system', content: system },
      { role: 'user', content: userBlock },
    ],
    { temperature: 0, maxTokens: 400, responseFormat: 'json_object' },
  )
  // Meter the muted-thread classify call (previously unbilled spend leak).
  if (metering) {
    recordUsageDeferred(
      metering.supabase,
      metering.userId,
      'chatbot.classify',
      completion,
      metering.threadId,
      metering.idempotencyKey,
    )
  }
  const parsed = parseJson(completion.text)
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

export interface StageInstructionParts {
  /** Static prose — byte-identical across turns for a given page config. */
  staticPrefix: string
  /** Volatile per-turn tail (current-stage banner + stage list + page list). */
  volatileTail: string
}

/**
 * Split the stage-classification instruction into its STATIC prose prefix and
 * its VOLATILE per-turn tail. `cache_friendly` assembly (classify) interleaves
 * `staticPrefix` into the contiguous leading cache prefix and pushes
 * `volatileTail` after all other volatile data. {@link stageInstruction}
 * re-joins them for legacy/back-compat callers.
 */
export function stageInstructionParts(
  stages: StageBrief[],
  currentStageId: string | null,
  actionPages: ActionPageBrief[],
  recommendRules: ActionPageRecommendationRules | null,
  recommendPropertyRules: ActionPageRecommendationRules | null,
  /** When true, the user configured Auto-Pause Rules — add the structured
   *  `pause` field + decision block. Omitted/false leaves the schema untouched
   *  so the model is never told about a field it must never emit. */
  hasPauseRules: boolean = false,
  /** When true, the lead has an active (non-terminal) project — relax the
   *  action-page re-ask/re-send logic so an existing client is not pushed to
   *  re-fill a form they already completed. Lead-specific, so it lives in the
   *  volatile tail (never the cacheable static prefix). */
  inActiveProject: boolean = false,
  /** Tenant's chat-implied-submission mode. When 'off', the proceed-intent block
   *  stays minimal (detect only, never touch the reply, no info capture) since
   *  nothing is recorded. 'suggest'/'auto' unlock capture + acknowledgement. */
  virtualSubmissionMode: VirtualSubmissionMode = 'suggest',
  /** Operator instructions guiding what to note + how to acknowledge. Stable
   *  across a conversation, so it joins the cacheable static prefix. */
  virtualSubmissionInstructions: string = '',
): StageInstructionParts {
  const hasActionPages = actionPages.length > 0
  const hasRecommend = !!recommendRules
  const hasRecommendProperty = !!recommendPropertyRules
  // Capture + acknowledgement are only meaningful when a submission is actually
  // recorded ('suggest'/'auto'). In 'off' mode the block stays detect-only.
  const virtualSubmissionsOn = virtualSubmissionMode !== 'off'
  const proceedRules = virtualSubmissionInstructions.trim()
  const schemaParts = [
    '"reply": string',
    '"stage_change": {"to_stage_id": string, "confidence": "low"|"medium"|"high", "reason": string} | null',
    '"attach_images": boolean',
    '"proceed_intent": {"confidence": "low"|"medium"|"high", "quote": string, "reason": string} | null',
  ]
  if (virtualSubmissionsOn) {
    schemaParts.push(
      '"proceed_info": {"details": [{"label": string, "value": string}]} | null',
    )
  }
  if (hasPauseRules) {
    schemaParts.push('"pause": {"reason": string} | null')
  }
  if (hasActionPages) {
    schemaParts.push(
      '"action_page": {"action_page_id": string, "reason": string, "button_text": string, "button_label": string} | null',
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

  const attachImagesBlock =
    'ATTACH IMAGES — decide whether to send photos this turn:\n' +
    '- Default `attach_images` to `false`. The vast majority of replies are text only.\n' +
    '- Set `attach_images` to `true` ONLY when ONE of these is clearly true:\n' +
    '    (a) The customer explicitly asked to see something — "show me", "send a photo/pic", "may photos po ba", "pakita", "ipakita mo yung sample", "patingin", "can I see the menu/QR/portfolio", or any equivalent in any language.\n' +
    '    (b) The customer\'s latest message is about a specific item / product / payment QR / portfolio piece whose photo would DIRECTLY answer the question (e.g. they asked about a specific product variant and the knowledge has its image; they asked how to pay via GCash and the knowledge has the QR).\n' +
    '    (c) You are also setting `action_page` to a sales or product page AND the hero image is a natural part of the pitch.\n' +
    '- Set `attach_images` to `false` for: greetings, qualifying questions (asking back about the customer\'s business / needs / timeline / budget), generic pricing chit-chat without a specific item picked, objection handling, scheduling, off-topic, anything where adding a photo would feel random or unrelated.\n' +
    '- Quality test: ask yourself "would a thoughtful human salesperson reach for their phone to send a photo RIGHT NOW based on this message?". If the answer is no or "maybe later", set `false`.\n' +
    '- When in doubt → `false`. A skipped image is far less damaging than an irrelevant brand/logo/product photo arriving out of context.\n' +
    '- This flag gates ALL image sends this turn — gallery shots, product covers, payment QRs, brand/logo assets, sales-page hero. The system still picks WHICH images go out; you only decide WHETHER any go out at all.\n' +
    '- If a "# Attached images" section appears in the system prompt, treat those as CANDIDATES only — they are sent only when you set `attach_images: true`. If you set `attach_images: false`, do NOT mention or hint at images in `reply` (no "here are some screenshots", no "see below"). If you set `true`, briefly acknowledge them.'
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
      '- Write a warm, GUIDING instruction that tells the customer exactly what to do next, in the SAME language as the customer (polite, human Taglish with "po" if they wrote Tagalog).\n' +
      '- Walk them through the steps like a helpful person would: tap/click the button below, then fill out the short form. Add a light nudge first ("para masimulan na natin", "to get started").\n' +
      '- Example tone: "Sige po, para masimulan na natin — i-click niyo lang po yung button sa baba 👇 tapos fill-up niyo lang po yung form." or "To get started, just tap the button below 👇 and fill out the quick form."\n' +
      '- Max ~160 chars, 1-2 short sentences. No greetings like "Hi", no page title, no URL.\n' +
      '- Include a downward-pointing emoji like 👇 (or 📝/📅 when fitting) pointing to the button.\n' +
      '- Write plain, natural text ONLY — no markdown, no asterisks or bold/italics, no surrounding quotes, no headings. It is shown as-is in the chat.\n' +
      '- ALWAYS provide a non-empty button_text whenever you set an action_page — never leave it blank and never use the action page title (e.g. "Lead Gen", "Booking") as the button_text.' +
      '\n\n' +
      'BUTTON_LABEL RULES (the short text shown ON the button itself):\n' +
      '- Write a punchy 2-3 words (HARD max), in the SAME language as the customer. This is the tappable label, so it must be tiny and high-intent for click-through.\n' +
      '- Use a first-person or action framing tied to the outcome: "Claim my slot", "Get my quote", "Book na", "Start now", "Send my song".\n' +
      '- At most one emoji, only if it adds punch. No punctuation, no URL, no sentence.\n' +
      '- NEVER use the action page title (e.g. "Lead Gen", "Booking") as the button_label, and never the generic default ("Open", "Open form", "View").\n' +
      '- This is separate from button_text: button_text is the caption above; button_label is the few words inside the button.' +
      '\n\n' +
      'SEND NOW — when all prerequisites are met:\n' +
      '- Once the conversation shows that every prerequisite in the page\'s "send when" guidance has been answered, AND the customer\'s latest message shows any forward intent (agreement, "sige"/"okay"/"magkano"/"how do I"/"sign me up"/"book na"/equivalents in any language), you MUST set `action_page.action_page_id` to that page on this turn.\n' +
      '- Do not stall with one more qualifying question once everything is answered. Do not wait for a more explicit ask. The button arrives as a separate message — your `reply` stays conversational and references nothing about a link/button/form.\n' +
      '- This rule applies to every action page in the list below, not only the primary goal.'
    : ''
  // Pause decision block — only emitted when the user configured Auto-Pause
  // Rules (the rule TEXT itself lives in the system prompt's "# Auto-Pause
  // Rules" section; this just tells the model how to signal a match). Stable
  // across turns, so it joins the cacheable static prefix.
  const pauseBlock = hasPauseRules
    ? '\n\n' +
      'AUTO-PAUSE — hand off to a human when your "# Auto-Pause Rules" match:\n' +
      '- Those rules (in the instructions above) list the situations where you must STOP and let a human teammate take over.\n' +
      '- When the customer\'s LATEST message clearly matches one of those rules, set `pause` to {"reason": "<which rule matched, a few words>"}. Otherwise set `pause` to null.\n' +
      '- When you set `pause`, still write a brief, warm `reply` that tells the customer a teammate will take over shortly (e.g. "Let me get a teammate to help you with this, one moment."). Do NOT promise a specific time, and do NOT keep trying to resolve the issue yourself.\n' +
      '- Only pause when a rule GENUINELY matches. When in doubt, set `pause` to null and keep helping.'
    : ''
  // Proceed-intent detection — the detection schema is byte-stable, but the
  // capture/acknowledge guidance varies by the tenant's mode + instructions
  // (both conversation-stable, so they still join the cacheable static prefix).
  //
  // Capture (info) block — only when submissions are recorded. PASSIVE by
  // design: distill what the customer ALREADY shared; never a reason to ask
  // more questions (that adds friction to an order we want to make easy).
  const captureBlock = virtualSubmissionsOn
    ? '\n' +
      '- CAPTURE USEFUL INFO: when you set `proceed_intent`, also fill `proceed_info.details` with any useful facts the customer has ALREADY shared earlier in this thread — e.g. {"label": "Contact number", "value": "0917…"}, {"label": "Business", "value": "…"}, {"label": "Looking for", "value": "…"}, {"label": "Budget", "value": "…"}, {"label": "Schedule", "value": "…"}. Use the customer\'s own words. Set `proceed_info` to null when they have shared nothing useful yet.\n' +
      '- Do NOT interrogate. NEVER hold back `proceed_intent` waiting for more info, and NEVER fire a separate question-only turn to collect a field. Capture only what is already in the conversation.'
    : ''
  // Operator instructions — verbatim guidance on what to note + how to confirm.
  const proceedRulesBlock =
    virtualSubmissionsOn && proceedRules
      ? '\n- OPERATOR INSTRUCTIONS for these submissions (follow them, but never at the cost of adding friction): ' +
        proceedRules
      : ''
  // Acknowledgement — fold the confirmation INTO this turn's reply (no extra
  // message). The reply is generated and SENT before any submission row is
  // recorded (and recording is best-effort — it can be gated out or fail), so
  // the confirmation must promise that YOU / the team will take care of it,
  // NOT that anything is already saved/submitted in a system. That stays true
  // even when no row lands (the conversation itself is the operator's record).
  const ackBlock = virtualSubmissionsOn
    ? '\n' +
      '- CONFIRM FIRST — DO NOT ASSUME: a first go-ahead is a cue to CONFIRM what they are agreeing to, not a finished deal. In `reply`, warmly acknowledge and gently confirm (e.g. "Sige po! Para ma-lock natin \'to ng tama…"). Do NOT yet claim it is "done"/"handled"/"submitted".\n' +
      '- THEN OFFER THE FORM: when an action page fits this request (its prerequisites are met), prefer routing the customer to it so their details are captured properly — set `action_page` and let your `reply` confirm + invite them to tap the button and fill the short form. The real form beats a chat-only record.\n' +
      '- PROCEED ANYWAY IF THEY SKIP IT: if the customer was already pointed to the form earlier and still has not filled it, or tells you to just go ahead / not bother with the form, do NOT keep insisting. Disregard the form and proceed on their behalf — confirm warmly that YOU / the team will take care of it (e.g. "Sige po, ako na po bahala dito — aasikasuhin ko na po 💚"). Promise YOUR follow-through, NOT that it is "submitted"/"recorded"/"in the system". The chat-implied record is the fallback for customers who will not fill the form.\n' +
      '- Keep every acknowledgement to one short, natural sentence folded into your normal reply — never a separate message. Follow the operator instructions above for tone/wording.\n' +
      '- Only ask the customer for more info here if the operator instructions explicitly require a specific detail (e.g. a contact number) AND it is genuinely missing. If so, add it as a brief, OPTIONAL request inside the same sentence — never withhold or delay the confirmation to get it, never make it a separate turn, and drop it if it would feel pushy.'
    : '\n- INTERNAL routing only — never mention `proceed_intent` in `reply`, and setting it does NOT change your reply. Keep replying naturally.'
  const proceedIntentBlock =
    '\n\n' +
    'PROCEED INTENT — detect when the customer signals they want to MOVE FORWARD without filling a form:\n' +
    '- Set `proceed_intent` when the customer hands the decision to you, tells you to go ahead, or says they have already given what you need — even though they never submitted a form. This is a HIGH-VALUE signal: they consider themselves in.\n' +
    '- Illustrations of the KIND of phrase (any language; do NOT copy these — they are not the customer\'s words): "Kayo na po bahala" (you take care of it), "Ikaw na bahala", "Check niyo na lang po page namin" (just use our page), "Sige, ituloy na natin", "Go ahead po", "Proceed na tayo", "Push na natin", "Trust ko na po sa inyo", "Okay na po, kayo na magdesisyon".\n' +
    '- `confidence`: "high" = explicit go-ahead/defer; "medium" = clear forward consent in context; "low" = implicit or ambiguous. Use "high"/"medium" ONLY when there is something concrete to proceed WITH (a product, service, or qualification already discussed in this thread). A bare "sige"/"ok"/"go po"/"go ahead" with no prior context is "low" or null — never high/medium.\n' +
    '- `quote`: copy the customer\'s EXACT words from THIS conversation, verbatim and in their own language — the literal text they typed that signaled intent. NEVER paraphrase, translate, summarize, or copy any example phrase from these instructions. If you cannot point to specific words the customer actually typed this thread, you have no proceed-intent: set `proceed_intent` to null. `reason`: one short phrase.\n' +
    '- Set `proceed_intent` to null when the customer is only asking questions, greeting, objecting, deferring a decision ("iisipin ko muna"), or disengaging ("ayaw na", "hindi na").' +
    captureBlock +
    proceedRulesBlock +
    ackBlock
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
  //
  // STATIC prefix: header + schema-shape line + forbidden-token line +
  // hierarchy/calibration/examples + attach-images + action-page preamble +
  // recommend instructions. recommendSection/recommendPropertySection derive
  // from per-page config which is stable across a conversation's turns, so they
  // stay in the static part (do not move them — preserves content order).
  const staticPrefix =
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
    '\n\n' +
    attachImagesBlock +
    pauseBlock +
    proceedIntentBlock +
    apPreamble +
    recommendSection +
    recommendPropertySection

  // In-progress-deal guard for action pages. Lead-specific (depends on whether
  // THIS lead has an active project), so it sits in the volatile tail rather
  // than the cacheable static prefix. Only meaningful when action pages exist.
  const inProjectActionGuard =
    inActiveProject && hasActionPages
      ? 'IN-PROGRESS DEAL — this customer already has an open project with you, so they are not a new inquiry. ' +
        'Do NOT re-send or re-request an action page / form they already completed earlier for this deal, and do ' +
        'NOT re-ask qualifying questions whose answers are already in the project context or earlier in the thread. ' +
        'Only set `action_page` when a genuinely new and relevant page applies to a NEW need they raised this turn; ' +
        'otherwise keep `action_page` null and just continue the conversation about the deal.\n\n'
      : ''

  // VOLATILE tail: in-progress-deal guard (lead-specific) + current-stage banner
  // (interpolates currentStageId) + stage list (flags [CURRENT], interpolates
  // the stage set) + action-page list (interpolates the page set). Changes per
  // turn / per conversation.
  const volatileTail =
    inProjectActionGuard +
    currentStageBanner(stages, currentStageId) +
    stageList(stages, currentStageId) +
    apListSection

  return { staticPrefix, volatileTail }
}

/**
 * Back-compat wrapper: the single concatenated stage-instruction string, in the
 * exact order it has always been emitted (static prose, then a '\n\n'
 * separator, then the volatile banner/stageList/apList). Used by the `legacy`
 * prompt layout and the freeform-persona path, and by existing tests that read
 * the whole string. `cache_friendly` uses {@link stageInstructionParts} so the
 * static prose can be interleaved into the contiguous cacheable prefix.
 */
export function stageInstruction(
  stages: StageBrief[],
  currentStageId: string | null,
  actionPages: ActionPageBrief[],
  recommendRules: ActionPageRecommendationRules | null,
  recommendPropertyRules: ActionPageRecommendationRules | null,
): string {
  const { staticPrefix, volatileTail } = stageInstructionParts(
    stages,
    currentStageId,
    actionPages,
    recommendRules,
    recommendPropertyRules,
  )
  return staticPrefix + '\n\n' + volatileTail
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
    `Set \`${fieldName}\` whenever ANY of these is true:\n` +
    `  (a) The customer EXPLICITLY asks for a recommendation, suggestion, or "what do you have for…".\n` +
    '  (b) The operator rules below tell you to recommend at this point.\n' +
    `  (c) You are about to present, name, or describe a SPECIFIC ${noun} as a good fit for the customer (e.g. you found a match for their stated budget, needs, or preferences). In that case you MUST route it through \`${fieldName}\` — NEVER describe the ${noun} in \`reply\`.\n` +
    `Otherwise, set \`${fieldName}\` to null and keep chatting normally.\n\n` +
    `Operator rules: ${rules.rules}\n` +
    slotsLine +
    '\n\n' +
    'When you DO recommend:\n' +
    `- \`query\` is a 1-sentence summary of what the customer is looking for, distilled from the conversation. Used for search — write it in clear English even if the customer wrote Tagalog.\n` +
    '- `filters.price_min` / `filters.price_max` are extracted from any budget the customer mentioned (in PHP, numbers only). null when not mentioned.\n' +
    '- `filters.tags` are short keywords (1–3 words each) the customer cares about. Empty array when none.\n' +
    `- The system will pick the actual ${noun}, send the image and a card AUTOMATICALLY in a SEPARATE message. Do NOT name a specific ${noun}, its price, size, location, or any other detail, and do NOT include a link, in \`reply\`.\n` +
    '- `reply` should be a short, warm acknowledgement like "Got it — let me share the best fit 👇" in the customer\'s language. Do NOT describe the result itself.\n' +
    `- IRON RULE: if you find yourself writing the NAME of a specific ${noun}, a specific price, floor area, bedroom count, or address inside \`reply\`, STOP — set \`${fieldName}\` instead and let the card carry those details. A ${noun} named in \`reply\` without \`${fieldName}\` set is a BUG the customer sees as a missing card.\n` +
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

// Messenger hard-caps button titles at 20 characters (see
// sendMessengerButton). Clamp the AI label here too so the value persisted /
// previewed matches what the customer actually sees.
const BUTTON_LABEL_MAX = 20

export function coerceActionPage(
  raw: unknown,
  pages: ActionPageBrief[],
): ActionPageChoice | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as {
    action_page_id?: unknown
    reason?: unknown
    button_text?: unknown
    button_label?: unknown
  }
  const id = typeof r.action_page_id === 'string' ? r.action_page_id : null
  if (!id) return null
  if (!pages.some((p) => p.id === id)) return null
  const reason = typeof r.reason === 'string' ? r.reason : ''
  const button_text =
    typeof r.button_text === 'string' ? r.button_text.trim().slice(0, 200) : ''
  const button_label =
    typeof r.button_label === 'string'
      ? r.button_label.trim().slice(0, BUTTON_LABEL_MAX)
      : ''
  return { action_page_id: id, reason, button_text, button_label }
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

// Markers that flip a tease NEGATIVE — the model is telling the customer they
// do NOT need to act on the link/form (so we must not force-send it). Covers
// EN / TL / Taglish negations and "optional / only if you want" conditionals.
const TEASE_NEGATION_RE =
  /\b(?:hindi|hindî|wag|huwag|ayaw|optional|libre\s+lang)\b|\b'?di\b|\bno\s+need\b|\bdon'?t\b|\bnot\s+(?:yet|needed|required|necessary)\b|\bno\s+longer\b|\bkung\s+(?:gusto|nais|kailangan|trip)\b|\bif\s+you\s+(?:want|prefer|like|wish)\b|\bpwede\s+(?:naman\s+)?(?:hindi|wag|skip)\b|\bskip\b/i

// The action-page artifact (or an explicit fill/submit action) a positive tease
// must name. LINK_TEASE_RE alone is too broad to drive a SEND — it also fires on
// unrelated lines like "check niyo na lang po schedule ninyo" (matches "check
// …niyo" but mentions no form). Requiring an artifact keeps recovery to teases
// that genuinely point at the action page.
const TEASE_ARTIFACT_RE =
  /\b(?:link|form|button|page|porma)\b|\b(?:i-?fill|fill\s+(?:out|in|up)|sagut(?:an|in)|i-?submit|i-?sagot)\b/i

// True when at least one sentence is a POSITIVE tease: it names the action-page
// artifact (or a fill/submit action), is NOT negated/conditional, and matches
// the broad tease pattern. This gates force-send recovery so neither a negated
// mention ("hindi na kailangan i-fill up yung form", "optional lang") nor a
// loose unrelated match triggers an unwanted send.
export function hasPositiveLinkTease(s: string): boolean {
  if (!s) return false
  const parts = s.split(/([.!?:\n]+)/)
  for (let i = 0; i < parts.length; i += 2) {
    const seg = parts[i] ?? ''
    if (!seg) continue
    if (!LINK_TEASE_RE.test(seg)) continue
    if (TEASE_NEGATION_RE.test(seg)) continue
    if (!TEASE_ARTIFACT_RE.test(seg)) continue
    return true
  }
  return false
}

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

/**
 * Recover the `reply` string from a combined-call response whose JSON failed to
 * parse — almost always because the output hit REPLY_WITH_STRUCTURE_MAX_TOKENS
 * and the model truncated the structured TAIL (proceed_intent/proceed_info/
 * action_page) AFTER it had already finished writing `reply` (the first field
 * in the schema). Extracting the reply here avoids paying for a second full
 * `chatbot.answer.fallback` LLM call on ~1-in-5 turns.
 *
 * Tolerant of: escaped quotes/backslashes inside the value, a truncated tail,
 * and a reply value itself cut off mid-string (no closing quote). Returns the
 * unescaped reply, or null when no non-empty `reply` value can be found.
 */
export function salvageReply(raw: string): string | null {
  if (!raw) return null
  const keyMatch = raw.match(/"reply"\s*:\s*"/)
  if (!keyMatch || keyMatch.index === undefined) return null
  // Position of the first char inside the opening quote of the value.
  let i = keyMatch.index + keyMatch[0].length
  let value = ''
  let terminated = false
  for (; i < raw.length; i++) {
    const ch = raw[i]
    if (ch === '\\') {
      // Keep the escape sequence intact for JSON.parse below. A lone trailing
      // backslash (truncation landed on it) is dropped — nothing follows it.
      const next = raw[i + 1]
      if (next === undefined) break
      value += ch + next
      i++
      continue
    }
    if (ch === '"') {
      terminated = true
      break
    }
    value += ch
  }
  // Unescape via JSON when the string was well-formed; on a mid-value
  // truncation the captured slice is plain text, so use it as-is.
  let decoded = value
  if (terminated) {
    try {
      decoded = JSON.parse(`"${value}"`) as string
    } catch {
      decoded = value
    }
  }
  const trimmed = decoded.trim()
  return trimmed ? trimmed : null
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

/**
 * Coerce the model's `proceed_intent` field into a {@link ProceedIntent} or null.
 * Unlike {@link coerceStageChange}, a missing/invalid confidence yields null
 * (no default): the PRESENCE of a valid confidence is the signal, so an empty
 * or malformed object is treated as "no proceed-intent this turn". quote/reason
 * are optional and clamped for storage safety.
 */
export function coerceProceedIntent(raw: unknown): ProceedIntent | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { confidence?: unknown; quote?: unknown; reason?: unknown }
  const confidence =
    r.confidence === 'high' || r.confidence === 'medium' || r.confidence === 'low'
      ? r.confidence
      : null
  if (!confidence) return null
  const quote = typeof r.quote === 'string' ? r.quote.trim().slice(0, 500) : ''
  const reason = typeof r.reason === 'string' ? r.reason.trim().slice(0, 500) : ''
  return { confidence, quote, reason }
}

/** Max captured detail rows + per-field char caps. Bounds payload bloat and
 *  prompt-injection blast radius on the model-supplied `proceed_info`. */
const MAX_PROCEED_DETAILS = 12
const MAX_DETAIL_LABEL = 120
const MAX_DETAIL_VALUE = 500

/**
 * Coerce the model's `proceed_info` into a {@link ProceedInfo} or null. Accepts a
 * `{ details: [{label, value}] }` shape, trims + caps each field, drops rows
 * missing a label or value, and returns null when nothing usable remains (so an
 * empty object never writes an empty `fields` block on the submission).
 */
export function coerceProceedInfo(raw: unknown): ProceedInfo | null {
  if (!raw || typeof raw !== 'object') return null
  const list = (raw as { details?: unknown }).details
  if (!Array.isArray(list)) return null
  const details: ProceedDetail[] = []
  // Dedup by case-insensitive label: details are later flattened to a label-keyed
  // record (see fieldsFromInfo), where duplicate labels would silently collapse
  // last-write-wins and drop a value. Keep the FIRST occurrence per label.
  const seenLabels = new Set<string>()
  for (const item of list) {
    if (details.length >= MAX_PROCEED_DETAILS) break
    if (!item || typeof item !== 'object') continue
    const r = item as { label?: unknown; value?: unknown }
    const label = typeof r.label === 'string' ? r.label.trim().slice(0, MAX_DETAIL_LABEL) : ''
    const value = typeof r.value === 'string' ? r.value.trim().slice(0, MAX_DETAIL_VALUE) : ''
    if (!label || !value) continue
    const key = label.toLowerCase()
    if (seenLabels.has(key)) continue
    seenLabels.add(key)
    details.push({ label, value })
  }
  return details.length > 0 ? { details } : null
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
