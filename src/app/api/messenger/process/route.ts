import { timingSafeEqual } from 'node:crypto'
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
import { extractReminder } from '@/lib/reminders/extract'
import { resolveTopics, type PendingReminder } from '@/lib/reminders/resolve'
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
import { loadLeadContext } from '@/lib/chatbot/leadContext'
import { interruptWorkflowRun } from '@/lib/workflow/trigger'
import { runDeepReclassify } from '@/lib/chatbot/deep-reclassify'

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
const BATCH_SIZE = 3

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
    m.includes('overloaded')
  )
}

// Backoff for rate-limited retries: 30s, 45s, 67s, 100s, ... capped at 5 min,
// with ±25% jitter so concurrent workers don't synchronize their retries.
function rateLimitBackoffMs(attempt: number): number {
  const base = Math.min(30_000 * Math.pow(1.5, Math.max(0, attempt - 1)), 300_000)
  const jitter = base * (Math.random() * 0.5 - 0.25)
  return Math.floor(base + jitter)
}
const RUNNING_STALE_MS = 5 * 60 * 1000
const CLASSIFY_EVERY = 4
// Stop claiming new batches once this much wall-clock has elapsed in the
// invocation. Leaves headroom under maxDuration=300 for the longest
// in-flight batch (LLM + FB calls can run ~30s, occasionally longer under
// provider degradation).
const DRAIN_DEADLINE_MS = 200_000

type AdminClient = ReturnType<typeof createAdminClient>

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
  inbound_since_classify: number
  conversation_summary: string | null
  last_inbound_at: string | null
  controlled_by_run_id: string | null
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

  const admin = createAdminClient()
  const result = await drainMessengerJobs(admin)
  return NextResponse.json(result)
}

/**
 * Drain loop. Repeatedly claim batches and process them in parallel until
 * either the queue is empty or the wall-clock deadline is reached.
 *
 * Per-thread serialization is enforced by the SQL claim function (Phase 1):
 * no two rows in a single batch share a thread_id, and no thread with a
 * `running` job is reclaimable. That makes `Promise.allSettled` over the
 * batch safe — parallel jobs touch disjoint conversations.
 *
 * The per-job try/catch is kept (via allSettled + individual catch) so one
 * failed job never poisons the batch.
 */
