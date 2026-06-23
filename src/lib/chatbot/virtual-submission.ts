import type { SupabaseClient } from '@supabase/supabase-js'
import { applyStageChange, type ProceedInfo, type ProceedIntent, type StageBrief } from './classify'
import type { VirtualSubmissionMode } from './config'
import { resolveDefaultStageId } from '@/lib/action-pages/default-stage'
import { dispatchSubmissionReceived } from '@/lib/workflow/dispatcher'
import { redactForLlm } from './pii-redact'

export type { VirtualSubmissionMode }

export interface ProceedGateInput {
  proceed: ProceedIntent | null
  /** hasProceedIntent() on the raw inbound message — deterministic corroboration. */
  heuristicHit: boolean
  /** Whether `proceed.quote` actually appears in the customer's own words this
   *  thread (see {@link isProceedQuoteGrounded}). Guards against the model
   *  fabricating consent by echoing a prompt example phrase the lead never typed. */
  quoteGrounded: boolean
  mode: VirtualSubmissionMode
  /** Whether the thread has a lead to attribute the submission to. */
  hasLead: boolean
  /** Whether the lead already entered the pipeline through a real path — a
   *  non-virtual form submission or an existing project. When true, a chat
   *  agreement ("K po", "Okay") is just confirming a deal that already exists,
   *  so a NEW chat-implied submission would be a duplicate (see the doubling
   *  bug where a lead with a form + project also got a "Create project" row).
   *  Optional; absent is treated as "not in pipeline". */
  alreadyInPipeline?: boolean
}

export interface ProceedGateDecision {
  create: boolean
  advanceStage: boolean
  reason: string
}

/**
 * Pure gating decision: given the LLM's proceed-intent, a deterministic
 * heuristic corroboration, the tenant's mode, and whether a lead exists, decide
 * whether to record a virtual submission and whether to advance the stage.
 *
 * Guardrails encoded here:
 *  - never without a lead to attribute to, never when mode is off, never on no signal
 *  - medium/high LLM confidence stands alone, BUT only when its quote is grounded
 *    in the customer's actual words (an ungrounded medium/high quote means the
 *    model fabricated consent — e.g. parroting a prompt example — so reject it)
 *  - low confidence requires the deterministic heuristic to also fire (the
 *    heuristic runs on the real inbound, so it is grounded by construction)
 *  - stage auto-advance only in auto mode and only on >= medium confidence
 */
export function decideVirtualSubmission(input: ProceedGateInput): ProceedGateDecision {
  const no = (reason: string): ProceedGateDecision => ({ create: false, advanceStage: false, reason })
  if (input.mode === 'off') return no('mode_off')
  if (!input.hasLead) return no('no_lead')
  if (!input.proceed) return no('no_signal')
  // Already in the pipeline (real submission or project) → the chat agreement is
  // confirmation, not a new entry. Suppress to stop the doubled "Create project"
  // row. Stage auto-advance is a separate path, so confirmations still move stages.
  if (input.alreadyInPipeline) return no('already_in_pipeline')

  const { confidence } = input.proceed
  // Fabrication guard: a medium/high signal must quote words the customer really
  // typed. Without a grounded quote the consent is hallucinated (the classic
  // failure is the model echoing the prompt's "Kayo na po bahala" example for a
  // lead who only asked a question), so it must never become a submission.
  if ((confidence === 'high' || confidence === 'medium') && !input.quoteGrounded) {
    return no('ungrounded_quote')
  }
  const create =
    confidence === 'high' || confidence === 'medium' || (confidence === 'low' && input.heuristicHit)
  if (!create) return no('low_confidence_uncorroborated')

  const advanceStage = input.mode === 'auto' && (confidence === 'high' || confidence === 'medium')
  return { create: true, advanceStage, reason: 'proceed_intent' }
}

/** Normalize for token comparison: lowercase, strip diacritics (so "niño"
 *  matches "nino"), reduce every non-alphanumeric run to a single space, and
 *  trim. Keeps Tagalog/English words intact while ignoring case + accents +
 *  punctuation differences between the LLM's quote and the transcript. */
