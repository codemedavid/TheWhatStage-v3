import { createAdminClient } from '@/lib/supabase/admin'
import { triggerWorkflowWorker } from './trigger'
import { parseOffset } from './offsets'

type AdminClient = ReturnType<typeof createAdminClient>

// ---------------------------------------------------------------------------
// Payload shapes — one per trigger kind
// ---------------------------------------------------------------------------

export interface StageEnteredPayload {
  userId: string
  leadId: string
  threadId: string | null
  toStageId: string
  fromStageId: string | null
  // The stage move's own idempotency key — incorporated into the run's dedup
  // key so a retried classifier never fires a second workflow run.
  idempotencyKey: string
}

export interface StageIdlePayload {
  userId: string
  leadId: string
  threadId: string | null
  stageId: string
  // Hourly bucket: Math.floor(Date.now() / 3_600_000).toString()
  // Limits each lead×stage combo to one trigger dispatch per hour.
  bucket: string
}

export interface SubmissionReceivedPayload {
  userId: string
  submissionId: string
  actionPageId: string
  outcome: string
  leadId: string | null
  threadId: string | null
}

export interface CartAbandonedPayload {
  userId: string
  cartId: string
  leadId: string | null
  threadId: string | null
  totalAmount: number | null
  currency: string
  source: string | null
}

// Callers pass the shared fields; dispatchBookingOffsets creates one run
// per offset found in the workflow triggers.
export interface BookingBasePayload {
  userId: string
  bookingEventId: string
  leadId: string | null
  threadId: string | null
  eventAt: string  // ISO UTC — used to compute next_run_at for each offset
  /** When set, only fires triggers whose action_page_id matches (or is unset). */
  actionPageId?: string
}

// ---------------------------------------------------------------------------
// Core: find matching active workflows and create runs
// ---------------------------------------------------------------------------

interface RunSeed {
  lead_id: string | null
  thread_id: string | null
  state: Record<string, unknown>
  // null  → run starts immediately (status='running', job inserted now)
  // string → run waits until this time (status='waiting', no job now — tick does it)
  next_run_at: string | null
}

async function createRunsForMatchingWorkflows(
  admin: AdminClient,
  args: {
    userId: string
    triggerKind: string
    matchFn: (trigger: { kind: string; config: Record<string, unknown> }) => boolean
    buildDedupKey: (workflowId: string) => string
    buildRunSeed: (workflowId: string, workflowVersion: number) => RunSeed
  },
): Promise<number> {
  const { userId, triggerKind, matchFn, buildDedupKey, buildRunSeed } = args

  // Load active workflows for this user with matching trigger kind.
  const { data: workflows, error: wfErr } = await admin
    .from('workflows')
    .select('id, version, trigger, triggers')
    .eq('user_id', userId)
    .eq('status', 'active')

  if (wfErr || !workflows?.length) return 0

  // Support multi-trigger workflows. `triggers` (array) is the source of truth
  // when present; fall back to the singular `trigger` column for older rows.
  const matching = workflows
    .map((wf) => {
      const arr: Array<{ kind: string; config: Record<string, unknown> }> =
        Array.isArray(wf.triggers) && wf.triggers.length > 0
          ? (wf.triggers as Array<{ kind: string; config: Record<string, unknown> }>)
          : [wf.trigger as { kind: string; config: Record<string, unknown> }]
      const matchedTrigger = arr.find((t) => t?.kind === triggerKind && matchFn(t))
      return matchedTrigger ? { ...wf, _matchedTrigger: matchedTrigger } : null
    })
    .filter((wf): wf is NonNullable<typeof wf> => wf !== null)

  if (!matching.length) return 0

  let created = 0

  for (const wf of matching) {
    const dedupKey = buildDedupKey(wf.id)
    const seed = buildRunSeed(wf.id, wf.version)
    const isImmediate = seed.next_run_at === null

    const { data: run, error: runErr } = await admin
      .from('workflow_runs')
      .insert({
        workflow_id: wf.id,
        workflow_version: wf.version,
        user_id: userId,
        lead_id: seed.lead_id,
        thread_id: seed.thread_id,
        state: seed.state,
        status: isImmediate ? 'running' : 'waiting',
        next_run_at: seed.next_run_at,
        dedup_key: dedupKey,
      })
      .select('id')
      .maybeSingle<{ id: string }>()

    if (runErr) {
      // Unique constraint violation (23505) = this trigger was already dispatched.
      // Anything else is a real error worth logging.
      if ((runErr as { code?: string }).code !== '23505') {
        console.error('[workflow.dispatcher] run insert failed', {
          workflowId: wf.id,
          dedupKey,
          err: runErr.message,
        })
      }
      continue
    }

    if (!run) continue  // ON CONFLICT path (shouldn't happen since we use maybeSingle)

    created++

    // Immediately-runnable runs get a job right now.
    // Waiting runs (booking offsets) are picked up by enqueue_due_workflow_runs().
    if (isImmediate) {
      const { error: jobErr } = await admin
        .from('workflow_jobs')
        .insert({ run_id: run.id, scheduled_at: new Date().toISOString() })

      if (jobErr) {
        console.error('[workflow.dispatcher] job insert failed', {
          runId: run.id,
          err: jobErr.message,
        })
      }
    }
  }

  if (created > 0) {
    await triggerWorkflowWorker()
  }

  return created
}

