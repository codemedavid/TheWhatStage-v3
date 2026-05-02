import { createHmac, timingSafeEqual } from 'node:crypto'
import { after, NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

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
    attachments?: FbAttachment[]
  }
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
        const jobId = await handleEvent(admin, fbPageId, ev)
        if (jobId) messengerEnqueued.push(jobId)
      } catch (e) {
        console.error('[fb.webhook] handleEvent failed', e)
      }
    }

    for (const change of entry.changes ?? []) {
      try {
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
async function handleEvent(
  admin: AdminClient,
  fbPageId: string,
  ev: FbMessaging,
): Promise<string | null> {
  const msg = ev.message
  if (!msg || msg.is_echo) return null
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

  // Upsert thread (page_id, psid) → returns id.
  const { data: thread, error: threadErr } = await admin
    .from('messenger_threads')
    .upsert(
      { page_id: page.id, user_id: userId, psid },
      { onConflict: 'page_id,psid', ignoreDuplicates: false },
    )
    .select('id, auto_reply_enabled, lead_id')
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
  if (thread.auto_reply_enabled === false) {
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
