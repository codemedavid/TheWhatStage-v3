import { timingSafeEqual } from 'node:crypto'
import * as Sentry from '@sentry/nextjs'
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptToken } from '@/lib/facebook/crypto'
import {
  fetchMessengerProfile,
  sendMessengerImage,
  sendMessengerSenderAction,
} from '@/lib/facebook/messenger'
import { sendOutbound, sendProductRecommendation } from '@/lib/messenger/outbound'
import { recommendProduct } from '@/lib/chatbot/recommend'
import {
  sendPropertyRecommendation,
  buildRealestateCarouselElements,
} from '@/lib/messenger/property-outbound'
import { recommendProperty } from '@/lib/chatbot/recommend-property'
import { handleCampaignSend } from '@/lib/messenger/campaignSend'
import { handleReminderFire } from '@/lib/reminders/fire'
import { maybeScheduleFollowup } from '@/lib/followups/seed'
import { handleFollowupSendJob } from '@/lib/followups/fire'
import { extractReminder, type ExtractedReminder } from '@/lib/reminders/extract'
import { resolveTopics, type PendingReminder } from '@/lib/reminders/resolve'
import { seedReminderSequence } from '@/lib/reminders/sequence-seed'
import { resolveActiveSequence } from '@/lib/reminders/sequence-resolve'
import { deeplinkActionPageUrl } from '@/lib/action-pages/urls'
import { fetchPublicCatalogProducts, type PublicProductCard } from '@/lib/business/public-dto'
import type { MessengerGenericElement } from '@/lib/facebook/messenger'
import { parseRealestateConfig } from '@/app/a/[slug]/_kinds/realestate/schema'
import { appendLeadContacts, extractEmails, extractPhones } from '@/lib/leads/contact-append'
import {
  answer,
  shouldRollSummary,
  summarizeConversation,
  type AnswerHistory,
} from '@/lib/chatbot/answer'
import { type SelectedMediaAsset } from '@/lib/media/selector'
import {
  answerWithClassification,
  applyStageChange,
  classifyOnly,
  type ActionPageBrief,
  type StageBrief,
} from '@/lib/chatbot/classify'
import { getChatbotConfig, type ChatbotConfig } from '@/lib/chatbot/config'
import { loadLeadContext } from '@/lib/chatbot/leadContext'
import { interruptWorkflowRun } from '@/lib/workflow/trigger'
import { runDeepReclassify } from '@/lib/chatbot/deep-reclassify'
import { isBotPaused } from '@/lib/chatbot/takeover'
import { resolveSourceImages } from '@/lib/chatbot/source-images'
import { firstMentionGate } from '@/lib/chatbot/attach-gate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_ATTEMPTS = 3
// Rate-limit (429) errors get a softer cap so a transient burst against
// OpenAI/Anthropic or Meta doesn't drop the message after three minutes.
// Each retry reschedules with jittered backoff (see isRateLimitError below).
const MAX_RATE_LIMIT_ATTEMPTS = 10
// How many turns we LOAD from storage (used for the rolling summary trigger
// and to keep the local cache fresh). The LLM payload is a smaller slice — see
// LLM_HISTORY_TURNS below.
const HISTORY_LIMIT = 40
// How many of the most recent turns we actually send into the LLM prompt.
// Anything older is compressed into `messenger_threads.conversation_summary`
// via the rolling-summary trigger and injected as a single block instead.
// 12 covers ~6 customer/bot exchanges — enough for short-term context without
// re-paying ~30 turns of prompt tokens on long Messenger threads.
const LLM_HISTORY_TURNS = 12
// Rolling summary cadence: every N turns past the LLM window, refresh the
// summary so older context isn't lost. Cheap LLM call, fire-and-forget.
const SUMMARY_INTERVAL_TURNS = 8
// How many disjoint-thread jobs one invocation processes in parallel per claim.
// The SQL claim guarantees the batch contains no two jobs for the same thread,
// so Promise.allSettled over the batch is safe. Env-tunable so we can widen
// per-invocation parallelism without a deploy. Default 8 (was 3).
const BATCH_SIZE = Math.max(1, Number(process.env.MESSENGER_WORKER_BATCH_SIZE) || 8)
// Bounded worker self-fan-out: when an invocation claims a FULL batch (backlog
// likely exceeds what one invocation can drain in time), it kicks one more
// worker invocation and stamps an incrementing x-fanout-depth. Each generation
// kicks at most one child, so the live worker pool grows with backlog up to
// (WORKER_FANOUT_MAX + 1) invocations and stops as soon as batches stop coming
// back full. The SQL claim keeps every invocation on disjoint threads.
const WORKER_FANOUT_MAX = Math.max(0, Number(process.env.MESSENGER_WORKER_FANOUT_MAX) || 6)

// Recognise rate-limit errors from any of the upstream APIs the worker calls:
//   - Meta Graph: `Graph 429: ...`
//   - OpenAI / Anthropic SDKs: messages like `429 status code (no body)` or
//     `Rate limit reached` / `Too Many Requests` / `rate_limit_exceeded`
// Anything matching counts as a soft failure: the job is requeued with a
// longer, jittered backoff and does NOT consume a normal attempt slot.
function isRateLimitError(msg: string): boolean {
  const m = msg.toLowerCase()
  return (
    m.includes('429') ||
    m.includes('rate limit') ||
    m.includes('rate_limit') ||
    m.includes('too many requests') ||
    m.includes('overloaded') ||
    // Meta Graph throttles that arrive on HTTP 400/200, not 429:
    //   #4 app / #17 user / #32 page "request limit reached", #613 rate limit.
    // messenger.ts surfaces the numeric code in the thrown message.
    m.includes('request limit reached') ||
    /\(code (4|17|32|613)\)/.test(m)
  )
}

// Backoff for rate-limited retries: 30s, 45s, 67s, 100s, ... capped at 5 min,
// with ±25% jitter so concurrent workers don't synchronize their retries.
function rateLimitBackoffMs(attempt: number): number {
  const base = Math.min(30_000 * Math.pow(1.5, Math.max(0, attempt - 1)), 300_000)
  const jitter = base * (Math.random() * 0.5 - 0.25)
  return Math.floor(base + jitter)
}
// How long a job may sit in `running` without a heartbeat before another
// worker may reclaim it. Lowered from 5 min → 90 s so the worst-case
// wait when a worker crashes mid-job is ~90 s instead of ~5 min.
// `runJob` calls `startHeartbeat` to bump `started_at` every 30 s so a
// healthy long-running job (slow LLM, rate-limited upstream) is never
// considered stale.
const RUNNING_STALE_MS = 90 * 1000
// How often the heartbeat ticks. Must be < RUNNING_STALE_MS / 2 so we
// tolerate at least one missed heartbeat before stale-reclaim fires.
const HEARTBEAT_INTERVAL_MS = 30 * 1000
const CLASSIFY_EVERY = 4
// Stop claiming new batches once this much wall-clock has elapsed in the
// invocation. Leaves headroom under maxDuration=300 for the longest
// in-flight batch: a pessimistic job (slow LLM tail + several media sends)
// plus a same-time batch can run ~80s, so a claim at the deadline must still
// finish well under 300s. Lowered 200s → 165s to widen that margin now that
// self-fan-out spreads backlog across more invocations.
const DRAIN_DEADLINE_MS = 165_000
// When a claim comes back empty but queued jobs exist with a near-future
// scheduled_at (rate-limit backoff), a warm worker waits for them instead of
// exiting and leaving recovery to the 1-minute cron. Only waits for jobs due
// within this window; anything further out is left to the cron / next webhook.
const DRAIN_WAIT_MAX_MS = 20_000
// Floor on the wait so we never busy-spin when the only queued jobs belong to
// threads currently running in another invocation (claim returns [] but a job
// is "due now").
const DRAIN_WAIT_MIN_MS = 1_000

type AdminClient = ReturnType<typeof createAdminClient>

// Surface a terminally-failed job to Sentry. The job state machine already
// records `status='failed'` + `last_error`, but Sentry's auto-instrumentation
// never sees these because the per-kind catch blocks swallow the error (they
// requeue/park rather than rethrow). Without this, a Meta/OpenRouter outage can
// fail thousands of replies with the operator finding out only from customer
// complaints. Capture is best-effort and must never throw into the worker.
function captureJobFailure(
  err: unknown,
  job: { id: string; thread_id: string; kind: string },
): void {
  try {
    Sentry.captureException(err, {
      tags: { jobKind: job.kind, jobId: job.id, threadId: job.thread_id },
      level: 'error',
    })
  } catch {
    /* Sentry must never break the worker */
  }
}

interface JobRow {
  id: string
  thread_id: string
  inbound_msg_id: string | null
  user_id: string
  attempts: number
  outbound_text_fb_id: string | null
  outbound_button_fb_id: string | null
  outbound_media: Array<{ media_asset_id: string; fb_message_id: string }>
  kind: string
  payload: Record<string, unknown> | null
}

interface ThreadRow {
  id: string
  user_id: string
  page_id: string
  psid: string
  lead_id: string | null
  full_name: string | null
  auto_reply_enabled: boolean
  bot_paused_until: string | null
  inbound_since_classify: number
  conversation_summary: string | null
  last_inbound_at: string | null
  controlled_by_run_id: string | null
  attached_item_keys: string[]
}

export async function POST(req: NextRequest) {
  const secret = process.env.MESSENGER_WORKER_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'worker not configured' }, { status: 500 })
  }
  const got = req.headers.get('x-worker-secret') ?? ''
  const a = Buffer.from(got)
  const b = Buffer.from(secret)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const depth = Math.max(0, Number(req.headers.get('x-fanout-depth')) || 0)
  const admin = createAdminClient()
  const result = await drainMessengerJobs(admin, depth)
  return NextResponse.json(result)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Kick one more worker invocation, stamping an incremented fan-out depth so the
 * chain is self-limiting (stops at WORKER_FANOUT_MAX). Fire-and-forget: the
 * child runs as its own Vercel invocation. Gated by the same secret as the
 * webhook trigger so it can't be invoked by outsiders. Never throws.
 */