async function drainMessengerJobs(
  admin: AdminClient,
): Promise<{ processed: number; batches: number }> {
  const startedAt = Date.now()
  const claimDeadline = startedAt + DRAIN_DEADLINE_MS
  let processed = 0
  let batches = 0
  while (Date.now() < claimDeadline) {
    const jobs = await claimJobs(admin, BATCH_SIZE)
    if (jobs.length === 0) break
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

    // Link any pending Facebook comment private-reply bridges (same page +
    // commenter PSID) to this lead now that we know the lead id.
    await resolveCommentBridgesForThread(admin, {
      pageId: thread.page_id,
      psid: thread.psid,
      leadId: thread.lead_id,
    })

    const message = inboundBody.trim()
    if (!message) {
      await markDone(admin, job.id, 'skipped', 'empty inbound body')
      return
    }

    const inboundAt = new Date().toISOString()
    await admin
      .from('messenger_threads')
      .update({ last_inbound_at: inboundAt })
      .eq('id', thread.id)
    thread.last_inbound_at = inboundAt

    // Auto follow-up: cancel any pending schedule and (if gates pass) seed a
    // fresh one. Lead inbound is the cancel trigger; the seed re-checks both
    // gates inline. Fire-and-forget — must never break the inbound reply.
    if (thread.lead_id) {
      const leadIdForFu = thread.lead_id
      void maybeScheduleFollowup(admin, {
        threadId: thread.id,
        leadId: leadIdForFu,
        userId: thread.user_id,
        pageId: thread.page_id,
        lastInboundAt: inboundAt,
      }).catch((e) => console.warn('[messenger.worker] followup seed failed', e))
    }

    // Auto-detect phone numbers and emails shared by the lead in their message.
    if (thread.lead_id) {
      const detectedPhones = extractPhones(message)
      const detectedEmails = extractEmails(message)
      if (detectedPhones.length || detectedEmails.length) {
        await appendLeadContacts(admin, thread.lead_id, {
          phones: detectedPhones,
          emails: detectedEmails,
        })
      }
    }

    const history = await loadHistory(admin, job.thread_id, job.inbound_msg_id)
    const classifyEnabled = await isAutoClassifyEnabled(admin, thread.user_id)
    const { stages, currentStageId } = classifyEnabled
      ? await loadStageContext(admin, thread.user_id, thread.lead_id)
      : { stages: [] as StageBrief[], currentStageId: null as string | null }
    const campaign = thread.lead_id ? await loadLeadCampaign(admin, thread.lead_id) : null
    const activeFunnel = campaign?.activeFunnel ?? null
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
    const sendablePages = thread.auto_reply_enabled
      ? await loadSendableActionPages(
          admin,
          thread.user_id,
          activeFunnel?.action_page_id ?? campaign?.goal_action_page_id ?? null,
        )
      : []

    // Pre-rendered closed-world snapshot of the lead's bookings, orders,
    // qualification, and form submissions. Empty string when nothing on file
    // (or no lead yet) — appended to the LLM system prompt so the bot can
    // answer "when is my booking?" without inventing details.
    const leadContextBlock =
      thread.auto_reply_enabled && thread.lead_id
        ? await loadLeadContext(admin, thread.lead_id)
            .then((s) => s.block)
            .catch((e) => {
              console.warn('[messenger.worker] loadLeadContext failed', {
                err: e instanceof Error ? e.message : String(e),
              })
              return ''
            })
        : ''

    // Resolve !actionpage:slug mentions embedded in the chatbot instructions.
    // Referenced pages are added to sendablePages so the bot can send them,
    // and !actionpage:slug tokens are replaced with [Action Page: "Title"] in
    // the resolved instructions string passed to the LLM.
    let resolvedInstructions: string | undefined
    if (thread.auto_reply_enabled) {
      const { data: cbRow } = await admin
        .from('chatbot_configs')
        .select('instructions')
        .eq('user_id', thread.user_id)
        .maybeSingle()
      const rawInstr = (cbRow?.instructions as string | null) ?? ''
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

    if (thread.auto_reply_enabled && !thread.controlled_by_run_id) {
      // Best-effort presence signal: typing_on shows the typing bubble while
      // the LLM runs, auto-clearing after ~20s or on the next outbound, so no
      // explicit typing_off is needed. Page Reactions used to live here but
      // Meta has effectively gated the API (#100 "invalid or not present" on
      // every call) and each failed attempt burns against the page rate limit.
      try {
        await sendMessengerSenderAction({
          pageAccessToken: pageToken,
          recipientPsid: thread.psid,
          action: 'typing_on',
        })
      } catch (e) {
        console.warn('[messenger.worker] typing_on send failed', {
          err: e instanceof Error ? e.message : String(e),
        })
      }

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
            },
          )
          reply = r.text.trim()
          stageChange = r.stageChange
          actionPageChoice = r.actionPage
          productRecommendation = r.productRecommendation
          propertyRecommendation = r.propertyRecommendation
          selectedMedia = r.media
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
        textFbId = result.messageId ?? null
        if (textFbId) {
          await admin
            .from('messenger_jobs')
            .update({ outbound_text_fb_id: textFbId })
            .eq('id', job.id)
        }
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
        void processReminderHooks(admin, {
          userId,
          leadId,
          threadId,
          inboundText: message,
          inboundMsgId,
        }).catch((e) => console.warn('[messenger.worker] reminder hooks failed', e))
      }

      // Rolling summary: refresh `conversation_summary` every
      // SUMMARY_INTERVAL_TURNS turns once history exceeds the LLM window.
      // This keeps long threads coherent without paying for a 40-turn prompt
      // every reply. Fire-and-forget — never blocks the bot response.
      if (shouldRollSummary(history.length, LLM_HISTORY_TURNS, SUMMARY_INTERVAL_TURNS)) {
        summarizeConversation(history, message, reply, conversationSummary)
          .then((summary) => {
            if (summary) {
              return admin
                .from('messenger_threads')
                .update({ conversation_summary: summary })
                .eq('id', thread.id)
            }
          })
          .catch((e) => console.warn('[messenger.worker] summary update failed', e))
      }

      await sendSelectedMedia(admin, { job, thread, pageToken, selectedMedia })

      // Product recommendation — fired when the LLM picked recommend_product
      // (customer explicitly asked OR operator rules triggered). Sends the
      // matched product's image + a single-product button card. When it
      // succeeds we skip the catalog carousel below to avoid double-sending.
      let recommendationSent = false
      if (productRecommendation && activeCatalogPageId) {
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
                },
                confidence: match.confidence,
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
                },
                confidence: match.confidence,
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
            const btnText = (aiBtnText || chosen.title).slice(0, 640)

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
  }
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
      'body, fb_message_id, messenger_threads!inner(id, user_id, page_id, psid, lead_id, full_name, auto_reply_enabled, inbound_since_classify, conversation_summary, last_inbound_at, controlled_by_run_id)',
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
    .map((m) => ({
      role: m.direction === 'outbound' ? ('assistant' as const) : ('user' as const),
      content: m.body as string,
    }))
}

