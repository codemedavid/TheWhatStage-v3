import { createHash } from 'node:crypto'
import type { createAdminClient } from '@/lib/supabase/admin'
import { isUserActive } from './_status'

type AdminClient = ReturnType<typeof createAdminClient>

interface PostbackEvent {
  sender?: { id?: string }
  postback?: { payload?: string; title?: string }
  timestamp?: number
}

interface FbPageRow {
  id: string
  facebook_connections?: { user_id?: string } | { user_id?: string }[]
}

function syntheticId(psid: string, timestamp: number, payload: string): string {
  const hash = createHash('sha1').update(payload).digest('hex').slice(0, 8)
  return `pb:${psid}:${timestamp}:${hash}`
}

function pageOwnerId(page: FbPageRow): string | null {
  const conn = page.facebook_connections
  const user = Array.isArray(conn) ? conn[0]?.user_id : conn?.user_id
  return user ?? null
}

/** Longest reply a saved-message button may speak on the customer's behalf. */
const SAY_REPLY_MAX = 900

/** What a recognised payload turns into: an inbound message the bot answers. */
interface SyntheticInbound {
  body: string
  attachments: Record<string, unknown>
  /** Thread-list preview; defaults to the body when a payload has nothing better. */
  preview?: string
}

/**
 * `rec_inquire:<slug>` — the Inquire button on a property recommendation card.
 * Speaks for the customer using the property's own title.
 */
async function inquirePostback(
  admin: AdminClient,
  userId: string,
  slug: string,
): Promise<SyntheticInbound | null> {
  const { data: property, error: propErr } = await admin
    .from('business_items')
    .select('id, title')
    .eq('user_id', userId)
    .eq('kind', 'property')
    .eq('slug', slug)
    .maybeSingle<{ id: string; title: string }>()
  if (propErr || !property) {
    console.warn('[fb.webhook] postback property not found', { slug, err: propErr?.message })
    return null
  }
  return {
    body: `I'd like more info on ${property.title}`,
    attachments: { kind: 'inquire_postback', property_id: property.id, property_slug: slug },
    preview: `📩 Inquire · ${property.title}`,
  }
}

/**
 * `btn_say:<text>` — a saved-message button configured to trigger a bot reply.
 * The operator wrote the text when building the button, so it is recorded
 * verbatim as if the customer had typed it and the normal job pipeline answers.
 */
function sayPostback(text: string): SyntheticInbound | null {
  const body = text.trim().slice(0, SAY_REPLY_MAX)
  if (!body) {
    console.warn('[fb.webhook] postback btn_say carried no text')
    return null
  }
  return { body, attachments: { kind: 'button_reply' } }
}

/**
 * Handle an inbound Messenger postback event. Returns the enqueued job id when
 * one was created, or null when the event was malformed, dedup'd, or pointed
 * at something that no longer exists.
 */
export async function handlePostback(
  admin: AdminClient,
  fbPageId: string,
  ev: PostbackEvent,
): Promise<string | null> {
  const psid = ev.sender?.id
  const payload = ev.postback?.payload
  const timestamp = ev.timestamp ?? Date.now()
  if (!psid || !payload) {
    console.warn('[fb.webhook] postback malformed (missing psid or payload)')
    return null
  }

  const colonIdx = payload.indexOf(':')
  if (colonIdx <= 0) {
    console.warn('[fb.webhook] postback malformed (no prefix)', { payload })
    return null
  }
  const prefix = payload.slice(0, colonIdx)
  const arg = payload.slice(colonIdx + 1)

  if (prefix !== 'rec_inquire' && prefix !== 'btn_say') {
    console.warn('[fb.webhook] postback unknown prefix', { prefix })
    return null
  }

  const { data: page, error: pageErr } = await admin
    .from('facebook_pages')
    .select('id, facebook_connections(user_id)')
    .eq('fb_page_id', fbPageId)
    .maybeSingle<FbPageRow>()
  if (pageErr || !page) {
    console.warn('[fb.webhook] postback unknown page', { fbPageId, err: pageErr?.message })
    return null
  }
  const userId = pageOwnerId(page)
  if (!userId) {
    console.warn('[fb.webhook] postback page has no owner', { fbPageId })
    return null
  }

  if (!(await isUserActive(admin, userId))) {
    return null
  }

  const inbound =
    prefix === 'rec_inquire' ? await inquirePostback(admin, userId, arg) : sayPostback(arg)
  if (!inbound) return null

  // Upsert thread (mirror of handleEvent — if it doesn't exist yet we create it).
  const { data: thread, error: threadErr } = await admin
    .from('messenger_threads')
    .upsert(
      { page_id: page.id, user_id: userId, psid },
      { onConflict: 'page_id,psid', ignoreDuplicates: false },
    )
    .select('id')
    .single<{ id: string }>()
  if (threadErr || !thread) {
    console.error('[fb.webhook] postback thread upsert failed', threadErr?.message)
    return null
  }

  const fbMessageId = syntheticId(psid, timestamp, payload)

  const { data: inserted, error: insertErr } = await admin
    .from('messenger_messages')
    .insert({
      thread_id: thread.id,
      user_id: userId,
      direction: 'inbound',
      sender: 'user',
      fb_message_id: fbMessageId,
      body: inbound.body,
      attachments: inbound.attachments,
    })
    .select('id')
    .maybeSingle()

  if (insertErr) {
    if ((insertErr as { code?: string }).code === '23505') return null
    console.error('[fb.webhook] postback message insert failed', insertErr.message)
    return null
  }
  if (!inserted) return null

  const previewText = (inbound.preview ?? inbound.body).slice(0, 200)
  const nowIso = new Date().toISOString()
  await admin
    .from('messenger_threads')
    .update({
      last_inbound_at: nowIso,
      last_message_at: nowIso,
      last_message_preview: previewText,
    })
    .eq('id', thread.id)

  const { data: job, error: jobErr } = await admin
    .from('messenger_jobs')
    .insert({
      thread_id: thread.id,
      inbound_msg_id: (inserted as { id: string }).id,
      user_id: userId,
    })
    .select('id')
    .single<{ id: string }>()

  if (jobErr || !job) {
    console.error('[fb.webhook] postback job enqueue failed', jobErr?.message)
    return null
  }

  console.log('[fb.webhook] postback received', { prefix, threadId: thread.id })
  return job.id
}