function selfFanOut(depth: number): void {
  if (depth >= WORKER_FANOUT_MAX) return
  const base = process.env.NEXT_PUBLIC_APP_URL
  const secret = process.env.MESSENGER_WORKER_SECRET
  if (!base || !secret) return
  void fetch(`${base}/api/messenger/process`, {
    method: 'POST',
    headers: { 'x-worker-secret': secret, 'x-fanout-depth': String(depth + 1) },
  }).catch((e) => console.warn('[messenger.worker] self fan-out failed', e))
}

/**
 * Milliseconds until the next queued job becomes due, or null when no queued
 * jobs remain. Used to keep a warm worker alive across short rate-limit
 * backoffs instead of exiting and waiting on the 1-minute cron.
 */
async function msUntilNextQueued(admin: AdminClient): Promise<number | null> {
  const { data, error } = await admin
    .from('messenger_jobs')
    .select('scheduled_at')
    .eq('status', 'queued')
    .order('scheduled_at', { ascending: true })
    .limit(1)
    .maybeSingle<{ scheduled_at: string }>()
  if (error || !data?.scheduled_at) return null
  return Math.max(0, Date.parse(data.scheduled_at) - Date.now())
}

/**
 * Drain loop. Repeatedly claim batches and process them in parallel until the
 * queue is empty (and no near-future backoff jobs remain) or the wall-clock
 * deadline is reached.
 *
 * Per-thread serialization is enforced by the SQL claim function: no two rows
 * in a single batch share a thread_id, and no thread with a `running` job is
 * reclaimable. That makes `Promise.allSettled` over the batch safe — parallel
 * jobs touch disjoint conversations — AND makes it safe for the additional
 * invocations spawned by `selfFanOut` to drain concurrently.
 *
 * The per-job try/catch is kept (via allSettled + individual catch) so one
 * failed job never poisons the batch.
 */
async function drainMessengerJobs(
  admin: AdminClient,
  depth = 0,
): Promise<{ processed: number; batches: number }> {
  const startedAt = Date.now()
  const claimDeadline = startedAt + DRAIN_DEADLINE_MS
  let processed = 0
  let batches = 0
  let firedChild = false
  while (Date.now() < claimDeadline) {
    const jobs = await claimJobs(admin, BATCH_SIZE)
    if (jobs.length === 0) {
      // Queue drained for now. If a backoff-scheduled job is due soon, wait for
      // it; otherwise let the cron / next webhook pick up far-future work.
      const waitMs = await msUntilNextQueued(admin)
      if (waitMs === null || waitMs > DRAIN_WAIT_MAX_MS) break
      const remaining = claimDeadline - Date.now()
      if (remaining <= DRAIN_WAIT_MIN_MS) break
      await sleep(Math.min(Math.max(waitMs, DRAIN_WAIT_MIN_MS), remaining))
      continue
    }
    // A full batch means there is probably more backlog than one invocation
    // can clear in time — spread it across another invocation (once per worker).
    if (!firedChild && jobs.length >= BATCH_SIZE) {
      firedChild = true
      selfFanOut(depth)
    }
    batches += 1
    await Promise.allSettled(
      jobs.map((job) =>
        runJob(admin, job).catch((e) => {
          console.error('[messenger.worker] runJob threw', job.id, e)
        }),
      ),
    )
    processed += jobs.length
  }
  return { processed, batches }
}

/**
 * Claim queued jobs via the `claim_messenger_jobs` SECURITY DEFINER RPC.
 * Returns at most one job per thread_id, so two worker invocations can never
 * reply to the same Messenger conversation in parallel. The RPC also resets
 * stuck running jobs (started_at older than RUNNING_STALE_MS) before its
 * scan, so a crashed invocation's jobs become reclaimable without a cron.
 */
async function claimJobs(admin: AdminClient, limit: number): Promise<JobRow[]> {
  const { data, error } = await admin.rpc('claim_messenger_jobs', {
    p_limit: limit,
    p_stale_seconds: Math.floor(RUNNING_STALE_MS / 1000),
  })
  if (error) {
    console.error('[messenger.worker] claim rpc failed', error)
    return []
  }
  return ((data ?? []) as JobRow[]).map((row) => ({
    ...row,
    outbound_media: Array.isArray(row.outbound_media) ? row.outbound_media : [],
    kind: row.kind ?? 'inbound_reply',
    payload: row.payload ?? null,
  }))
}