async function isAutoClassifyEnabled(
  admin: AdminClient,
  userId: string,
): Promise<boolean> {
  try {
    const { data } = await admin
      .from('chatbot_configs')
      .select('auto_classify_enabled')
      .eq('user_id', userId)
      .maybeSingle<{ auto_classify_enabled: boolean }>()
    return !!data?.auto_classify_enabled
  } catch {
    return false
  }
}

async function loadStageContext(
  admin: AdminClient,
  userId: string,
  leadId: string | null,
): Promise<{ stages: StageBrief[]; currentStageId: string | null }> {
  const { data: stagesData } = await admin
    .from('pipeline_stages')
    .select('id, name, description, position, kind, entry_signals, exit_signals')
    .eq('user_id', userId)
    .order('position', { ascending: true })
  const stages = (stagesData ?? []) as StageBrief[]
  let currentStageId: string | null = null
  if (leadId) {
    const { data: lead } = await admin
      .from('leads')
      .select('stage_id')
      .eq('id', leadId)
      .maybeSingle<{ stage_id: string | null }>()
    currentStageId = lead?.stage_id ?? null
  }
  return { stages, currentStageId }
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

async function loadLeadCampaign(
  admin: AdminClient,
  leadId: string,
): Promise<CampaignBrief | null> {
  const { data: lead } = await admin
    .from('leads')
    .select('campaign_id, current_funnel_id')
    .eq('id', leadId)
    .maybeSingle<{ campaign_id: string | null; current_funnel_id: string | null }>()
  if (!lead?.campaign_id) return null
  const { data: campaign } = await admin
    .from('campaigns')
    .select('id, personality_mode, persona, do_rules, dont_rules, goal_action_page_id')
    .eq('id', lead.campaign_id)
    .maybeSingle<Omit<CampaignBrief, 'activeFunnel'>>()
  if (!campaign) return null
  const { data: funnelRows } = await admin
    .from('funnels')
    .select('id, position, instruction, rules, action_page_id, next_funnel_id')
    .eq('campaign_id', campaign.id)
    .order('position', { ascending: true })
  const funnels = (funnelRows ?? []) as FunnelBrief[]
  const activeFunnel =
    funnels.find((f) => f.id === lead.current_funnel_id) ?? funnels[0] ?? null
  if (activeFunnel && activeFunnel.id !== lead.current_funnel_id) {
    await admin
      .from('leads')
      .update({ current_funnel_id: activeFunnel.id })
      .eq('id', leadId)
  }
  return {
    ...campaign,
    activeFunnel,
  }
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
  await admin
    .from('facebook_comment_bridges')
    .update({ lead_id: args.leadId, resolved_at: new Date().toISOString() })
    .eq('page_id', args.pageId)
    .eq('commenter_id', args.psid)
    .is('resolved_at', null)
    .gt('expires_at', new Date().toISOString())
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

  for (const asset of args.selectedMedia.slice(0, 4)) {
    if (sentIds.has(asset.id)) continue
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
      await admin.from('messenger_jobs').update({ outbound_media: sent }).eq('id', args.job.id)

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
        err: e instanceof Error ? e.message : String(e),
      })
    }
  }
}

async function processReminderHooks(
  admin: AdminClient,
  args: {
    userId: string
    leadId: string
    threadId: string
    inboundText: string
    inboundMsgId: string | null
  },
): Promise<void> {
  const { userId, leadId, threadId, inboundText, inboundMsgId } = args

  // 1. Resolve any pending reminders this message addresses.
  const { data: pending } = await admin
    .from('lead_reminders')
    .select('id, topic')
    .eq('lead_id', leadId)
    .eq('status', 'pending')
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

  // 2. Detect a new follow-up request in this inbound message.
  const extracted = await extractReminder(inboundText)
  if (!extracted) return

  await admin.from('lead_reminders').insert({
    user_id: userId,
    lead_id: leadId,
    thread_id: threadId,
    scheduled_at: extracted.scheduled_at,
    topic: extracted.topic,
    source_message_id: inboundMsgId,
    auto_send: false,
    status: 'pending',
  })
}