// ---------------------------------------------------------------------------
// Public dispatch functions — one per trigger kind
// ---------------------------------------------------------------------------

export async function dispatchStageEntered(
  admin: AdminClient,
  payload: StageEnteredPayload,
): Promise<void> {
  try {
    await createRunsForMatchingWorkflows(admin, {
      userId: payload.userId,
      triggerKind: 'stage_entered',
      matchFn: (trigger) => {
        const cfg = trigger.config as { stage_id?: string }
        // No stage_id filter = match all stage entries for this user.
        return !cfg.stage_id || cfg.stage_id === payload.toStageId
      },
      buildDedupKey: (wfId) =>
        `wf:${wfId}:stage_entered:${payload.idempotencyKey}`,
      buildRunSeed: () => ({
        lead_id: payload.leadId,
        thread_id: payload.threadId,
        state: {
          variables: {
            from_stage_id: payload.fromStageId,
            to_stage_id: payload.toStageId,
          },
        },
        next_run_at: null,
      }),
    })
  } catch (e) {
    console.error('[workflow.dispatcher] dispatchStageEntered threw', e)
  }
}

export async function dispatchStageIdle(
  admin: AdminClient,
  payload: StageIdlePayload,
): Promise<void> {
  try {
    await createRunsForMatchingWorkflows(admin, {
      userId: payload.userId,
      triggerKind: 'stage_idle',
      matchFn: (trigger) => {
        const cfg = trigger.config as { stage_id?: string; min_idle_ms?: number }
        return !cfg.stage_id || cfg.stage_id === payload.stageId
      },
      buildDedupKey: (wfId) =>
        `wf:${wfId}:lead:${payload.leadId}:idle:${payload.stageId}:${payload.bucket}`,
      buildRunSeed: () => ({
        lead_id: payload.leadId,
        thread_id: payload.threadId,
        state: { variables: { stage_id: payload.stageId } },
        next_run_at: null,
      }),
    })
  } catch (e) {
    console.error('[workflow.dispatcher] dispatchStageIdle threw', e)
  }
}