async function runJob(admin: AdminClient, job: JobRow): Promise<void> {
  // Branch on job kind before any inbound-specific logic.
  if (job.kind === 'reminder_fire') {
    try {
      await handleReminderFire(admin, {
        id: job.id,
        payload: job.payload as { reminder_id: string } | null,
      })
    } catch (err) {
      const attempts = job.attempts + 1
      const failed = attempts >= MAX_ATTEMPTS
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[messenger.worker] reminder job error', job.id, msg)
      if (failed) captureJobFailure(err, job)
      await admin
        .from('messenger_jobs')
        .update({
          status: failed ? 'failed' : 'queued',
          attempts,
          last_error: msg.slice(0, 1000),
          scheduled_at: new Date(Date.now() + Math.min(60_000 * attempts, 300_000)).toISOString(),
          finished_at: failed ? new Date().toISOString() : null,
          started_at: null,
        })
        .eq('id', job.id)
    }
    return
  }

  if (job.kind === 'agent_campaign_send') {
    try {
      await handleCampaignSend(admin, {
        id: job.id,
        thread_id: job.thread_id,
        user_id: job.user_id,
        payload: job.payload as { campaign_message_id: string } | null,
      })
    } catch (err) {
      const attempts = job.attempts + 1
      const failed = attempts >= MAX_ATTEMPTS
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[messenger.worker] campaign job error', job.id, msg)
      if (failed) captureJobFailure(err, job)
      await admin
        .from('messenger_jobs')
        .update({
          status: failed ? 'failed' : 'queued',
          attempts,
          last_error: msg.slice(0, 1000),
          scheduled_at: new Date(Date.now() + Math.min(60_000 * attempts, 300_000)).toISOString(),
          finished_at: failed ? new Date().toISOString() : null,
          started_at: null,
        })
        .eq('id', job.id)
    }
    return
  }

  if (job.kind === 'followup_send') {
    await handleFollowupSendJob(admin, {
      id: job.id,
      payload: job.payload as { schedule_id: string } | null,
    })
    return
  }

  const stopHeartbeat = startHeartbeat(admin, job.id)
  try {
    // Read the inbound message + its parent thread in a single FK-joined query.
    // This avoids a first-touch race where the worker beats the webhook's
    // thread/message writes to a pooled read connection: if the message row
    // is visible, the thread row it references is guaranteed visible too.
    const loaded = await loadJobContext(admin, job)
    if (!loaded) {
      // Orphan job — message (and possibly thread) were deleted. Don't retry.
      await markDone(admin, job.id, 'skipped', 'inbound message missing')
      return
    }
    const { thread, message: inboundBody, inboundFbId } = loaded

    const { data: page, error: pageErr } = await admin
      .from('facebook_pages')
      .select('id, page_access_token, name')
      .eq('id', thread.page_id)
      .single<{ id: string; page_access_token: string; name: string }>()
    if (pageErr || !page) throw new Error(`page ${thread.page_id} missing`)

    const pageToken = decryptToken(page.page_access_token)

    // First-touch: enrich the thread + create a lead.
    if (!thread.lead_id) {
      await ensureLead(admin, thread, pageToken)
      thread.lead_id = await loadThreadLeadId(admin, thread.id)
    } else if (isGenericName(thread.full_name)) {
      // Thread already exists from an earlier run that couldn't resolve a
      // real name. Re-fetch and self-heal both the thread and its lead.
      await refreshNames(admin, thread, pageToken)
    }

    const message = inboundBody.trim()
    if (!message) {
      await markDone(admin, job.id, 'skipped', 'empty inbound body')
      return
    }

    // In-memory mutation so sendOutbound's 24h check sees a fresh value; the
    // DB write is deferred since the bot reply doesn't depend on its result.
    const inboundAt = new Date().toISOString()
    thread.last_inbound_at = inboundAt
    void admin
      .from('messenger_threads')
      .update({ last_inbound_at: inboundAt })
      .eq('id', thread.id)
      .then(
        () => {},
        (e) => console.warn('[messenger.worker] last_inbound_at update failed', e),
      )

    // Bridge any pending Facebook comment private-reply rows to this lead.
    // Defer — the bot reply doesn't read this back.
    void resolveCommentBridgesForThread(admin, {
      pageId: thread.page_id,
      psid: thread.psid,
      leadId: thread.lead_id,
    }).catch((e) => console.warn('[messenger.worker] resolveCommentBridges failed', e))

    // Kick off the heavy reply-context preload now — it depends only on the
    // thread + inbound id (both already resolved) and not on the reminder
    // extraction below, so overlap them instead of paying both serially in
    // front of the LLM. Awaited further down (`const ctx = await ctxPromise`).
    const ctxPromise = loadReplyContext(admin, {
      thread,
      inboundMsgId: job.inbound_msg_id,
    })
    // Neutralize the orphaned-rejection window: if an await BETWEEN here and
    // `await ctxPromise` (below) throws, we'd never attach a handler and a
    // ctxPromise rejection would surface as an unhandled rejection (which can
    // tear down the whole batch invocation). This no-op marks it handled; the
    // real error still propagates to the outer try/catch via `await ctxPromise`.
    ctxPromise.catch(() => {})

    // Synchronous reminder detection BEFORE bot reply, so we know whether to
    // suppress the default auto silent-followup for this lead. The hasTimeMarker
    // pre-filter inside extractReminder keeps median-latency cost ~0.
    const extractedReminder: ExtractedReminder | null = await extractReminder(message).catch(
      (e) => {
        console.warn('[messenger.worker] extractReminder failed', e)
        return null
      },
    )

    // Skip the auto silent-followup if (a) the customer just asked for a
    // dated follow-up OR (b) an active reminder sequence already exists.
    let activeSequenceExists = false
    if (thread.lead_id && !extractedReminder) {
      const { data: activeSeq } = await admin
        .from('lead_reminder_sequences')
        .select('id')
        .eq('lead_id', thread.lead_id)
        .eq('status', 'active')
        .maybeSingle<{ id: string }>()
      activeSequenceExists = !!activeSeq
    }
    const suppressFollowup = !!extractedReminder || activeSequenceExists

    if (thread.lead_id && !suppressFollowup) {
      const leadIdForFu = thread.lead_id
      void maybeScheduleFollowup(admin, {
        threadId: thread.id,
        leadId: leadIdForFu,
        userId: thread.user_id,
        pageId: thread.page_id,
        lastInboundAt: inboundAt,
      }).catch((e) => console.warn('[messenger.worker] followup seed failed', e))
    } else if (thread.lead_id) {
      // Cancel any active default auto-followup row for this thread — it
      // would otherwise duplicate the reminder sequence's outreach.
      const threadIdForCancel = thread.id
      void admin
        .from('lead_followup_schedules')
        .update({ status: 'cancelled' })
        .eq('thread_id', threadIdForCancel)
        .in('status', ['pending', 'running'])
        .then(
          () => {},
          (e) => console.warn('[messenger.worker] followup cancel failed', e),
        )
    }

    // Auto-detect phone numbers and emails shared by the lead — defer; the
    // bot's reply doesn't depend on persisting these.
    if (thread.lead_id) {
      const detectedPhones = extractPhones(message)
      const detectedEmails = extractEmails(message)
      if (detectedPhones.length || detectedEmails.length) {
        const leadIdForContacts = thread.lead_id
        void appendLeadContacts(admin, leadIdForContacts, {
          phones: detectedPhones,
          emails: detectedEmails,
          source: 'messenger',
        }).catch((e) => console.warn('[messenger.worker] appendLeadContacts failed', e))
      }
    }

    // Parallel context preload: chatbot_configs, pipeline_stages, lead row,
    // history, lead-context block, sendable action_pages — then campaign +
    // funnels in a second parallel round if the lead is on a campaign.
    // Replaces ~7 serial round-trips (~2s) with ~2 parallel rounds (~600ms).
    const ctx = await ctxPromise
    const config = ctx.config
    const classifyEnabled = config.autoClassifyEnabled
    const stages = classifyEnabled ? ctx.stages : ([] as StageBrief[])
    const currentStageId = classifyEnabled ? ctx.currentStageId : null
    const campaign = ctx.campaign
    const activeFunnel = campaign?.activeFunnel ?? null
    const sendablePages = ctx.sendablePages
    const leadContextBlock = ctx.leadContextBlock
    const history = ctx.history

    const campaignPersona = campaign
      ? (() => {
          const funnelInstruction = activeFunnel?.instruction?.trim() || undefined
          const funnelDoRules = (activeFunnel?.rules ?? [])
            .filter((r) => r.kind === 'do')
            .map((r) => r.text)
            .filter(Boolean)
          const funnelDontRules = (activeFunnel?.rules ?? [])
            .filter((r) => r.kind === 'dont')
            .map((r) => r.text)
            .filter(Boolean)
          const allDoRules = [...(campaign.do_rules ?? []), ...funnelDoRules]
          const allDontRules = [...(campaign.dont_rules ?? []), ...funnelDontRules]
          return {
            // Persona override only in custom mode — chatbot mode uses base config persona
            ...(campaign.personality_mode === 'custom' && campaign.persona
              ? { persona: campaign.persona }
              : {}),
            ...(allDoRules.length ? { doRules: allDoRules } : {}),
            ...(allDontRules.length ? { dontRules: allDontRules } : {}),
            ...(funnelInstruction ? { funnelInstruction } : {}),
          }
        })()
      : undefined

    // Resolve !actionpage:slug mentions in the chatbot's instructions.
    // Uses the already-loaded config.instructions — no extra DB fetch.
    let resolvedInstructions: string | undefined
    if (thread.auto_reply_enabled) {
      const rawInstr = config.instructions ?? ''
      const mentionedSlugs = parseActionPageMentions(rawInstr)
      if (mentionedSlugs.length > 0) {
        const existingSlugs = new Set(sendablePages.map((p) => p.slug))
        const newSlugs = mentionedSlugs.filter((s) => !existingSlugs.has(s))
        if (newSlugs.length > 0) {
          const { data: mentionedPages } = await admin
            .from('action_pages')
            .select('id, slug, title, cta_label, signing_secret, kind, config, user_id')
            .eq('user_id', thread.user_id)
            .eq('status', 'published')
            .in('slug', newSlugs)
          for (const p of (mentionedPages ?? []) as Array<{
            id: string; slug: string; title: string; cta_label: string | null
            signing_secret: string; kind: string; config: unknown; user_id: string
          }>) {
            if (p.cta_label?.trim()) {
              sendablePages.push({
                id: p.id,
                slug: p.slug,
                title: p.title,
                cta_label: p.cta_label.trim(),
                bot_send_instructions: 'See chatbot instructions above',
                signing_secret: p.signing_secret,
                kind: p.kind,
                config: (p.config as Record<string, unknown> | null) ?? null,
                user_id: p.user_id,
              })
            }
          }
        }
        const slugToTitle = new Map(sendablePages.map((p) => [p.slug, p.title]))
        resolvedInstructions = rawInstr.replace(
          /!actionpage:([a-z0-9][a-z0-9_-]*)/gi,
          (_, slug: string) => {
            const title = slugToTitle.get(slug)
            return title ? `[Action Page: "${title}"]` : `[Action Page: "${slug}"]`
          },
        )
      }
    }

    const actionPages: ActionPageBrief[] = sendablePages.map((p) => ({
      id: p.id,
      title: p.title,
      cta_label: p.cta_label,
      bot_send_instructions: p.bot_send_instructions,
    }))

    // When a workflow run owns this thread, suppress the auto-reply — the run
    // is waiting for the customer's response and will handle the next step.
    // Classification still runs (below) so stage moves and interrupt routing
    // remain active even while the bot is deferred.
    if (thread.controlled_by_run_id) {
      console.log('[messenger.worker] thread owned by workflow run — auto-reply suppressed', {
        threadId: thread.id,
        runId: thread.controlled_by_run_id,
      })
      interruptWorkflowRun(admin, thread.controlled_by_run_id, {
        kind: 'inbound_message',
        body: message,
        fb_message_id: inboundFbId,
      }).catch((e) => console.error('[messenger.worker] interruptWorkflowRun threw', e))
    }

    if (
      thread.auto_reply_enabled
      && !isBotPaused(thread.bot_paused_until)
      && !thread.controlled_by_run_id
    ) {
      // Best-effort presence signal: typing_on shows the typing bubble while
      // the LLM runs, auto-clearing after ~20s or on the next outbound, so no
      // explicit typing_off is needed. Page Reactions used to live here but
      // Meta has effectively gated the API (#100 "invalid or not present" on
      // every call) and each failed attempt burns against the page rate limit.
      // Fire-and-forget: awaiting the typing bubble added a serial Graph
      // round-trip in front of every reply LLM call for a purely cosmetic
      // signal. The 8s read-timeout in messenger.ts bounds the detached call.
      void sendMessengerSenderAction({
        pageAccessToken: pageToken,
        recipientPsid: thread.psid,
        action: 'typing_on',
      }).catch((e) => {
        console.warn('[messenger.worker] typing_on send failed', {
          err: e instanceof Error ? e.message : String(e),
        })
      })

      // Combined call: reply + (optional) stage classification + action page choice in one shot.
      let reply = ''
      let stageChange: Awaited<ReturnType<typeof answerWithClassification>>['stageChange'] = null
      let actionPageChoice: Awaited<ReturnType<typeof answerWithClassification>>['actionPage'] = null
      let productRecommendation: Awaited<
        ReturnType<typeof answerWithClassification>
      >['productRecommendation'] = null
      let propertyRecommendation: Awaited<
        ReturnType<typeof answerWithClassification>
      >['propertyRecommendation'] = null
      let selectedMedia: SelectedMediaAsset[] = []
      let topChunks: Awaited<ReturnType<typeof answerWithClassification>>['topChunks'] = []
      const activeCatalogPageId = sendablePages.find((p) => p.kind === 'catalog')?.id ?? null
      const activeRealestatePageId = sendablePages.find((p) => p.kind === 'realestate')?.id ?? null
      const conversationSummary = thread.conversation_summary ?? undefined
      const effectivePersona = resolvedInstructions !== undefined
        ? { ...(campaignPersona ?? {}), instructions: resolvedInstructions }
        : campaignPersona
      // Send only the most recent LLM_HISTORY_TURNS turns into the LLM. The
      // full 40-turn `history` is still kept around for the rolling-summary
      // trigger below and any classifier-only path that needs broader context.
      const llmHistory =
        history.length > LLM_HISTORY_TURNS ? history.slice(-LLM_HISTORY_TURNS) : history
      if ((classifyEnabled && stages.length > 0) || actionPages.length > 0) {
        try {
          const r = await answerWithClassification(
            admin,
            thread.user_id,
            message,
            llmHistory,
            stages,
            currentStageId,
            {
              rpcName: 'match_knowledge_hybrid_service',
              actionPages,
              campaignPersona: effectivePersona,
              conversationSummary,
              activeCatalogPageId,
              activeRealestatePageId,
              leadContextBlock,
              leadName: thread.full_name ?? undefined,
              preloadedConfig: config,
              leadId: thread.lead_id ?? null,
              threadId: thread.id,
            },
          )
          reply = r.text.trim()
          stageChange = r.stageChange
          actionPageChoice = r.actionPage
          productRecommendation = r.productRecommendation
          propertyRecommendation = r.propertyRecommendation
          selectedMedia = r.media
          topChunks = r.topChunks
        } catch (e) {
          console.error('[messenger.worker] combined call failed, falling back', e)
        }
      }
      if (!reply) {
        const r = await answer(admin, thread.user_id, message, llmHistory, {
          rpcName: 'match_knowledge_hybrid_service',
          campaignPersona: effectivePersona,
          conversationSummary,
          leadContextBlock,
          leadName: thread.full_name ?? undefined,
          preloadedConfig: config,
        })
        reply = r.text.trim()
        selectedMedia = r.media
      }
      if (!reply) {
        await markDone(admin, job.id, 'skipped', 'empty reply')
        return
      }

      // Send via the unified outbound coordinator (M2 fix). Idempotent on retry:
      // if a previous attempt already got a message_id, skip the call.
      // sendOutbound enforces the 24h / marketing-opt-in / OTN channel policy.
      let textFbId = job.outbound_text_fb_id
      if (!textFbId) {
        const result = await sendOutbound({
          admin,
          thread: { id: thread.id, psid: thread.psid, last_inbound_at: thread.last_inbound_at },
          pageToken,
          payload: { kind: 'text', text: reply },
          kind: 'bot',
        })
        if (!result.sent) {
          // Policy blocked (outside 24h and no qualifying opt-in/OTN).
          // Log and skip — don't retry; the window won't reopen on its own.
          console.warn('[messenger.worker] text send policy_blocked', {
            threadId: thread.id,
            reason: (result as { sent: false; reason: string }).reason,
          })
          await markDone(admin, job.id, 'skipped', 'policy_blocked')
          return
        }
        // Graph returns a message_id on success. In the rare case it reports
        // sent:true with no id, fall back to a synthetic per-job marker so the
        // idempotency key is ALWAYS persisted — otherwise a retry would re-send
        // and duplicate the reply. The marker is only ever used as an
        // idempotency guard and as messenger_messages.fb_message_id (dedup), so
        // a non-Graph value is safe here.
        textFbId = result.messageId ?? `sent:${job.id}`
        await admin
          .from('messenger_jobs')
          .update({ outbound_text_fb_id: textFbId })
          .eq('id', job.id)
      }

      // Persist the outbound message and update thread tail. The unique
      // constraint on fb_message_id catches the case where a previous
      // attempt already wrote this row (FB ack + row insert succeeded,
      // then a *later* step failed and forced retry).
      const { error: textInsertErr } = await admin
        .from('messenger_messages')
        .insert({
          thread_id: thread.id,
          user_id: thread.user_id,
          direction: 'outbound',
          sender: 'bot',
          fb_message_id: textFbId,
          body: reply,
        })
      if (textInsertErr && (textInsertErr as { code?: string }).code !== '23505') {
        throw textInsertErr
      }
      await admin
        .from('messenger_threads')
        .update({
          last_message_at: new Date().toISOString(),
          last_message_preview: reply.slice(0, 200),
          last_outbound_at: new Date().toISOString(),
          inbound_since_classify: 0,
        })
        .eq('id', thread.id)

      // Fire-and-forget: detect customer follow-up requests in this inbound
      // message AND auto-resolve any pending reminders that this message
      // addresses. Runs after the bot reply so it never blocks the conversation.
      if (thread.lead_id) {
        const leadId = thread.lead_id
        const inboundMsgId = job.inbound_msg_id
        const userId = thread.user_id
        const threadId = thread.id
        const personalityBlock = [config?.persona, config?.instructions]
          .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
          .join('\n\n')
        const leadName = thread.full_name ?? null
        void processReminderHooks(admin, {
          userId,
          leadId,
          threadId,
          inboundText: message,
          inboundMsgId,
          extracted: extractedReminder,
          leadName,
          personalityBlock,
        }).catch((e) => console.warn('[messenger.worker] reminder hooks failed', e))
      }

      // Rolling summary: refresh `conversation_summary` every
      // SUMMARY_INTERVAL_TURNS turns once history exceeds the LLM window.
      // shouldRollSummary fires on an EXACT modulo boundary, so the COUNT must
      // be taken HERE — before the later recommendation / action-page message
      // inserts in this same job — to reproduce the pre-change count value
      // deterministically. (A detached COUNT would race those inserts and
      // intermittently skip or duplicate the roll.) Only the LLM summarize call
      // and the write stay fire-and-forget, so the single indexed COUNT is the
      // only thing on the path and the customer-visible sends below are never
      // gated on the summary. Nothing later in this job reads conversation_summary.
      const totalThreadMessages = await countThreadMessages(admin, thread.id)
      if (shouldRollSummary(totalThreadMessages, LLM_HISTORY_TURNS, SUMMARY_INTERVAL_TURNS)) {
        void (async () => {
          const summary = await summarizeConversation(history, message, reply, conversationSummary)
          if (summary) {
            await admin
              .from('messenger_threads')
              .update({ conversation_summary: summary })
              .eq('id', thread.id)
          }
        })().catch((e) => console.warn('[messenger.worker] rolling summary failed', e))
      }

      console.log('[messenger.worker] media handoff', {
        jobId: job.id,
        threadId: thread.id,
        selectedCount: selectedMedia.length,
        slugs: selectedMedia.map((m) => m.slug),
        alreadySent: job.outbound_media.length,
      })
      await sendSelectedMedia(admin, { job, thread, pageToken, selectedMedia })

      // Source-image attach: send first-mention product/payment images from RAG chunks
      if (topChunks && topChunks.length > 0) {
        try {
          const sourceImages = await resolveSourceImages(admin, topChunks)
          if (sourceImages.length > 0) {
            const gateResult = firstMentionGate({
              candidates: sourceImages,
              attachedItemKeys: thread.attached_item_keys ?? [],
              customerText: message,
            })
            for (const img of gateResult.approved) {
              await sendOutbound({
                admin,
                thread: { id: thread.id, psid: thread.psid, last_inbound_at: thread.last_inbound_at },
                pageToken,
                payload: { kind: 'image', imageUrl: img.imageUrl },
                kind: 'bot',
              })
              // Persist this key IMMEDIATELY after its send (REL-5) rather than
              // writing the merged set only after the whole loop. If the job
              // crashes / is stale-reclaimed mid-loop, the retry's firstMentionGate
              // sees the already-attached key and skips the re-send. (Visual-intent
              // re-sends of already-attached keys remain intentional and unaffected,
              // since the gate re-approves them regardless of this set.)
              const attached = thread.attached_item_keys ?? []
              if (!attached.includes(img.sourceKey)) {
                const trimmed = [...attached, img.sourceKey].slice(-100)
                await admin
                  .from('messenger_threads')
                  .update({ attached_item_keys: trimmed })
                  .eq('id', thread.id)
                thread.attached_item_keys = trimmed
              }
            }
          }
        } catch (e) {
          console.warn('[messenger.worker] source-image attach failed', e)
        }
      }

      // Product recommendation — fired when the LLM picked recommend_product
      // (customer explicitly asked OR operator rules triggered). Sends the
      // matched product's image + a single-product button card. When it
      // succeeds we skip the catalog carousel below to avoid double-sending.
      //
      // Idempotency (REL-2): the reply LLM re-runs on every retry, so without a
      // guard a requeue would re-run the RAG match AND re-send a button card.
      // A stamped outbound_button_fb_id means a prior attempt already delivered
      // a button (recommendation OR action-page) for this job — treat the
      // recommendation as already sent and skip both the match and the send,
      // mirroring the action-page block's `if (job.outbound_button_fb_id)` skip.
      let recommendationSent = Boolean(job.outbound_button_fb_id)
      if (!recommendationSent && productRecommendation && activeCatalogPageId) {
        const catalogPage = sendablePages.find((p) => p.id === activeCatalogPageId)
        if (catalogPage) {
          try {
            const match = await recommendProduct(
              { client: admin },
              {
                userId: thread.user_id,
                actionPageId: catalogPage.id,
                query: productRecommendation.query,
                filters: {
                  priceMin: productRecommendation.filters.priceMin,
                  priceMax: productRecommendation.filters.priceMax,
                  tags: productRecommendation.filters.tags,
                },
                confidenceThreshold: productRecommendation.confidenceThreshold,
              },
            )
            if (match.ok) {
              const sendResult = await sendProductRecommendation({
                admin,
                thread: {
                  id: thread.id,
                  psid: thread.psid,
                  last_inbound_at: thread.last_inbound_at,
                },
                pageToken,
                facebookPageId: thread.page_id,
                page: {
                  id: catalogPage.id,
                  slug: catalogPage.slug,
                  signing_secret: catalogPage.signing_secret,
                },
                product: {
                  id: match.product.id,
                  slug: match.product.slug,
                  title: match.product.title,
                  price_label: match.product.price_label,
                  cover_image_url: match.product.cover_image_url,
                  summary: match.product.summary,
                  description: match.product.description,
                },
                confidence: match.confidence,
                alreadyAttachedKeys: thread.attached_item_keys ?? [],
              })
              if (sendResult.sent) {
                recommendationSent = true
                if (sendResult.messageIds.length > 0) {
                  await admin
                    .from('messenger_jobs')
                    .update({ outbound_button_fb_id: sendResult.messageIds.at(-1) ?? null })
                    .eq('id', job.id)
                }
                const persistedBody =
                  `Recommended: ${match.product.title} — ${match.product.price_label}\n` +
                  `View → ${sendResult.deeplinkUrl}`
                const previewText = `Recommended · ${match.product.title}`
                await admin.from('messenger_messages').insert({
                  thread_id: thread.id,
                  user_id: thread.user_id,
                  direction: 'outbound',
                  sender: 'bot',
                  fb_message_id: sendResult.messageIds.at(-1) ?? null,
                  body: persistedBody,
                  attachments: {
                    kind: 'product_recommendation',
                    product_id: match.product.id,
                    action_page_id: catalogPage.id,
                    confidence: match.confidence,
                    image_sent: sendResult.imageSent,
                    deeplink_url: sendResult.deeplinkUrl,
                  },
                })
                await admin
                  .from('messenger_threads')
                  .update({
                    last_message_at: new Date().toISOString(),
                    last_message_preview: previewText.slice(0, 200),
                  })
                  .eq('id', thread.id)
              } else {
                console.warn('[messenger.worker] product recommendation send blocked', {
                  threadId: thread.id,
                  reason: sendResult.reason,
                })
              }
            } else {
              console.log('[messenger.worker] recommendProduct declined', {
                threadId: thread.id,
                reason: match.reason,
                bestConfidence: 'bestConfidence' in match ? match.bestConfidence : undefined,
              })
            }
          } catch (e) {
            console.error('[messenger.worker] product recommendation flow failed', e)
          }
        }
      }

      // Property recommendation — same shape as the product flow but operates
      // on the realestate page's curated list. Skips silently if the product
      // flow already sent.
      if (!recommendationSent && propertyRecommendation && activeRealestatePageId) {
        const realestatePage = sendablePages.find((p) => p.id === activeRealestatePageId)
        if (realestatePage) {
          try {
            const match = await recommendProperty(
              { client: admin },
              {
                userId: thread.user_id,
                actionPageId: realestatePage.id,
                query: propertyRecommendation.query,
                filters: {
                  priceMin: propertyRecommendation.filters.priceMin,
                  priceMax: propertyRecommendation.filters.priceMax,
                  tags: propertyRecommendation.filters.tags,
                },
                confidenceThreshold: propertyRecommendation.confidenceThreshold,
              },
            )
            if (match.ok) {
              const sendResult = await sendPropertyRecommendation({
                admin,
                thread: {
                  id: thread.id,
                  psid: thread.psid,
                  last_inbound_at: thread.last_inbound_at,
                },
                pageToken,
                facebookPageId: thread.page_id,
                page: {
                  id: realestatePage.id,
                  slug: realestatePage.slug,
                  signing_secret: realestatePage.signing_secret,
                },
                property: {
                  id: match.product.id,
                  slug: match.product.slug,
                  title: match.product.title,
                  price_label: match.product.price_label,
                  cover_image_url: match.product.cover_image_url,
                  city: match.product.city,
                  region: match.product.region,
                  description: match.product.description || match.product.summary,
                },
                confidence: match.confidence,
                alreadyAttachedKeys: thread.attached_item_keys ?? [],
              })
              if (sendResult.sent) {
                recommendationSent = true
                if (sendResult.messageIds.length > 0) {
                  await admin
                    .from('messenger_jobs')
                    .update({ outbound_button_fb_id: sendResult.messageIds.at(-1) ?? null })
                    .eq('id', job.id)
                }
                const persistedBody =
                  `Recommended: ${match.product.title} — ${match.product.price_label}\n` +
                  `View → ${sendResult.deeplinkUrl}`
                const previewText = `Recommended · ${match.product.title}`
                await admin.from('messenger_messages').insert({
                  thread_id: thread.id,
                  user_id: thread.user_id,
                  direction: 'outbound',
                  sender: 'bot',
                  fb_message_id: sendResult.messageIds.at(-1) ?? null,
                  body: persistedBody,
                  attachments: {
                    kind: 'property_recommendation',
                    property_id: match.product.id,
                    action_page_id: realestatePage.id,
                    confidence: match.confidence,
                    image_sent: sendResult.imageSent,
                    deeplink_url: sendResult.deeplinkUrl,
                  },
                })
                await admin
                  .from('messenger_threads')
                  .update({
                    last_message_at: new Date().toISOString(),
                    last_message_preview: previewText.slice(0, 200),
                  })
                  .eq('id', thread.id)
              } else {
                console.warn('[messenger.worker] property recommendation send blocked', {
                  threadId: thread.id,
                  reason: sendResult.reason,
                })
              }
            } else {
              console.log('[messenger.worker] recommendProperty declined', {
                threadId: thread.id,
                reason: match.reason,
                bestConfidence: 'bestConfidence' in match ? match.bestConfidence : undefined,
              })
            }
          } catch (e) {
            console.error('[messenger.worker] property recommendation flow failed', e)
          }
        }
      }

      // Send action page as a separate button message after the text reply.
      if (actionPageChoice && !recommendationSent) {
        const chosen = sendablePages.find((p) => p.id === actionPageChoice.action_page_id)
        if (chosen) {
          try {
            // Build a signed deeplink so the submission is attributed to this
            // lead (PSID + page id, HMAC-signed with the action page's secret).
            // 30-day expiry — Messenger may show the button long after send.
            const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
            const targetUrl = deeplinkActionPageUrl(chosen.signing_secret, {
              slug: chosen.slug,
              psid: thread.psid,
              pageId: thread.page_id,
              exp,
            })
            const aiBtnText = (actionPageChoice.button_text ?? '').trim()
            let btnText = (aiBtnText || chosen.title).slice(0, 640)

            // For catalog action pages, send a horizontally-scrollable
            // carousel of products (image + title + price/summary + per-card
            // "View product" / "View all" buttons) instead of a single
            // button. Falls through to the button if no products are found.
            let carouselProducts: PublicProductCard[] = []
            if (chosen.kind === 'catalog') {
              try {
                carouselProducts = await fetchPublicCatalogProducts(
                  admin,
                  chosen.user_id,
                  chosen.config as Parameters<typeof fetchPublicCatalogProducts>[2],
                )
              } catch (e) {
                console.warn('[messenger.worker] catalog product fetch failed', e)
              }
            }

            // For realestate pages, send a carousel of active properties
            // (for_sale / for_rent only; cap 10; config order). Falls through
            // to the single button if there are no active properties.
            let realestateElements: MessengerGenericElement[] = []
            if (chosen.kind === 'realestate') {
              try {
                const reConfig = parseRealestateConfig(chosen.config)
                realestateElements = buildRealestateCarouselElements(
                  reConfig.properties,
                  targetUrl,
                  chosen.cta_label || 'View all listings',
                )
              } catch (e) {
                console.warn('[messenger.worker] realestate config parse failed', e)
              }
            }

            // Idempotent on retry — see text-reply block above for rationale.
            let buttonFbId = job.outbound_button_fb_id
            let carouselSent = false
            if (!buttonFbId && carouselProducts.length > 0) {
              const elements: MessengerGenericElement[] = carouselProducts
                .slice(0, 10)
                .map((p) => {
                  const productUrl = `${targetUrl}${targetUrl.includes('?') ? '&' : '?'}product=${encodeURIComponent(p.slug)}`
                  const subtitleParts = [p.price_label, p.summary || p.description || '']
                    .map((s) => (s ?? '').trim())
                    .filter(Boolean)
                  return {
                    title: p.title,
                    subtitle: subtitleParts.join(' · '),
                    imageUrl: p.cover_image_url ?? undefined,
                    defaultActionUrl: productUrl,
                    buttons: [
                      { title: 'View product', url: productUrl },
                      { title: chosen.cta_label || 'View all', url: targetUrl },
                    ],
                  }
                })
              const carouselResult = await sendOutbound({
                admin,
                thread: { id: thread.id, psid: thread.psid, last_inbound_at: thread.last_inbound_at },
                pageToken,
                payload: { kind: 'generic_template', elements },
                kind: 'bot',
              })
              if (carouselResult.sent) {
                buttonFbId = carouselResult.messageId ?? null
                carouselSent = true
                if (buttonFbId) {
                  await admin
                    .from('messenger_jobs')
                    .update({ outbound_button_fb_id: buttonFbId })
                    .eq('id', job.id)
                }
              } else {
                console.warn('[messenger.worker] catalog carousel policy_blocked', {
                  threadId: thread.id,
                  reason: (carouselResult as { sent: false; reason: string }).reason,
                })
              }
            }
            if (!buttonFbId && realestateElements.length > 0) {
              const carouselResult = await sendOutbound({
                admin,
                thread: { id: thread.id, psid: thread.psid, last_inbound_at: thread.last_inbound_at },
                pageToken,
                payload: { kind: 'generic_template', elements: realestateElements },
                kind: 'bot',
              })
              if (carouselResult.sent) {
                buttonFbId = carouselResult.messageId ?? null
                carouselSent = true
                if (buttonFbId) {
                  await admin
                    .from('messenger_jobs')
                    .update({ outbound_button_fb_id: buttonFbId })
                    .eq('id', job.id)
                }
              } else {
                console.warn('[messenger.worker] realestate carousel policy_blocked', {
                  threadId: thread.id,
                  reason: (carouselResult as { sent: false; reason: string }).reason,
                })
              }
            }
            // For sales pages: send the primary gallery image and include the
            // product description in the button card text.
            if (!buttonFbId && chosen.kind === 'sales') {
              try {
                const { SalesConfigSchema } = await import(
                  '@/app/a/[slug]/_kinds/sales/schema'
                )
                const salesConfig = SalesConfigSchema.parse(chosen.config)
                const primaryImg =
                  salesConfig.gallery.find((g: { primary: boolean }) => g.primary) ??
                  salesConfig.gallery[0]
                if (primaryImg?.url) {
                  await sendOutbound({
                    admin,
                    thread: {
                      id: thread.id,
                      psid: thread.psid,
                      last_inbound_at: thread.last_inbound_at,
                    },
                    pageToken,
                    payload: { kind: 'image', imageUrl: primaryImg.url },
                    kind: 'bot',
                  })
                }
                const desc = (
                  salesConfig.product.tagline ||
                  salesConfig.product.description ||
                  ''
                ).trim()
                if (desc) {
                  btnText = `${btnText}\n\n${desc}`.slice(0, 640)
                }
              } catch (e) {
                console.warn('[messenger.worker] sales page config parse failed', e)
              }
            }

            if (!buttonFbId) {
              const btnResult = await sendOutbound({
                admin,
                thread: { id: thread.id, psid: thread.psid, last_inbound_at: thread.last_inbound_at },
                pageToken,
                payload: { kind: 'button', text: btnText, url: targetUrl, ctaLabel: chosen.cta_label },
                kind: 'bot',
              })
              if (btnResult.sent) {
                buttonFbId = btnResult.messageId ?? null
                if (buttonFbId) {
                  await admin
                    .from('messenger_jobs')
                    .update({ outbound_button_fb_id: buttonFbId })
                    .eq('id', job.id)
                }
              } else {
                console.warn('[messenger.worker] action-page button policy_blocked', {
                  threadId: thread.id,
                  reason: (btnResult as { sent: false; reason: string }).reason,
                })
              }
            }
            const persistedBody = carouselSent
              ? chosen.kind === 'realestate'
                ? `${chosen.title} — ${realestateElements.length} listing${realestateElements.length === 1 ? '' : 's'}\n` +
                  realestateElements
                    .map((e) => `• ${e.title}${e.subtitle ? ` (${e.subtitle})` : ''}`)
                    .join('\n') +
                  `\nView all → ${targetUrl}`
                : `${chosen.title} — ${carouselProducts.length} product${carouselProducts.length === 1 ? '' : 's'}\n` +
                  carouselProducts
                    .slice(0, 10)
                    .map((p) => `• ${p.title} (${p.price_label})`)
                    .join('\n') +
                  `\nView all → ${targetUrl}`
              : `${btnText}\n${chosen.cta_label} → ${targetUrl}`
            const previewText = carouselSent
              ? chosen.kind === 'realestate'
                ? `${chosen.title} · ${realestateElements.length} listings`
                : `${chosen.title} · ${carouselProducts.length} products`
              : `${chosen.cta_label} · ${chosen.title}`
            const { error: btnInsertErr } = await admin
              .from('messenger_messages')
              .insert({
                thread_id: thread.id,
                user_id: thread.user_id,
                direction: 'outbound',
                sender: 'bot',
                fb_message_id: buttonFbId,
                body: persistedBody,
              })
            if (btnInsertErr && (btnInsertErr as { code?: string }).code !== '23505') {
              throw btnInsertErr
            }
            await admin
              .from('messenger_threads')
              .update({
                last_message_at: new Date().toISOString(),
                last_message_preview: previewText.slice(0, 200),
              })
              .eq('id', thread.id)
          } catch (e) {
            console.error('[messenger.worker] action page button send failed', e)
          }
        }
      }

      // Apply stage change after the reply is safely sent. Never throws.
      if (stageChange && thread.lead_id) {
        await applyStageChange(admin, {
          leadId: thread.lead_id,
          userId: thread.user_id,
          threadId: thread.id,
          fromStageId: currentStageId,
          change: stageChange,
          stages,
          idempotencySuffix: job.inbound_msg_id,
        })
      }

      // Layer 2: deep re-evaluation. Fire-and-forget.
      // Cadence: fire at the 3rd inbound, then every 5 inbound thereafter.
      // The previous % 10 schedule was too sparse for Filipino SMB Messenger
      // conversations — many deals close in fewer than 8 messages, so the
      // deep pass never ran on the relevant traffic.
      if (thread.lead_id && stages.length > 0) {
        const leadId = thread.lead_id
        void (async () => {
          try {
            const enabled = await isDeepReclassifyEnabled(admin, thread.user_id)
            if (!enabled) return
            const inboundCount = await countInboundMessages(admin, thread.id)
            const shouldFire = inboundCount === 3 || (inboundCount > 3 && (inboundCount - 3) % 5 === 0)
            if (!shouldFire) return
            const windowIndex = inboundCount
            await runDeepReclassify({
              adminClient: admin,
              leadId,
              threadId: thread.id,
              userId: thread.user_id,
              windowIndex,
            })
          } catch (e) {
            console.error('[messenger.worker] deep-reclassify trigger threw', e)
          }
        })()
      }
    } else if (classifyEnabled && thread.lead_id && stages.length > 0) {
      // Bot is muted on this thread — only classify, every Nth inbound.
      const next = thread.inbound_since_classify + 1
      if (next % CLASSIFY_EVERY === 0) {
        try {
          const change = await classifyOnly(history, message, stages, currentStageId)
          if (change) {
            await applyStageChange(admin, {
              leadId: thread.lead_id,
              userId: thread.user_id,
              threadId: thread.id,
              fromStageId: currentStageId,
              change,
              stages,
              idempotencySuffix: job.inbound_msg_id,
            })
          }
        } catch (e) {
          console.error('[messenger.worker] classifyOnly threw', e)
        }
        await admin
          .from('messenger_threads')
          .update({ inbound_since_classify: 0 })
          .eq('id', thread.id)
      } else {
        await admin
          .from('messenger_threads')
          .update({ inbound_since_classify: next })
          .eq('id', thread.id)
      }
    }

    await markDone(admin, job.id, 'done', null)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const rateLimited = isRateLimitError(msg)
    const attempts = job.attempts + 1
    // Rate-limit errors get a higher cap and longer jittered backoff. Other
    // errors keep the original 3-attempt cap with linear backoff so genuine
    // bugs still surface quickly.
    const cap = rateLimited ? MAX_RATE_LIMIT_ATTEMPTS : MAX_ATTEMPTS
    const failed = attempts >= cap
    const backoffMs = rateLimited
      ? rateLimitBackoffMs(attempts)
      : Math.min(60_000 * attempts, 300_000)
    if (rateLimited) {
      console.warn('[messenger.worker] rate-limited, requeuing', job.id, {
        attempts,
        cap,
        backoffMs,
        msg: msg.slice(0, 200),
      })
    } else {
      console.error('[messenger.worker] job error', job.id, msg)
    }
    if (failed) captureJobFailure(err, job)
    await admin
      .from('messenger_jobs')
      .update({
        status: failed ? 'failed' : 'queued',
        attempts,
        last_error: msg.slice(0, 1000),
        scheduled_at: new Date(Date.now() + backoffMs).toISOString(),
        finished_at: failed ? new Date().toISOString() : null,
        started_at: null,
      })
      .eq('id', job.id)
  } finally {
    stopHeartbeat()
  }
}

