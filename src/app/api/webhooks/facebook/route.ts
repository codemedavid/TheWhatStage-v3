import { createHmac, timingSafeEqual } from 'node:crypto'
import { after, NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { interruptWorkflowRun } from '@/lib/workflow/trigger'
import { isBotPaused } from '@/lib/chatbot/takeover'
import { handlePostback } from './_postback'
import { isUserActive } from './_status'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// =====================================================================
// GET: webhook verification handshake
// FB sends ?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
// We echo hub.challenge iff the verify token matches our secret.
// =====================================================================
export async function GET(req: NextRequest) {
  const url = req.nextUrl
  const mode = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')

  const expected = process.env.FB_WEBHOOK_VERIFY_TOKEN
  if (!expected) {
    console.error('[fb.webhook] FB_WEBHOOK_VERIFY_TOKEN not set')
    return new NextResponse('server misconfigured', { status: 500 })
  }

  if (mode === 'subscribe' && constantTimeEq(token, expected) && challenge) {
    return new NextResponse(challenge, { status: 200 })
  }
  return new NextResponse('forbidden', { status: 403 })
}

function constantTimeEq(a: string | null, b: string): boolean {
  if (!a) return false
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  try {
    return timingSafeEqual(ab, bb)
  } catch {
    return false
  }
}

// =====================================================================
// POST: receive Messenger and Page feed comment events.
// Hard rule from FB: ack within 20s. Persist + enqueue, then return 200
// and fire the async worker without awaiting it.
// =====================================================================
type FbAttachment = { type?: string; payload?: { url?: string } }
type FbMessaging = {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  message?: {
    mid?: string
    text?: string
    is_echo?: boolean
    // Present on Send-API echoes (our bot, our dashboard, any other connected
    // app). Absent on echoes of replies typed in Page Inbox / Meta Business
    // Suite / Messenger app — those are how we detect a human takeover.
    app_id?: number | string
    attachments?: FbAttachment[]
  }
  optin?: {
    type?: string
    payload?: string
    one_time_notif_token?: string
  }
  postback?: { payload?: string; title?: string }
}
type FbFeedChange = {
  field?: string
  value?: {
    item?: string
    verb?: string
    comment_id?: string
    parent_id?: string
    post_id?: string
    from?: { id?: string; name?: string }
    message?: string
    // message_template_status_update fields (per Meta docs):
    //   event: 'APPROVED' | 'REJECTED' | 'PENDING' | 'DISABLED'
    //   message_template_id: string  (Meta's template id)
    //   message_template_name: string
    //   message_template_language: string
    //   reason?: string
    event?: string
    message_template_id?: string
    message_template_name?: string
    message_template_language?: string
    reason?: string
  }
}
type FbEntry = {
  id?: string // page id
  messaging?: FbMessaging[]
  changes?: FbFeedChange[]
}
type FbPayload = { object?: string; entry?: FbEntry[] }

export async function POST(req: NextRequest) {
  const raw = await req.text()
  const sig = req.headers.get('x-hub-signature-256')

  if (!verifySignature(raw, sig)) {
    console.warn('[fb.webhook] invalid signature')
    return new NextResponse('forbidden', { status: 403 })
  }

  let payload: FbPayload
  try {
    payload = JSON.parse(raw) as FbPayload
  } catch {
    return new NextResponse('bad json', { status: 400 })
  }

  if (payload.object !== 'page') {
    return NextResponse.json({ received: true })
  }

  const admin = createAdminClient()
  const messengerEnqueued: string[] = []
  const commentEnqueued: string[] = []

  for (const entry of payload.entry ?? []) {
    const fbPageId = entry.id
    if (!fbPageId) continue

    for (const ev of entry.messaging ?? []) {
      try {
        if (ev.postback) {
          const jobId = await handlePostback(admin, fbPageId, ev)
          if (jobId) messengerEnqueued.push(jobId)
          continue
        }
        const jobId = await handleEvent(admin, fbPageId, ev)
        if (jobId) messengerEnqueued.push(jobId)
      } catch (e) {
        console.error('[fb.webhook] event handling failed', e)
      }
    }

    for (const change of entry.changes ?? []) {
      try {
        if (change.field === 'message_template_status_update') {
          await handleTemplateStatusUpdate(admin, change)
          continue
        }
        const jobId = await handleFeedChange(admin, fbPageId, change)
        if (jobId) commentEnqueued.push(jobId)
      } catch (e) {
        console.error('[fb.webhook] handleFeedChange failed', e)
      }
    }
  }

  // Fire the async worker without blocking the ack. `after()` keeps the
  // function alive past the response on Vercel — a bare `void fetch(...)` can
  // be cut off when the platform recycles the invocation. The worker is gated
  // by a shared secret so internet randos can't trigger replies.
  if (messengerEnqueued.length > 0) {
    after(() => triggerWorker())
  }
  if (commentEnqueued.length > 0) {
    after(() => triggerCommentWorker())
  }

  return NextResponse.json({ received: true })
}

function verifySignature(raw: string, sig: string | null): boolean {
  const secret = process.env.FB_APP_SECRET
  if (!secret) return false
  if (!sig || !sig.startsWith('sha256=')) return false
  const expected = createHmac('sha256', secret).update(raw).digest('hex')
  const got = sig.slice('sha256='.length)
  if (expected.length !== got.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(got, 'hex'))
  } catch {
    return false
  }
}

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Resolve which page row owns this event, upsert the thread, persist the
 * inbound message (idempotent by mid), and enqueue a worker job. Returns
 * the job id when one was created, or null when the event was a non-message
 * (delivery/read receipts, echoes, etc.) or already seen.
 */