export async function dispatchSubmissionReceived(
  admin: AdminClient,
  payload: SubmissionReceivedPayload,
): Promise<void> {
  try {
    await createRunsForMatchingWorkflows(admin, {
      userId: payload.userId,
      triggerKind: 'submission_received',
      matchFn: (trigger) => {
        const cfg = trigger.config as { action_page_id?: string; outcome?: string }
        if (cfg.action_page_id && cfg.action_page_id !== payload.actionPageId) return false
        if (cfg.outcome && cfg.outcome !== payload.outcome) return false
        return true
      },
      buildDedupKey: (wfId) =>
        `wf:${wfId}:sub:${payload.submissionId}`,
      buildRunSeed: () => ({
        lead_id: payload.leadId,
        thread_id: payload.threadId,
        state: {
          variables: {
            submission_id: payload.submissionId,
            action_page_id: payload.actionPageId,
            submission_outcome: payload.outcome,
          },
        },
        next_run_at: null,
      }),
    })
  } catch (e) {
    console.error('[workflow.dispatcher] dispatchSubmissionReceived threw', e)
  }
}

// Dispatches one run per booking_offset trigger found in the user's active
// workflows. Offsets are driven entirely by trigger config (not a hardcoded
// table), and filtered by action_page_id when provided.
export async function dispatchBookingOffsets(
  admin: AdminClient,
  payload: BookingBasePayload,
): Promise<void> {
  const eventMs = new Date(payload.eventAt).getTime()
  if (Number.isNaN(eventMs)) {
    console.error('[workflow.dispatcher] dispatchBookingOffsets: invalid eventAt', payload.eventAt)
    return
  }

  const { data: workflows, error: wfErr } = await admin
    .from('workflows')
    .select('id, version, trigger, triggers')
    .eq('user_id', payload.userId)
    .eq('status', 'active')
  if (wfErr || !workflows?.length) return

  type Pair = { wfId: string; offset: string; deltaMs: number }
  const pairs: Pair[] = []
  for (const wf of workflows) {
    const arr: Array<{ kind: string; config: Record<string, unknown> }> =
      Array.isArray(wf.triggers) && wf.triggers.length > 0
        ? (wf.triggers as Array<{ kind: string; config: Record<string, unknown> }>)
        : [wf.trigger as { kind: string; config: Record<string, unknown> }]
    const seen = new Set<string>()
    for (const t of arr) {
      if (t?.kind !== 'booking_offset') continue
      const cfg = t.config as { offset?: string; action_page_id?: string }
      if (!cfg.offset) continue
      if (cfg.action_page_id) {
        if (!payload.actionPageId || cfg.action_page_id !== payload.actionPageId) continue
      }
      const deltaMs = parseOffset(cfg.offset)
      if (deltaMs === null) continue
      if (seen.has(cfg.offset)) continue
      seen.add(cfg.offset)
      pairs.push({ wfId: wf.id, offset: cfg.offset, deltaMs })
    }
  }

  for (const { wfId, offset, deltaMs } of pairs) {
    const fireAtMs = eventMs + deltaMs
    if (Date.now() >= fireAtMs) continue
    const nextRunAt = new Date(fireAtMs).toISOString()

    try {
      await createRunsForMatchingWorkflows(admin, {
        userId: payload.userId,
        triggerKind: 'booking_offset',
        matchFn: (trigger) => {
          const cfg = trigger.config as { offset?: string; action_page_id?: string }
          if (cfg.offset !== offset) return false
          if (cfg.action_page_id) {
            if (!payload.actionPageId || cfg.action_page_id !== payload.actionPageId) return false
          }
          return true
        },
        buildDedupKey: (id) => `wf:${id}:bk:${payload.bookingEventId}:${offset}`,
        buildRunSeed: () => ({
          lead_id: payload.leadId,
          thread_id: payload.threadId,
          state: {
            variables: {
              booking_event_id: payload.bookingEventId,
              event_at: payload.eventAt,
              offset,
            },
          },
          next_run_at: nextRunAt,
        }),
      })
    } catch (e) {
      console.error('[workflow.dispatcher] dispatchBookingOffsets pair threw', { wfId, offset, e })
    }
  }
}