/**
 * Start a heartbeat that bumps `messenger_jobs.started_at` while a job is
 * processing. With this in place, the stale-reclaim in `claim_messenger_jobs`
 * only fires when a worker has actually stopped emitting heartbeats — i.e.
 * crashed or hit `maxDuration` — so a healthy slow job (long LLM call,
 * upstream backoff) is never double-claimed.
 *
 * Returns a stop function the caller must invoke in `finally` so a normal
 * completion or thrown error always tears the interval down.
 */
function startHeartbeat(admin: AdminClient, jobId: string): () => void {
  const interval = setInterval(() => {
    void admin
      .from('messenger_jobs')
      .update({ started_at: new Date().toISOString() })
      .eq('id', jobId)
      .then(
        () => {},
        (e) => console.warn('[messenger.worker] heartbeat update failed', jobId, e),
      )
  }, HEARTBEAT_INTERVAL_MS)
  // unref so a stray interval can never block the Node event loop from exiting
  if (typeof interval === 'object' && interval && 'unref' in interval) {
    ;(interval as { unref: () => void }).unref()
  }
  return () => clearInterval(interval)
}

interface ReplyContext {
  config: ChatbotConfig
  history: AnswerHistory
  stages: StageBrief[]
  currentStageId: string | null
  campaign: CampaignBrief | null
  sendablePages: SendableActionPage[]
  leadContextBlock: string
}