async function handleOtnGrant(admin: AdminClient, fbPageId: string, ev: FbMessaging): Promise<void> {
  const psid = ev.sender?.id
  const token = ev.optin?.one_time_notif_token
  if (!psid || !token) return

  const { data: thread } = await admin
    .from('messenger_threads')
    .select('id, controlled_by_run_id')
    .eq('psid', psid)
    .maybeSingle<{ id: string; controlled_by_run_id: string | null }>()

  if (!thread?.controlled_by_run_id) return

  await interruptWorkflowRun(admin, thread.controlled_by_run_id, {
    kind: 'otn_granted',
    otn_token: token,
  })
}

/**
 * Human takeover from outside WhatStage. Fired when Meta echoes a message
 * that wasn't sent through our app (no `app_id`) — i.e. the page admin
 * replied in Page Inbox, Meta Business Suite, or the Messenger app. Mirrors
 * `replyAsOperator` (dashboard path): persists the outbound message and
 * stamps `bot_paused_until` so the reactive bot stops interrupting.
 */
async function handleOperatorEcho(
  admin: AdminClient,
  fbPageId: string,
  ev: FbMessaging,
): Promise<void> {
  const msg = ev.message
  if (!msg) return
  // On echoes, the customer's PSID is in `recipient.id`; `sender.id` is the page.
  const psid = ev.recipient?.id
  const mid = msg.mid
  if (!psid || !mid) return

  const { data: page, error: pageErr } = await admin
    .from('facebook_pages')
    .select('id, facebook_connections(user_id)')
    .eq('fb_page_id', fbPageId)
    .maybeSingle()
  if (pageErr || !page) {
    console.warn('[fb.webhook] operator echo: unknown page', { fbPageId, err: pageErr?.message })
    return
  }
  const conn = (page as { facebook_connections?: { user_id?: string } | { user_id?: string }[] })
    .facebook_connections
  const userId = Array.isArray(conn) ? conn[0]?.user_id : conn?.user_id
  if (!userId) return
  if (!(await isUserActive(admin, userId))) return

  // Don't create threads from echoes — only react if the customer's thread
  // already exists. If the operator messages a brand-new PSID from Meta's UI,
  // there's no inbound message yet so nothing for the bot to interrupt.
  const { data: thread } = await admin
    .from('messenger_threads')
    .select('id, controlled_by_run_id')
    .eq('page_id', (page as { id: string }).id)
    .eq('psid', psid)
    .maybeSingle<{ id: string; controlled_by_run_id: string | null }>()
  if (!thread) {
    console.log('[fb.webhook] operator echo: no matching thread, skipping', { fbPageId, psid })
    return
  }

  const text = msg.text ?? ''
  const attachments = msg.attachments ?? null

  // unique(fb_message_id) makes this idempotent. If our worker/dashboard
  // already wrote this row (shouldn't happen — those carry app_id — but
  // belt-and-suspenders), the 23505 conflict is benign.
  const { data: inserted, error: insertErr } = await admin
    .from('messenger_messages')
    .insert({
      thread_id: thread.id,
      user_id: userId,
      direction: 'outbound',
      sender: 'operator',
      fb_message_id: mid,
      body: text,
      attachments,
    })
    .select('id')
    .maybeSingle()
  if (insertErr) {
    if ((insertErr as { code?: string }).code === '23505') return
    console.error('[fb.webhook] operator echo: message insert failed', insertErr.message)
    return
  }
  if (!inserted) return

  const { data: cfg } = await admin
    .from('chatbot_configs')
    .select('human_takeover_minutes')
    .eq('user_id', userId)
    .maybeSingle<{ human_takeover_minutes: number }>()
  const pauseMinutes = cfg?.human_takeover_minutes ?? 0

  const threadUpdate: Record<string, unknown> = {
    last_message_at: new Date().toISOString(),
    last_message_preview: text.slice(0, 200) || '[attachment]',
  }
  if (pauseMinutes > 0) {
    threadUpdate.bot_paused_until = new Date(Date.now() + pauseMinutes * 60_000).toISOString()
  }

  // Mirror replyAsOperator: a human reply during a workflow run trumps it.
  // Clear the lock and park the run for 24h so it doesn't keep stepping past
  // the takeover.
  if (thread.controlled_by_run_id) {
    threadUpdate.controlled_by_run_id = null
    const resumeAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    const { data: runRow } = await admin
      .from('workflow_runs')
      .select('state')
      .eq('id', thread.controlled_by_run_id)
      .in('status', ['running', 'waiting'])
      .maybeSingle<{ state: Record<string, unknown> }>()
    if (runRow) {
      await admin
        .from('workflow_runs')
        .update({
          status: 'waiting',
          next_run_at: resumeAt,
          state: { ...runRow.state, waiting_for: 'operator_took_over' },
        })
        .eq('id', thread.controlled_by_run_id)
    }
  }

  await admin.from('messenger_threads').update(threadUpdate).eq('id', thread.id)
  console.log('[fb.webhook] operator echo: takeover engaged', {
    threadId: thread.id,
    pauseMinutes,
  })
}