// ---------------------------------------------------------------------------
// Stage-idle sweep — called by the cron tick
//
// For each active workflow with a stage_idle trigger, finds leads that:
//   1. Are currently in the target stage (lead.stage_id = cfg.stage_id)
//   2. Have been there for at least cfg.min_idle_ms (last stage event created_at)
//   3. Have no inbound message in the last cfg.min_idle_ms (last_inbound_at)
//
// Uses an hourly dedup bucket so the same lead is dispatched at most once per hour.
// ---------------------------------------------------------------------------
export async function sweepStageIdleTriggers(admin: AdminClient): Promise<void> {
  const { data: workflows, error: wfErr } = await admin
    .from('workflows')
    .select('id, version, user_id, trigger, triggers')
    .eq('status', 'active')

  if (wfErr || !workflows?.length) return

  // Collect (workflow, trigger) pairs where the trigger kind is stage_idle.
  const idlePairs: Array<{ wf: typeof workflows[number]; cfg: { stage_id?: string; min_idle_ms?: number; min_idle_minutes?: number } }> = []
  for (const wf of workflows) {
    const arr: Array<{ kind: string; config: Record<string, unknown> }> =
      Array.isArray(wf.triggers) && wf.triggers.length > 0
        ? (wf.triggers as Array<{ kind: string; config: Record<string, unknown> }>)
        : [wf.trigger as { kind: string; config: Record<string, unknown> }]
    for (const t of arr) {
      if (t?.kind === 'stage_idle') {
        idlePairs.push({ wf, cfg: t.config as { stage_id?: string; min_idle_ms?: number; min_idle_minutes?: number } })
      }
    }
  }

  if (!idlePairs.length) return

  const bucket = Math.floor(Date.now() / 3_600_000).toString()

  for (const { wf, cfg } of idlePairs) {
    const stageId = cfg.stage_id
    // Accept both min_idle_ms (raw) and min_idle_minutes (UI form saves this).
    const minIdleMs = cfg.min_idle_ms
      ?? (cfg.min_idle_minutes != null ? cfg.min_idle_minutes * 60_000 : null)
      ?? 60 * 60 * 1000  // default 1h

    const idleSince = new Date(Date.now() - minIdleMs).toISOString()

    // Leads in target stage whose last stage event is old enough.
    // We join on the most recent stage event for each lead to find when they entered.
    const { data: leads, error: leadsErr } = await admin
      .from('leads')
      .select('id, user_id, messenger_threads(id, last_inbound_at)')
      .eq('user_id', wf.user_id)
      .eq('stage_id', stageId ?? '')  // empty string matches nothing if no stage_id
      .lte('updated_at', idleSince)

    if (leadsErr || !leads?.length) continue

    for (const lead of leads) {
      const threads = Array.isArray(lead.messenger_threads)
        ? lead.messenger_threads
        : lead.messenger_threads
          ? [lead.messenger_threads]
          : []
      const thread = threads[0] as { id: string; last_inbound_at: string | null } | undefined

      // Skip if there was a recent inbound — not idle.
      if (thread?.last_inbound_at && thread.last_inbound_at > idleSince) continue

      await dispatchStageIdle(admin, {
        userId: wf.user_id,
        leadId: lead.id,
        threadId: thread?.id ?? null,
        stageId: stageId ?? '',
        bucket,
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Cart-abandoned dispatch
// ---------------------------------------------------------------------------

export async function dispatchCartAbandoned(
  admin: AdminClient,
  payload: CartAbandonedPayload,
): Promise<void> {
  try {
    await createRunsForMatchingWorkflows(admin, {
      userId: payload.userId,
      triggerKind: 'cart_abandoned',
      matchFn: (trigger) => {
        const cfg = trigger.config as { source?: string }
        if (cfg.source && cfg.source !== payload.source) return false
        return true
      },
      buildDedupKey: (wfId) =>
        `wf:${wfId}:cart:${payload.cartId}`,
      buildRunSeed: () => ({
        lead_id: payload.leadId,
        thread_id: payload.threadId,
        state: {
          variables: {
            cart_id: payload.cartId,
            total_amount: payload.totalAmount,
            currency: payload.currency,
            source: payload.source,
          },
        },
        next_run_at: null,
      }),
    })
  } catch (e) {
    console.error('[workflow.dispatcher] dispatchCartAbandoned threw', e)
  }
}

// ---------------------------------------------------------------------------
// Cart-abandoned sweep — called by the cron tick
//
// Finds `active` carts that haven't been updated in min_idle_ms and marks
// them as `abandoned`, then dispatches one workflow run per matching workflow.
// Uses the cart ID as the dedup key so the same cart is only dispatched once.
// ---------------------------------------------------------------------------
export async function sweepCartAbandonedTriggers(admin: AdminClient): Promise<void> {
  const { data: workflows, error: wfErr } = await admin
    .from('workflows')
    .select('id, version, user_id, trigger, triggers')
    .eq('status', 'active')

  if (wfErr || !workflows?.length) return

  const cartPairs: Array<{
    wf: typeof workflows[number]
    cfg: { min_idle_ms?: number; source?: string }
  }> = []

  for (const wf of workflows) {
    const arr: Array<{ kind: string; config: Record<string, unknown> }> =
      Array.isArray(wf.triggers) && wf.triggers.length > 0
        ? (wf.triggers as Array<{ kind: string; config: Record<string, unknown> }>)
        : [wf.trigger as { kind: string; config: Record<string, unknown> }]
    for (const t of arr) {
      if (t?.kind === 'cart_abandoned') {
        cartPairs.push({ wf, cfg: t.config as { min_idle_ms?: number; source?: string } })
      }
    }
  }

  if (!cartPairs.length) return

  for (const { wf, cfg } of cartPairs) {
    const minIdleMs = cfg.min_idle_ms ?? 30 * 60 * 1000  // default 30 minutes
    const idleSince = new Date(Date.now() - minIdleMs).toISOString()

    const { data: carts, error: cartsErr } = await admin
      .from('carts')
      .select('id, lead_id, thread_id, total_amount, currency, source')
      .eq('user_id', wf.user_id)
      .eq('status', 'active')
      .lte('updated_at', idleSince)

    if (cartsErr || !carts?.length) continue

    for (const cart of carts as Array<{
      id: string
      lead_id: string | null
      thread_id: string | null
      total_amount: number | null
      currency: string
      source: string | null
    }>) {
      // Mark cart as abandoned
      await admin
        .from('carts')
        .update({ status: 'abandoned', abandoned_at: new Date().toISOString() })
        .eq('id', cart.id)
        .eq('status', 'active')

      await dispatchCartAbandoned(admin, {
        userId: wf.user_id,
        cartId: cart.id,
        leadId: cart.lead_id,
        threadId: cart.thread_id,
        totalAmount: cart.total_amount,
        currency: cart.currency,
        source: cart.source,
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Booking-followup cancellation
// ---------------------------------------------------------------------------

/**
 * Cancels all *waiting* workflow runs scheduled for the given booking event.
 * Matches by dedup_key pattern `wf:%:bk:{bookingEventId}:%`. Idempotent.
 */
export async function cancelBookingFollowups(
  admin: AdminClient,
  bookingEventId: string,
): Promise<void> {
  try {
    const pattern = `wf:%:bk:${bookingEventId}:%`
    const { error } = await admin
      .from('workflow_runs')
      .update({
        status: 'cancelled',
        next_run_at: null,
        cancel_reason: 'booking_cancelled',
      })
      .eq('status', 'waiting')
      .like('dedup_key', pattern)
    if (error) {
      console.error('[workflow.dispatcher] cancelBookingFollowups failed', error.message)
    }
  } catch (e) {
    console.error('[workflow.dispatcher] cancelBookingFollowups threw', e)
  }
}