/**
 * Parallel preload for everything the reply pipeline needs after the inbound
 * thread + page lookup. Two rounds:
 *   1. config / stages / lead-core / history / lead-context / all sendable
 *      pages — every fetch keyed on the lead or the user, no cross deps.
 *   2. campaign + funnels (only when the lead has a campaign_id).
 * Then filters sendable pages down to the active funnel's / campaign's target
 * page in JS, preserving the previous `loadSendableActionPages(target)` shape
 * without paying for an extra round-trip.
 */
async function loadReplyContext(
  admin: AdminClient,
  args: { thread: ThreadRow; inboundMsgId: string | null },
): Promise<ReplyContext> {
  const { thread, inboundMsgId } = args
  const userId = thread.user_id
  const leadId = thread.lead_id

  const [
    config,
    stages,
    leadRow,
    history,
    leadContextBlock,
    allSendablePages,
  ] = await Promise.all([
    getChatbotConfig(admin, userId),
    fetchPipelineStages(admin, userId),
    leadId ? fetchLeadCore(admin, leadId) : Promise.resolve(null),
    loadHistory(admin, thread.id, inboundMsgId),
    thread.auto_reply_enabled && leadId
      ? loadLeadContext(admin, leadId)
          .then((s) => s.block)
          .catch((e) => {
            console.warn('[messenger.worker] loadLeadContext failed', {
              err: e instanceof Error ? e.message : String(e),
            })
            return ''
          })
      : Promise.resolve(''),
    thread.auto_reply_enabled
      ? loadSendableActionPages(admin, userId, null)
      : Promise.resolve([] as SendableActionPage[]),
  ])

  const currentStageId = leadRow?.stage_id ?? null
  const campaignId = leadRow?.campaign_id ?? null
  const currentFunnelId = leadRow?.current_funnel_id ?? null

  let campaign: CampaignBrief | null = null
  if (campaignId) {
    const [campaignRes, funnelRes] = await Promise.all([
      admin
        .from('campaigns')
        .select('id, personality_mode, persona, do_rules, dont_rules, goal_action_page_id')
        .eq('id', campaignId)
        .maybeSingle<Omit<CampaignBrief, 'activeFunnel'>>(),
      admin
        .from('funnels')
        .select('id, position, instruction, rules, action_page_id, next_funnel_id')
        .eq('campaign_id', campaignId)
        .order('position', { ascending: true }),
    ])
    if (campaignRes.data) {
      const funnels = (funnelRes.data ?? []) as FunnelBrief[]
      const activeFunnel =
        funnels.find((f) => f.id === currentFunnelId) ?? funnels[0] ?? null
      // Heal stale lead.current_funnel_id without blocking the reply.
      if (leadId && activeFunnel && activeFunnel.id !== currentFunnelId) {
        const leadIdForHeal = leadId
        void admin
          .from('leads')
          .update({ current_funnel_id: activeFunnel.id })
          .eq('id', leadIdForHeal)
          .then(
            () => {},
            (e) => console.warn('[messenger.worker] current_funnel_id heal failed', e),
          )
      }
      campaign = { ...campaignRes.data, activeFunnel }
    }
  }

  const targetActionPageId =
    campaign?.activeFunnel?.action_page_id ?? campaign?.goal_action_page_id ?? null
  const sendablePages = targetActionPageId
    ? allSendablePages.filter((p) => p.id === targetActionPageId)
    : allSendablePages

  return { config, history, stages, currentStageId, campaign, sendablePages, leadContextBlock }
}