async function handleEvent(
  admin: AdminClient,
  fbPageId: string,
  ev: FbMessaging,
): Promise<string | null> {
  // OTN grant — user approved a one-time notification request.
  if (ev.optin?.one_time_notif_token) {
    await handleOtnGrant(admin, fbPageId, ev)
    return null
  }

  const msg = ev.message
  if (!msg) return null
  if (msg.is_echo) {
    // Send-API echoes (our worker, our dashboard, any connected app) carry
    // `app_id`. Echoes typed in Meta's own UIs (Page Inbox, Business Suite,
    // Messenger app) do not — those are human takeovers we must respect.
    if (msg.app_id === undefined || msg.app_id === null) {
      await handleOperatorEcho(admin, fbPageId, ev)
    }
    return null
  }
  const psid = ev.sender?.id
  const mid = msg.mid
  if (!psid || !mid) return null

  // Look up the page (and the user behind it).
  const { data: page, error: pageErr } = await admin
    .from('facebook_pages')
    .select('id, name, picture_url, page_access_token, connection_id, facebook_connections(user_id)')
    .eq('fb_page_id', fbPageId)
    .maybeSingle()

  if (pageErr || !page) {
    console.warn('[fb.webhook] unknown page', { fbPageId, err: pageErr?.message })
    return null
  }

  const conn = (page as { facebook_connections?: { user_id?: string } | { user_id?: string }[] })
    .facebook_connections
  const userId = Array.isArray(conn) ? conn[0]?.user_id : conn?.user_id
  if (!userId) {
    console.warn('[fb.webhook] page has no owner', { fbPageId })
    return null
  }

  // Single kill-switch for the bot: paused/pending owners get no replies and
  // no writes (no leads, no threads, no message rows). Their inbound DMs are
  // silently dropped.
  if (!(await isUserActive(admin, userId))) {
    return null
  }

  // Upsert thread (page_id, psid) → returns id.
  const { data: thread, error: threadErr } = await admin
    .from('messenger_threads')
    .upsert(
      { page_id: page.id, user_id: userId, psid },
      { onConflict: 'page_id,psid', ignoreDuplicates: false },
    )
    .select('id, auto_reply_enabled, bot_paused_until, lead_id')
    .single()

  if (threadErr || !thread) {
    console.error('[fb.webhook] thread upsert failed', threadErr?.message)
    return null
  }

  const text = msg.text ?? ''
  const attachments = msg.attachments ?? null

  // Dedupe via unique(fb_message_id). If we've already stored this mid we
  // silently skip enqueueing — FB retries can deliver the same event.
  const { data: inserted, error: insertErr } = await admin
    .from('messenger_messages')
    .insert({
      thread_id: thread.id,
      user_id: userId,
      direction: 'inbound',
      sender: 'user',
      fb_message_id: mid,
      body: text,
      attachments,
    })
    .select('id')
    .maybeSingle()

  if (insertErr) {
    // 23505 = unique violation → already processed, fine.
    if ((insertErr as { code?: string }).code === '23505') return null
    console.error('[fb.webhook] message insert failed', insertErr.message)
    return null
  }
  if (!inserted) return null

  // Update thread tail.
  await admin
    .from('messenger_threads')
    .update({
      last_message_at: new Date().toISOString(),
      last_message_preview: text.slice(0, 200) || '[attachment]',
      unread_count: thread.lead_id ? undefined : 1, // first-touch threads start at 1
    })
    .eq('id', thread.id)

  // Enqueue if the bot is on for this thread, OR if global auto-classify is
  // enabled for this user (the worker will skip the reply step and only
  // classify every Nth message). Skip otherwise.
  // Reactive bot is gated by either the sticky manual toggle OR an active
  // human-takeover pause. In either case, fall through to classify-only if
  // the user has auto_classify enabled.
  if (
    thread.auto_reply_enabled === false ||
    isBotPaused((thread as { bot_paused_until?: string | null }).bot_paused_until)
  ) {
    const { data: cfg } = await admin
      .from('chatbot_configs')
      .select('auto_classify_enabled')
      .eq('user_id', userId)
      .maybeSingle<{ auto_classify_enabled: boolean }>()
    if (!cfg?.auto_classify_enabled) return null
  }

  const { data: job, error: jobErr } = await admin
    .from('messenger_jobs')
    .insert({
      thread_id: thread.id,
      inbound_msg_id: inserted.id,
      user_id: userId,
    })
    .select('id')
    .single()

  if (jobErr || !job) {
    console.error('[fb.webhook] job enqueue failed', jobErr?.message)
    return null
  }
  return job.id
}

