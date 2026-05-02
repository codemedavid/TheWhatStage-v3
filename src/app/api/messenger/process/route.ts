import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptToken } from '@/lib/facebook/crypto'
import {
  fetchMessengerProfile,
  sendMessengerButton,
  sendMessengerReaction,
  sendMessengerSenderAction,
  sendMessengerText,
} from '@/lib/facebook/messenger'
import { deeplinkActionPageUrl } from '@/lib/action-pages/urls'
import { answer, type AnswerHistory } from '@/lib/chatbot/answer'
import {
  answerWithClassification,
  applyStageChange,
  classifyOnly,
  type ActionPageBrief,
  type StageBrief,
} from '@/lib/chatbot/classify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_ATTEMPTS = 3
const HISTORY_LIMIT = 10
const BATCH_SIZE = 5
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
  inbound_msg_id: string
  user_id: string
  attempts: number
  outbound_text_fb_id: string | null
  outbound_button_fb_id: string | null
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
  return (data ?? []) as JobRow[]
}

async function runJob(admin: AdminClient, job: JobRow): Promise<void> {
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
    const actionPages: ActionPageBrief[] = sendablePages.map((p) => ({
      id: p.id,
      title: p.title,
      cta_label: p.cta_label,
      bot_send_instructions: p.bot_send_instructions,
    }))

    if (thread.auto_reply_enabled) {
      // Best-effort presence signals before we spend time generating a reply:
      //   1. React to the inbound message (Page Reactions) so the user sees
      //      a visible "got it" acknowledgment even if generation is slow.
      //   2. Send typing_on so the typing bubble is visible while the LLM
      //      runs. typing_on auto-clears after ~20s or when the next message
      //      is sent, so no explicit typing_off is needed after the reply.
      // Both are wrapped in try/catch — a failed presence signal must never
      // block the actual reply (Page Reactions in particular can be gated).
      if (inboundFbId) {
        try {
          await sendMessengerReaction({
            pageAccessToken: pageToken,
            recipientPsid: thread.psid,
            messageId: inboundFbId,
            reaction: 'like',
          })
        } catch (e) {
          console.warn('[messenger.worker] reaction send failed', {
            err: e instanceof Error ? e.message : String(e),
          })
        }
      }
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
      if ((classifyEnabled && stages.length > 0) || actionPages.length > 0) {
        try {
          const r = await answerWithClassification(
            admin,
            thread.user_id,
            message,
            history,
            stages,
            currentStageId,
            { rpcName: 'match_knowledge_hybrid_service', actionPages, campaignPersona },
          )
          reply = r.text.trim()
          stageChange = r.stageChange
          actionPageChoice = r.actionPage
        } catch (e) {
          console.error('[messenger.worker] combined call failed, falling back', e)
        }
      }
      if (!reply) {
        const r = await answer(admin, thread.user_id, message, history, {
          rpcName: 'match_knowledge_hybrid_service',
          campaignPersona,
        })
        reply = r.text.trim()
      }
      if (!reply) {
        await markDone(admin, job.id, 'skipped', 'empty reply')
        return
      }

      // Send via FB. Idempotent on retry: if a previous attempt already got
      // a message_id back from FB, skip the call (re-sending would surface
      // as a duplicate to the user). Persist the id BEFORE the messenger_
      // messages insert so a DB failure between FB ack and row write is
      // recoverable on retry.
      let textFbId = job.outbound_text_fb_id
      if (!textFbId) {
        const sent = await sendMessengerText({
          pageAccessToken: pageToken,
          recipientPsid: thread.psid,
          text: reply,
        })
        textFbId = sent.message_id
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
          inbound_since_classify: 0,
        })
        .eq('id', thread.id)

      // Send action page as a separate button message after the text reply.
      if (actionPageChoice) {
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
            // Idempotent on retry — see text-reply block above for rationale.
            let buttonFbId = job.outbound_button_fb_id
            if (!buttonFbId) {
              const sentBtn = await sendMessengerButton({
                pageAccessToken: pageToken,
                recipientPsid: thread.psid,
                text: btnText,
                url: targetUrl,
                ctaLabel: chosen.cta_label,
              })
              buttonFbId = sentBtn.message_id
              await admin
                .from('messenger_jobs')
                .update({ outbound_button_fb_id: buttonFbId })
                .eq('id', job.id)
            }
            const { error: btnInsertErr } = await admin
              .from('messenger_messages')
              .insert({
                thread_id: thread.id,
                user_id: thread.user_id,
                direction: 'outbound',
                sender: 'bot',
                fb_message_id: buttonFbId,
                body: `${btnText}\n${chosen.cta_label} → ${targetUrl}`,
              })
            if (btnInsertErr && (btnInsertErr as { code?: string }).code !== '23505') {
              throw btnInsertErr
            }
            await admin
              .from('messenger_threads')
              .update({
                last_message_at: new Date().toISOString(),
                last_message_preview: `${chosen.cta_label} · ${chosen.title}`.slice(0, 200),
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
        })
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
    const attempts = job.attempts + 1
    const failed = attempts >= MAX_ATTEMPTS
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[messenger.worker] job error', job.id, msg)
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
      'body, fb_message_id, messenger_threads!inner(id, user_id, page_id, psid, lead_id, full_name, auto_reply_enabled, inbound_since_classify)',
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
  excludeMessageId: string,
): Promise<AnswerHistory> {
  const { data } = await admin
    .from('messenger_messages')
    .select('id, direction, sender, body, created_at')
    .eq('thread_id', threadId)
    .neq('id', excludeMessageId)
    .order('created_at', { ascending: false })
    .limit(HISTORY_LIMIT)
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
    .select('id, name, description')
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
    .select('id, slug, title, cta_label, bot_send_instructions, signing_secret')
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
    }))
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