async function fetchPipelineStages(
  admin: AdminClient,
  userId: string,
): Promise<StageBrief[]> {
  const { data } = await admin
    .from('pipeline_stages')
    .select('id, name, description, position, kind, entry_signals, exit_signals')
    .eq('user_id', userId)
    .order('position', { ascending: true })
  return (data ?? []) as StageBrief[]
}

async function fetchLeadCore(
  admin: AdminClient,
  leadId: string,
): Promise<{
  stage_id: string | null
  campaign_id: string | null
  current_funnel_id: string | null
} | null> {
  const { data } = await admin
    .from('leads')
    .select('stage_id, campaign_id, current_funnel_id')
    .eq('id', leadId)
    .maybeSingle<{
      stage_id: string | null
      campaign_id: string | null
      current_funnel_id: string | null
    }>()
  return data ?? null
}

/**
 * Resolve job → inbound message → thread in one FK-joined read. Postgres
 * snapshot consistency means if the message row is visible, the thread row
 * it FKs to is too — so we never see the "thread missing" race that one-shot
 * lookups by job.thread_id can hit on first-touch.
 *
 * Returns null when the inbound message itself is gone (orphan job — caller
 * should mark skipped rather than retry).
 */
async function loadJobContext(
  admin: AdminClient,
  job: JobRow,
): Promise<{ thread: ThreadRow; message: string; inboundFbId: string | null } | null> {
  const { data, error } = await admin
    .from('messenger_messages')
    .select(
      'body, fb_message_id, messenger_threads!inner(id, user_id, page_id, psid, lead_id, full_name, auto_reply_enabled, bot_paused_until, inbound_since_classify, conversation_summary, last_inbound_at, controlled_by_run_id, attached_item_keys)',
    )
    .eq('id', job.inbound_msg_id)
    .maybeSingle<{
      body: string
      fb_message_id: string | null
      messenger_threads: ThreadRow | ThreadRow[]
    }>()
  // Distinguish "row genuinely gone" (orphan job — caller marks skipped) from
  // "query itself errored" (schema drift, RLS, transient DB). Silently skipping
  // the latter black-holes every inbound message; throw so the job retries and
  // the failure surfaces in last_error.
  if (error) throw new Error(`loadJobContext query failed: ${error.message}`)
  if (!data) return null
  const thread = Array.isArray(data.messenger_threads)
    ? data.messenger_threads[0]
    : data.messenger_threads
  if (!thread) return null
  return { thread, message: data.body ?? '', inboundFbId: data.fb_message_id ?? null }
}