async function handleFeedChange(
  admin: AdminClient,
  fbPageId: string,
  change: FbFeedChange,
): Promise<string | null> {
  if (change.field !== 'feed') return null

  const value = change.value
  if (!value || value.item !== 'comment') return null
  if (!value.comment_id) return null
  if (value.verb && !['add', 'edited'].includes(value.verb)) return null
  // The bot's own public replies come back as feed events with from.id == page.
  // Without this guard the worker reprocesses them and the page ends up
  // replying to itself in a loop.
  if (value.from?.id && value.from.id === fbPageId) return null

  const { data: page, error: pageErr } = await admin
    .from('facebook_pages')
    .select('id, name, page_access_token, facebook_connections(user_id)')
    .eq('fb_page_id', fbPageId)
    .maybeSingle()

  if (pageErr || !page) {
    console.warn('[fb.webhook] unknown page for comment', { fbPageId, err: pageErr?.message })
    return null
  }

  const conn = (page as { facebook_connections?: { user_id?: string } | { user_id?: string }[] })
    .facebook_connections
  const userId = Array.isArray(conn) ? conn[0]?.user_id : conn?.user_id
  if (!userId) {
    console.warn('[fb.webhook] page has no owner for comment', { fbPageId })
    return null
  }

  if (!(await isUserActive(admin, userId))) {
    return null
  }

  const { data: job, error: jobErr } = await admin
    .from('facebook_comment_jobs')
    .upsert(
      {
        page_id: page.id,
        user_id: userId,
        fb_comment_id: value.comment_id,
        fb_parent_id: value.parent_id ?? null,
        fb_post_id: value.post_id ?? null,
        webhook_event: change,
        status: 'queued',
        scheduled_at: new Date().toISOString(),
        started_at: null,
        finished_at: null,
      },
      { onConflict: 'fb_comment_id', ignoreDuplicates: value.verb !== 'edited' },
    )
    .select('id')
    .maybeSingle()

  if (jobErr) {
    console.error('[fb.webhook] comment job enqueue failed', jobErr.message)
    return null
  }
  return job?.id ?? null
}

