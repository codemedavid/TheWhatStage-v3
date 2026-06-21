import type { SupabaseClient } from '@supabase/supabase-js'
import { applyStageChange, type ProceedIntent, type StageBrief } from './classify'
import type { VirtualSubmissionMode } from './config'
import { resolveDefaultStageId } from '@/lib/action-pages/default-stage'
import { dispatchSubmissionReceived } from '@/lib/workflow/dispatcher'

export type { VirtualSubmissionMode }

export interface ProceedGateInput {
  proceed: ProceedIntent | null
  /** hasProceedIntent() on the raw inbound message — deterministic corroboration. */
  heuristicHit: boolean
  mode: VirtualSubmissionMode
  /** Whether the thread has a lead to attribute the submission to. */
  hasLead: boolean
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
 *  - medium/high LLM confidence stands alone; low confidence requires the
 *    deterministic heuristic to also fire (suppresses ambiguous-phrase false positives)
 *  - stage auto-advance only in auto mode and only on >= medium confidence
 */
export function decideVirtualSubmission(input: ProceedGateInput): ProceedGateDecision {
  const no = (reason: string): ProceedGateDecision => ({ create: false, advanceStage: false, reason })
  if (input.mode === 'off') return no('mode_off')
  if (!input.hasLead) return no('no_lead')
  if (!input.proceed) return no('no_signal')

  const { confidence } = input.proceed
  const create =
    confidence === 'high' || confidence === 'medium' || (confidence === 'low' && input.heuristicHit)
  if (!create) return no('low_confidence_uncorroborated')

  const advanceStage = input.mode === 'auto' && (confidence === 'high' || confidence === 'medium')
  return { create: true, advanceStage, reason: 'proceed_intent' }
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
  /** Per-turn idempotency anchor (the inbound message id). */
  idempotencyAnchor: string
  mode: VirtualSubmissionMode
  /** Pipeline stages + current stage — required only when advancing (auto mode). */
  stages?: StageBrief[]
  currentStageId?: string | null
  /** Deterministic heuristic corroboration for low-confidence signals. */
  heuristicHit?: boolean
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
  const decision = decideVirtualSubmission({
    proceed: args.proceed,
    heuristicHit: args.heuristicHit ?? false,
    mode: args.mode,
    hasLead: !!args.leadId,
  })
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

  // Deterministic per-turn key — worker retries re-run the LLM, so without this
  // a retried turn would insert a duplicate. The global partial unique index on
  // meta->>'idempotency_key' is the DB-level backstop.
  const idempotencyKey = `chat-intent:${args.threadId}:${args.idempotencyAnchor}`

  const existing = await findByIdempotencyKey(admin, idempotencyKey)
  if (existing) return { submissionId: existing, deduplicated: true, stageMoved: false }

  const data = {
    virtual: true,
    message_quote: args.proceed.quote,
    proceed_confidence: args.proceed.confidence,
    proceed_reason: args.proceed.reason,
    thread_id: args.threadId,
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
      if (won) return { submissionId: won, deduplicated: true, stageMoved: false }
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

async function findByIdempotencyKey(admin: SupabaseClient, key: string): Promise<string | null> {
  const { data } = await admin
    .from('action_page_submissions')
    .select('id')
    .filter('meta->>idempotency_key', 'eq', key)
    .maybeSingle<{ id: string }>()
  return data?.id ?? null
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