function isGenericName(name: string | null): boolean {
  if (!name) return true
  const trimmed = name.trim()
  if (!trimmed) return true
  // Catches the old fallback ("Messenger user") and the new one
  // ("Messenger user XXXX") so threads stuck on either get re-fetched.
  return /^messenger user(\s|$)/i.test(trimmed)
}

async function refreshNames(
  admin: AdminClient,
  thread: ThreadRow,
  pageToken: string,
): Promise<void> {
  const profile = await fetchMessengerProfile({
    pageAccessToken: pageToken,
    psid: thread.psid,
  })
  if (isGenericName(profile.fullName)) {
    return // FB still won't give us a real name; nothing to do
  }
  await admin
    .from('messenger_threads')
    .update({ full_name: profile.fullName, picture_url: profile.pictureUrl })
    .eq('id', thread.id)
  if (thread.lead_id) {
    await admin
      .from('leads')
      .update({ name: profile.fullName })
      .eq('id', thread.lead_id)
  }
  console.log('[messenger.worker] refreshed name', {
    threadId: thread.id,
    name: profile.fullName,
  })
}

async function ensureLead(
  admin: AdminClient,
  thread: ThreadRow,
  pageToken: string,
): Promise<void> {
  const profile = await fetchMessengerProfile({
    pageAccessToken: pageToken,
    psid: thread.psid,
  })

  // Find the user's default pipeline stage. Fall back to the lowest-position
  // stage if none is flagged default. If the user has no stages at all
  // (connected FB but never opened /dashboard/leads), seed defaults inline so
  // a customer's first message doesn't dead-letter the job.
  let defaultStage = await pickDefaultStage(admin, thread.user_id)
  if (!defaultStage) {
    await seedDefaultStages(admin, thread.user_id)
    defaultStage = await pickDefaultStage(admin, thread.user_id)
  }
  if (!defaultStage) {
    throw new Error(`no pipeline_stages for user ${thread.user_id}`)
  }

  const campaign_id = await pickCampaignForUser(admin, thread.user_id)
  const current_funnel_id = campaign_id
    ? await pickFirstFunnelForCampaign(admin, campaign_id)
    : null

  const { data: lead, error: leadErr } = await admin
    .from('leads')
    .insert({
      user_id: thread.user_id,
      stage_id: defaultStage.id,
      name: profile.fullName,
      source: 'messenger',
      campaign_id,
      current_funnel_id,
    })
    .select('id')
    .single()
  if (leadErr || !lead) throw new Error(`lead create failed: ${leadErr?.message}`)

  await admin
    .from('messenger_threads')
    .update({
      lead_id: lead.id,
      full_name: profile.fullName,
      picture_url: profile.pictureUrl,
    })
    .eq('id', thread.id)
}

async function loadHistory(
  admin: AdminClient,
  threadId: string,
  excludeMessageId: string | null,
): Promise<AnswerHistory> {
  let query = admin
    .from('messenger_messages')
    .select('id, direction, sender, body, created_at')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)
  if (excludeMessageId) query = query.neq('id', excludeMessageId)
  const { data } = await query
  if (!data) return []
  return data
    .reverse()
    .filter((m) => (m.body as string)?.trim())
    .filter((m) => {
      if (m.direction === 'inbound') return true
      // outbound: keep only bot-sent rows that aren't image placeholders
      return m.sender === 'bot' && !(m.body as string).startsWith('[image]')
    })
    .map((m) => ({
      role: m.direction === 'outbound' ? ('assistant' as const) : ('user' as const),
      content: m.body as string,
    }))
}

async function countInboundMessages(
  admin: AdminClient,
  threadId: string,
): Promise<number> {
  const { count, error } = await admin
    .from('messenger_messages')
    .select('id', { head: true, count: 'exact' })
    .eq('thread_id', threadId)
    .eq('direction', 'inbound')
  if (error) {
    console.warn('[messenger.worker] countInboundMessages failed', error.message)
    return 0
  }
  return count ?? 0
}

async function countThreadMessages(
  admin: AdminClient,
  threadId: string,
): Promise<number> {
  const { count, error } = await admin
    .from('messenger_messages')
    .select('id', { head: true, count: 'exact' })
    .eq('thread_id', threadId)
  if (error) {
    console.warn('[messenger.worker] countThreadMessages failed', error.message)
    return 0
  }
  return count ?? 0
}

async function isDeepReclassifyEnabled(
  admin: AdminClient,
  userId: string,
): Promise<boolean> {
  try {
    const { data } = await admin
      .from('chatbot_configs')
      .select('deep_reclassify_enabled')
      .eq('user_id', userId)
      .maybeSingle<{ deep_reclassify_enabled: boolean }>()
    return !!data?.deep_reclassify_enabled
  } catch {
    return false
  }
}

async function pickDefaultStage(
  admin: AdminClient,
  userId: string,
): Promise<{ id: string } | null> {
  const { data: stages } = await admin
    .from('pipeline_stages')
    .select('id, position, is_default')
    .eq('user_id', userId)
    .order('position', { ascending: true })
  const row = stages?.find((s) => s.is_default) ?? stages?.[0]
  return row ? { id: row.id } : null
}

const WORKER_DEFAULT_STAGES = [
  { name: 'New Lead',    description: 'Freshly captured leads.',     is_default: true  },
  { name: 'Contacted',   description: 'Initial outreach sent.',      is_default: false },
  { name: 'Qualified',   description: 'Confirmed fit and interest.', is_default: false },
  { name: 'Unqualified', description: 'Not a fit right now.',        is_default: false },
  { name: 'Proposal',    description: 'Proposal or quote sent.',     is_default: false },
  { name: 'Won',         description: 'Closed-won deals.',           is_default: false },
  { name: 'Lost',        description: 'Closed-lost deals.',          is_default: false },
]