function normalizeForGrounding(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Ultra-common Tagalog/Taglish/English particles + pronouns that carry almost
 *  no identifying signal. They overlap across unrelated messages, so they are
 *  ignored when deciding whether a quote is grounded — the DISTINCTIVE words
 *  (the verbs/nouns a customer actually chose) are what must be present.
 *  Proceed verbs (go, sige, tuloy, ituloy, proceed, push, check, book…) are
 *  deliberately NOT here — they are exactly the distinctive signal we verify.
 *  "phone"/"email" are kept distinctive too (a quote may legitimately span a
 *  redacted contact the model saw). */
const GROUNDING_STOPWORDS = new Set([
  'po', 'opo', 'na', 'nga', 'ng', 'sa', 'ang', 'mga', 'ko', 'mo', 'ka', 'ako',
  'akin', 'yung', 'yun', 'iyon', 'ito', 'yan', 'iyan', 'lang', 'lng', 'ba',
  'pa', 'din', 'rin', 'namin', 'natin', 'namon', 'niyo', 'nyo', 'ninyo',
  'kayo', 'ikaw', 'inyo', 'kami', 'tayo', 'at', 'ay', 'si', 'ni', 'kay',
  'para', 'kasi', 'eh', 'the', 'a', 'an', 'to', 'of', 'i', 'you', 'it', 'is',
  'im', 'yes', 'please', 'pls',
])

/**
 * True when `quote` is grounded in `customerText` — i.e. the customer actually
 * typed those words this thread. Rejects a fabricated proceed-intent where the
 * model echoes a prompt example (e.g. "Kayo na po bahala") for a lead who never
 * said it.
 *
 * Token-based, not substring:
 *  - Compares in the SAME PII-redacted space the model saw (`redactForLlm`), so
 *    a quote carrying a "[phone]"/"[email]" placeholder grounds against the
 *    redacted transcript instead of the raw digits (review finding 2).
 *  - Requires every DISTINCTIVE token (non-stopword) of the quote to appear as a
 *    whole token in the transcript. Whole-token matching avoids substring false
 *    positives ("go po" no longer matches inside "ago poll" — finding 3), and
 *    ignoring fillers tolerates light paraphrase/contraction differences as long
 *    as the meaningful word is present ("ituloy niyo na" grounds against
 *    "ituloy nyo na" — finding 1).
 *  - All-filler quotes (no distinctive token) fall back to contiguous-phrase
 *    containment so they cannot be waved through on filler overlap alone.
 *
 * Empty quote → false (nothing to ground). Pure, never throws.
 */
export function isProceedQuoteGrounded(quote: string, customerText: string): boolean {
  const q = normalizeForGrounding(quote)
  if (!q) return false
  // Ground against what the model actually saw: the redacted transcript.
  const corpus = normalizeForGrounding(redactForLlm(customerText))
  if (!corpus) return false

  const corpusTokens = new Set(corpus.split(' '))
  const quoteTokens = q.split(' ').filter(Boolean)
  const distinctive = quoteTokens.filter((t) => !GROUNDING_STOPWORDS.has(t))

  if (distinctive.length === 0) {
    // Nothing distinctive to anchor on — require the exact filler phrase to
    // appear contiguously rather than trusting scattered common-word overlap.
    // (corpus is already single-space normalized, so substring == phrase match.)
    return corpus.includes(q)
  }
  return distinctive.every((t) => corpusTokens.has(t))
}

export interface CreateVirtualSubmissionArgs {
  userId: string
  leadId: string
  threadId: string
  psid: string | null
  pageId: string | null
  /** Action page to attribute to first (e.g. the catalog/realestate/sales page
   *  in scope this turn). Falls back to the tenant's primary action page. */
  preferredActionPageId?: string | null
  proceed: ProceedIntent
  /** @deprecated No longer used for the idempotency key — dedup is now
   *  per-thread (see idempotencyKey below). Kept optional for back-compat. */
  idempotencyAnchor?: string
  mode: VirtualSubmissionMode
  /** Pipeline stages + current stage — required only when advancing (auto mode). */
  stages?: StageBrief[]
  currentStageId?: string | null
  /** Deterministic heuristic corroboration for low-confidence signals. */
  heuristicHit?: boolean
  /** The customer's own words this thread (prior inbound turns + the current
   *  message). Used to verify `proceed.quote` is real, not a fabricated echo of
   *  a prompt example. Absent → an empty corpus → medium/high signals are
   *  treated as ungrounded and rejected (fail-closed). */
  customerText?: string
  /** Useful info the customer already shared (distilled by the LLM). Stored as
   *  `data.fields` so the submission detail renders it like a real form fill. */
  info?: ProceedInfo | null
}

export interface VirtualSubmissionResult {
  submissionId: string
  deduplicated: boolean
  stageMoved: boolean
}

const VIRTUAL_OUTCOME = 'implied_proceed'

/**
 * Record a chat-implied ("virtual") submission from a detected proceed-intent,
 * so a lead who consented in conversation — without filling a form — enters the
 * same submissions → project → analytics pipeline a real form would.
 *
 * Reuses existing rails: dispatchSubmissionReceived (workflow triggers) and, in
 * auto mode, applyStageChange (RPC-only, audit-safe stage move that writes
 * lead_stage_events). Deliberately SKIPS the payment / booking / CAPI / echo
 * side-effects of a real form submission — the bot already replied this turn,
 * and there is no real conversion event or payload. Never throws; returns null
 * when nothing was recorded (gated out, no attributable page, or insert failure).
 */
export async function createVirtualSubmission(
  admin: SupabaseClient,
  args: CreateVirtualSubmissionArgs,
): Promise<VirtualSubmissionResult | null> {
  const gateInput: ProceedGateInput = {
    proceed: args.proceed,
    heuristicHit: args.heuristicHit ?? false,
    quoteGrounded: isProceedQuoteGrounded(args.proceed.quote, args.customerText ?? ''),
    mode: args.mode,
    hasLead: !!args.leadId,
  }
  // Cheap pre-gate first (mode/lead/signal/grounding) so the pipeline DB lookup
  // only runs when we'd otherwise create a submission.
  if (!decideVirtualSubmission(gateInput).create) return null

  const alreadyInPipeline = await leadAlreadyInPipeline(admin, args.userId, args.leadId)
  const decision = decideVirtualSubmission({ ...gateInput, alreadyInPipeline })
  if (!decision.create) return null

  const actionPageId = await resolveAttributionPage(
    admin,
    args.userId,
    args.preferredActionPageId ?? null,
  )
  if (!actionPageId) {
    console.warn('[virtual-submission] no owned/published action page to attribute to; skipping', {
      userId: args.userId,
      leadId: args.leadId,
    })
    return null
  }

  // Per-THREAD key — a single conversation is one consent event, so every
  // proceed-intent message in the same thread maps to the same submission. This
  // is what stops the doubling: a chatty lead who says "kayo na po bahala" then
  // "Ok po gawan moko" gets ONE chat-implied submission, not one per message.
  // (Worker retries of the same message land here too.) The global partial
  // unique index on meta->>'idempotency_key' is the DB-level backstop.
  const idempotencyKey = `chat-intent:${args.threadId}`

  const existing = await findByIdempotencyKey(admin, idempotencyKey)
  if (existing) {
    // Don't create a second row — instead fold any newly-captured info or a
    // stronger signal into the row we already have, so deduping never loses
    // detail the later message revealed. Best-effort; never throws.
    await enrichExistingSubmission(admin, existing, args)
    return { submissionId: existing.id, deduplicated: true, stageMoved: false }
  }

  // Map captured details into a flat record keyed by label, matching the shape
  // a real form fill writes (`data.fields`), so the operator's submission detail
  // view renders both identically (see form-submissions.helpers extractFormFields).
  const fields = fieldsFromInfo(args.info ?? null)
  const data = {
    virtual: true,
    message_quote: args.proceed.quote,
    proceed_confidence: args.proceed.confidence,
    proceed_reason: args.proceed.reason,
    thread_id: args.threadId,
    ...(fields ? { fields } : {}),
  }
  const meta = {
    virtual: true,
    source: 'chat_intent',
    idempotency_key: idempotencyKey,
  }

  const { data: ins, error } = await admin
    .from('action_page_submissions')
    .insert({
      action_page_id: actionPageId,
      user_id: args.userId,
      lead_id: args.leadId,
      psid: args.psid,
      page_id: args.pageId,
      outcome: VIRTUAL_OUTCOME,
      data,
      meta,
    })
    .select('id')
    .single<{ id: string }>()

  if (error || !ins) {
    // Concurrent identical turn won the unique index — treat as dedup success.
    if ((error as { code?: string } | null)?.code === '23505') {
      const won = await findByIdempotencyKey(admin, idempotencyKey)
      if (won) return { submissionId: won.id, deduplicated: true, stageMoved: false }
    }
    console.error('[virtual-submission] insert failed', error?.message)
    return null
  }
  const submissionId = ins.id

  // Fire workflow triggers exactly like a real submission. Best-effort.
  dispatchSubmissionReceived(admin, {
    userId: args.userId,
    submissionId,
    actionPageId,
    outcome: VIRTUAL_OUTCOME,
    leadId: args.leadId,
    threadId: args.threadId,
  }).catch((e) => console.error('[virtual-submission] dispatchSubmissionReceived threw', e))

  let stageMoved = false
  if (decision.advanceStage) {
    stageMoved = await advanceStageForProceed(admin, { ...args, submissionId })
  }

  return { submissionId, deduplicated: false, stageMoved }
}

/** Pick the action page a virtual submission is attributed to: the in-scope
 *  page if any, else the tenant's primary action page. Verifies ownership +
 *  published status (mirrors resolveAttachedActionPage in submit/route.ts) so a
 *  stale or cross-tenant id can never be used. */
async function resolveAttributionPage(
  admin: SupabaseClient,
  userId: string,
  preferred: string | null,
): Promise<string | null> {
  const candidates: string[] = []
  if (preferred) candidates.push(preferred)
  const { data: cfg } = await admin
    .from('chatbot_configs')
    .select('primary_action_page_id')
    .eq('user_id', userId)
    .maybeSingle<{ primary_action_page_id: string | null }>()
  if (cfg?.primary_action_page_id && !candidates.includes(cfg.primary_action_page_id)) {
    candidates.push(cfg.primary_action_page_id)
  }
  for (const id of candidates) {
    const { data: page } = await admin
      .from('action_pages')
      .select('id, user_id, status')
      .eq('id', id)
      .maybeSingle<{ id: string; user_id: string; status: string }>()
    if (page && page.user_id === userId && page.status === 'published') return page.id
  }
  return null
}

/** Flatten captured details into a label→value record, or null when there is
 *  nothing to store. coerceProceedInfo guarantees a non-empty, label-deduped
 *  list (or null), so a single null guard here covers the empty case. */
function fieldsFromInfo(info: ProceedInfo | null): Record<string, string> | null {
  if (!info || info.details.length === 0) return null
  const out: Record<string, string> = {}
  for (const d of info.details) out[d.label] = d.value
  return out
}

interface PipelineSubmissionRow {
  id: string
  meta: Record<string, unknown> | null
  outcome: string | null
}

/** True when the submission is a chat-implied (virtual) one rather than a real
 *  form fill — recognised by either its `meta.virtual` flag or the virtual
 *  outcome. Real submissions are the ones that count as a pipeline entry. */
function isVirtualSubmissionRow(row: PipelineSubmissionRow): boolean {
  return (row.meta?.virtual === true) || row.outcome === VIRTUAL_OUTCOME
}

/**
 * True when the lead already entered the pipeline through a real path: a
 * non-virtual form submission OR an existing project. Used to suppress a
 * redundant chat-implied submission when the lead's chat agreement merely
 * confirms a deal that already exists (the doubling bug).
 *
 * Best-effort and FAIL-OPEN: a query error returns false so a transient DB blip
 * never silently swallows a legitimate first-time chat-implied lead. Reads a
 * small bounded set and evaluates the virtual flag in JS — robust against
 * null `meta` rather than a brittle PostgREST null filter.
 */
async function leadAlreadyInPipeline(
  admin: SupabaseClient,
  userId: string,
  leadId: string,
): Promise<boolean> {
  const { data: subs, error: subErr } = await admin
    .from('action_page_submissions')
    .select('id, meta, outcome')
    .eq('user_id', userId)
    .eq('lead_id', leadId)
    .limit(20)
  if (subErr) return false
  if ((subs ?? []).some((s) => !isVirtualSubmissionRow(s as PipelineSubmissionRow))) return true

  const { data: projects, error: projErr } = await admin
    .from('projects')
    .select('id')
    .eq('user_id', userId)
    .eq('lead_id', leadId)
    .limit(1)
  if (projErr) return false
  return (projects ?? []).length > 0
}

interface ExistingSubmission {
  id: string
  data: Record<string, unknown> | null
}

async function findByIdempotencyKey(
  admin: SupabaseClient,
  key: string,
): Promise<ExistingSubmission | null> {
  const { data } = await admin
    .from('action_page_submissions')
    .select('id, data')
    .filter('meta->>idempotency_key', 'eq', key)
    .maybeSingle<ExistingSubmission>()
  return data ?? null
}

const CONFIDENCE_RANK: Record<string, number> = { low: 0, medium: 1, high: 2 }

/** Fold a later proceed-intent into the thread's existing chat-implied
 *  submission: merge any newly-captured fields and, when the new signal is
 *  stronger, upgrade the stored quote/confidence/reason. Writes only when
 *  something actually changed, so repeated weak signals are no-ops. Best-effort;
 *  a failed enrich must never turn a successful dedup into an error. */
async function enrichExistingSubmission(
  admin: SupabaseClient,
  existing: ExistingSubmission,
  args: CreateVirtualSubmissionArgs,
): Promise<void> {
  const prev = existing.data ?? {}
  const prevFields = (prev.fields as Record<string, string> | undefined) ?? {}
  const newFields = fieldsFromInfo(args.info ?? null) ?? {}
  const addsField = Object.keys(newFields).some((k) => prevFields[k] !== newFields[k])

  const prevConf = CONFIDENCE_RANK[String(prev.proceed_confidence)] ?? -1
  const nextConf = CONFIDENCE_RANK[args.proceed.confidence] ?? -1
  const upgrade = nextConf > prevConf

  if (!addsField && !upgrade) return

  const mergedFields = { ...prevFields, ...newFields }
  const data = {
    ...prev,
    ...(upgrade
      ? {
          message_quote: args.proceed.quote,
          proceed_confidence: args.proceed.confidence,
          proceed_reason: args.proceed.reason,
        }
      : {}),
    ...(Object.keys(mergedFields).length ? { fields: mergedFields } : {}),
  }

  const { error } = await admin
    .from('action_page_submissions')
    .update({ data })
    .eq('id', existing.id)
  if (error) {
    console.warn('[virtual-submission] enrich update failed', error.message)
  }
}

/** Forward-advance the lead to the first 'qualifying' stage via applyStageChange
 *  (RPC-only, audit-safe). Its forward-only + confidence guards mean a lead
 *  already past qualifying is left untouched. */
async function advanceStageForProceed(
  admin: SupabaseClient,
  args: CreateVirtualSubmissionArgs & { submissionId: string },
): Promise<boolean> {
  const stages = args.stages ?? []
  if (stages.length === 0) return false
  const targetStageId = await resolveDefaultStageId(admin, args.userId, 'qualifying')
  if (!targetStageId || targetStageId === args.currentStageId) return false

  const moved = await applyStageChange(admin, {
    leadId: args.leadId,
    userId: args.userId,
    threadId: args.threadId,
    fromStageId: args.currentStageId ?? null,
    change: {
      to_stage_id: targetStageId,
      confidence: args.proceed.confidence,
      reason: `chat proceed-intent: ${args.proceed.quote || args.proceed.reason}`.slice(0, 500),
    },
    stages,
    idempotencySuffix: `proceed:${args.submissionId}`,
  })
  return moved !== null
}