/**
 * POST to the internal worker. Run via `after()` so the call survives the
 * webhook's 200 response on Vercel — a bare `fetch().catch(...)` after the
 * response is racing the platform shutting the invocation down.
 */
async function triggerWorker(): Promise<void> {
  const base = process.env.NEXT_PUBLIC_APP_URL
  const secret = process.env.MESSENGER_WORKER_SECRET
  if (!base || !secret) {
    console.warn('[fb.webhook] worker not configured (NEXT_PUBLIC_APP_URL / MESSENGER_WORKER_SECRET)')
    return
  }
  try {
    await fetch(`${base}/api/messenger/process`, {
      method: 'POST',
      headers: { 'x-worker-secret': secret },
    })
  } catch (e) {
    console.warn('[fb.webhook] worker trigger failed', e)
  }
}

/**
 * Process a `message_template_status_update` change. Meta sends these when
 * an approval state changes for a template registered against any page that
 * has subscribed our app. Match by `message_template_id` first; fall back to
 * `(name, language)` so the row updates correctly even when the template was
 * submitted before we started persisting Meta's id.
 */
async function handleTemplateStatusUpdate(
  admin: AdminClient,
  change: FbFeedChange,
): Promise<void> {
  const v = change.value
  if (!v) return
  const event = (v.event ?? '').toUpperCase()
  const reason = v.reason ?? null
  const metaId = v.message_template_id ?? null
  const name = v.message_template_name ?? null
  const language = v.message_template_language ?? null

  let status: 'approved' | 'rejected' | 'pending' | 'disabled'
  switch (event) {
    case 'APPROVED': status = 'approved'; break
    case 'REJECTED': status = 'rejected'; break
    case 'PENDING':  status = 'pending';  break
    case 'DISABLED': status = 'disabled'; break
    default:
      console.warn('[fb.webhook] unknown template event', { event })
      return
  }

  // Locate the row.
  let query = admin
    .from('messenger_message_templates')
    .select('id, meta_template_id, meta_status')
  if (metaId) {
    query = query.eq('meta_template_id', metaId)
  } else if (name && language) {
    query = query.eq('name', name).eq('language', language)
  } else {
    console.warn('[fb.webhook] template event missing identifiers', v)
    return
  }
  const { data: row } = await query.maybeSingle<{
    id: string
    meta_template_id: string | null
    meta_status: string
  }>()

  if (!row) {
    console.warn('[fb.webhook] template event for unknown template', { metaId, name })
    return
  }

  const update: Record<string, unknown> = {
    meta_status: status,
    meta_rejection_reason: status === 'rejected' ? reason : null,
  }
  if (status === 'approved') update.approved_at = new Date().toISOString()
  if (metaId && !row.meta_template_id) update.meta_template_id = metaId

  await admin
    .from('messenger_message_templates')
    .update(update)
    .eq('id', row.id)
}

async function triggerCommentWorker(): Promise<void> {
  const base = process.env.NEXT_PUBLIC_APP_URL
  const secret = process.env.COMMENT_WORKER_SECRET
  if (!base || !secret) {
    console.warn('[fb.webhook] comment worker not configured')
    return
  }
  try {
    await fetch(`${base}/api/comments/process`, {
      method: 'POST',
      headers: { 'x-worker-secret': secret },
    })
  } catch (e) {
    console.warn('[fb.webhook] comment worker trigger failed', e)
  }
}