async function seedDefaultStages(
  admin: AdminClient,
  userId: string,
): Promise<void> {
  const rows = WORKER_DEFAULT_STAGES.map((s, i) => ({
    user_id: userId,
    name: s.name,
    description: s.description,
    position: i,
    is_default: s.is_default,
  }))
  const { error } = await admin.from('pipeline_stages').insert(rows)
  // Ignore unique-violation: another concurrent worker / page load won the race
  // and already seeded. Real errors (RLS misconfig, etc.) should bubble.
  if (error && (error as { code?: string }).code !== '23505') {
    throw new Error(`seedDefaultStages: ${error.message}`)
  }
}

interface SendableActionPage {
  id: string
  slug: string
  title: string
  cta_label: string
  bot_send_instructions: string
  signing_secret: string
  kind: string
  config: Record<string, unknown> | null
  user_id: string
}

interface FunnelBrief {
  id: string
  position: number
  instruction: string
  action_page_id: string | null
  next_funnel_id: string | null
  rules: { kind: 'do' | 'dont'; text: string }[]
}

interface CampaignBrief {
  id: string
  personality_mode: 'chatbot' | 'custom'
  persona: string | null
  do_rules: string[] | null
  dont_rules: string[] | null
  goal_action_page_id: string | null
  activeFunnel: FunnelBrief | null
}

async function pickCampaignForUser(
  admin: AdminClient,
  userId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('campaigns')
    .select('id, weight')
    .eq('user_id', userId)
    .eq('enabled', true)
    .eq('status', 'active')
  const rows = (data ?? []) as { id: string; weight: number }[]
  if (rows.length === 0) return null
  const weights = rows.map((r) => Math.max(1, r.weight ?? 1))
  const total = weights.reduce((a, b) => a + b, 0)
  let roll = Math.random() * total
  for (let i = 0; i < rows.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return rows[i].id
  }
  return rows[rows.length - 1].id
}

async function pickFirstFunnelForCampaign(
  admin: AdminClient,
  campaignId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('funnels')
    .select('id')
    .eq('campaign_id', campaignId)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>()
  return data?.id ?? null
}

/**
 * Load published action pages eligible for the bot to send autonomously.
 * When a funnel or campaign target page is provided, only that page is returned
 * so the bot prioritizes the lead's active funnel before the broader campaign.
 */
async function loadSendableActionPages(
  admin: AdminClient,
  userId: string,
  targetActionPageId: string | null = null,
): Promise<SendableActionPage[]> {
  let query = admin
    .from('action_pages')
    .select('id, slug, title, cta_label, bot_send_instructions, signing_secret, kind, config, user_id')
    .eq('user_id', userId)
    .eq('status', 'published')
    .not('cta_label', 'is', null)
    .not('bot_send_instructions', 'is', null)
  if (targetActionPageId) {
    query = query.eq('id', targetActionPageId)
  }
  const { data, error } = await query.limit(20)
  if (error) {
    console.error('[messenger.worker] loadSendableActionPages failed', error.message)
    return []
  }
  return (data ?? [])
    .filter(
      (r) =>
        typeof r.cta_label === 'string' &&
        r.cta_label.trim() &&
        typeof r.bot_send_instructions === 'string' &&
        r.bot_send_instructions.trim(),
    )
    .map((r) => ({
      id: r.id as string,
      slug: r.slug as string,
      title: r.title as string,
      cta_label: (r.cta_label as string).trim(),
      bot_send_instructions: (r.bot_send_instructions as string).trim(),
      signing_secret: r.signing_secret as string,
      kind: r.kind as string,
      config: (r.config as Record<string, unknown> | null) ?? null,
      user_id: r.user_id as string,
    }))
}

function parseActionPageMentions(text: string): string[] {
  const re = /!actionpage:([a-z0-9][a-z0-9_-]*)/gi
  const slugs: string[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const slug = m[1].toLowerCase()
    if (!seen.has(slug)) {
      slugs.push(slug)
      seen.add(slug)
    }
  }
  return slugs
}

async function loadThreadLeadId(
  admin: AdminClient,
  threadId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('messenger_threads')
    .select('lead_id')
    .eq('id', threadId)
    .maybeSingle<{ lead_id: string | null }>()
  return data?.lead_id ?? null
}

export async function resolveCommentBridgesForThread(
  admin: Pick<AdminClient, 'from'>,
  args: { pageId: string; psid: string; leadId: string | null },
): Promise<void> {
  if (!args.leadId) return
  const resolvedAt = new Date().toISOString()
  await admin
    .from('facebook_comment_bridges')
    .update({ lead_id: args.leadId, resolved_at: resolvedAt })
    .eq('page_id', args.pageId)
    .eq('commenter_id', args.psid)
    .is('resolved_at', null)
    .gt('expires_at', resolvedAt)
  // Back-fill the canonical comment rows that were stored before this
  // commenter had a lead. The drawer queries facebook_lead_comments by
  // lead_id, so without this stamp those comments stay invisible.
  await admin
    .from('facebook_lead_comments')
    .update({ lead_id: args.leadId })
    .eq('page_id', args.pageId)
    .eq('commenter_id', args.psid)
    .is('lead_id', null)
}

async function markDone(
  admin: AdminClient,
  jobId: string,
  status: 'done' | 'skipped',
  note: string | null,
): Promise<void> {
  await admin
    .from('messenger_jobs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      last_error: note,
    })
    .eq('id', jobId)
}

async function sendSelectedMedia(
  admin: AdminClient,
  args: {
    job: JobRow
    thread: ThreadRow
    pageToken: string
    selectedMedia: SelectedMediaAsset[]
  },
): Promise<void> {
  const sent = [...args.job.outbound_media]
  const sentIds = new Set(sent.map((m) => m.media_asset_id))
  let sentThisCall = 0

  for (const asset of args.selectedMedia.slice(0, 4)) {
    if (sentIds.has(asset.id)) {
      console.log('[messenger.worker] media skip dedup', {
        jobId: args.job.id,
        assetId: asset.id,
        slug: asset.slug,
      })
      continue
    }
    try {
      const { data: signed, error: signErr } = await admin.storage
        .from('media-assets')
        .createSignedUrl(asset.storagePath, 60 * 60)
      if (signErr || !signed?.signedUrl) throw signErr ?? new Error('signed URL missing')

      const fb = await sendMessengerImage({
        pageAccessToken: args.pageToken,
        recipientPsid: args.thread.psid,
        imageUrl: signed.signedUrl,
      })
      sent.push({ media_asset_id: asset.id, fb_message_id: fb.message_id })
      sentIds.add(asset.id)
      sentThisCall++
      await admin.from('messenger_jobs').update({ outbound_media: sent }).eq('id', args.job.id)
      console.log('[messenger.worker] media sent', {
        jobId: args.job.id,
        assetId: asset.id,
        slug: asset.slug,
        fbMessageId: fb.message_id,
      })

      const { error: insertErr } = await admin.from('messenger_messages').insert({
        thread_id: args.thread.id,
        user_id: args.thread.user_id,
        direction: 'outbound',
        sender: 'bot',
        fb_message_id: fb.message_id,
        media_asset_id: asset.id,
        body: `[image] ${asset.name}`,
        attachments: [{ type: 'image', media_asset_id: asset.id, storage_path: asset.storagePath }],
      })
      if (insertErr && (insertErr as { code?: string }).code !== '23505') throw insertErr
    } catch (e) {
      console.error('[messenger.worker] media send failed', {
        assetId: asset.id,
        slug: asset.slug,
        storagePath: asset.storagePath,
        err: e instanceof Error ? e.message : String(e),
      })
    }
  }
  console.log('[messenger.worker] media done', {
    jobId: args.job.id,
    requested: args.selectedMedia.length,
    sentThisCall,
    totalSent: sent.length,
  })
}

async function processReminderHooks(
  admin: AdminClient,
  args: {
    userId: string
    leadId: string
    threadId: string
    inboundText: string
    inboundMsgId: string | null
    extracted: ExtractedReminder | null
    leadName: string | null
    personalityBlock: string
  },
): Promise<void> {
  const {
    userId,
    leadId,
    threadId,
    inboundText,
    inboundMsgId,
    extracted,
    leadName,
    personalityBlock,
  } = args

  // 1. Resolve any one-off pending reminders the customer's new message addresses.
  const { data: pending } = await admin
    .from('lead_reminders')
    .select('id, topic')
    .eq('lead_id', leadId)
    .eq('status', 'pending')
    .is('sequence_id', null)
    .limit(20)

  const pendingList = (pending ?? []) as PendingReminder[]
  if (pendingList.length > 0) {
    const resolvedIds = await resolveTopics(inboundText, pendingList)
    if (resolvedIds.length > 0) {
      await admin
        .from('lead_reminders')
        .update({
          status: 'resolved',
          resolved_at: new Date().toISOString(),
          resolved_reason: 'topic_addressed',
        })
        .in('id', resolvedIds)
    }
  }

  // 2. If there is an active sequence, see whether this message resolves it.
  await resolveActiveSequence(admin, { leadId, inboundText })

  // 3. If a fresh reminder was extracted (in the pre-reply step), seed a new
  //    sequence (cancels prior active automatically).
  if (extracted) {
    const seedResult = await seedReminderSequence(admin, {
      userId,
      leadId,
      threadId,
      anchor: new Date(extracted.scheduled_at),
      topic: extracted.topic,
      leadName,
      personalityBlock,
      sourceMessageId: inboundMsgId,
    })
    if (!seedResult.ok) {
      console.warn('[messenger.worker] sequence seed failed', seedResult.reason)
    }
  }
}
