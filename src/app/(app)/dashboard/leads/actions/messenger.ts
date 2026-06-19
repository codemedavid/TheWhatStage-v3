'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/facebook/crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendOutbound, type OutboundPayload } from '@/lib/messenger/outbound'
import { deeplinkActionPageUrl } from '@/lib/action-pages/urls'
import type { MessengerAttachmentType } from '@/lib/facebook/messenger'
import { resetThreadCountersByLead } from '@/lib/messenger/reset-counters'

export interface ConversationAttachment {
  type: 'image' | 'video' | 'audio' | 'file' | 'action_page'
  /** Display URL — freshly signed for storage-backed media, null if unavailable. */
  url: string | null
  name: string | null
}

export interface ConversationMessage {
  id: string
  direction: 'inbound' | 'outbound'
  sender: 'user' | 'bot' | 'operator'
  body: string
  created_at: string
  error: string | null
  attachments: ConversationAttachment[]
}

export interface ConversationComment {
  id: string
  fb_comment_id: string
  message: string
  commenter_name: string | null
  classification: 'good' | 'question' | 'spam' | 'abusive' | 'needs_no_action'
  confidence: 'low' | 'medium' | 'high'
  moderation_action: 'none' | 'public_reply' | 'private_reply' | 'hide' | 'delete'
  graph_status: 'pending' | 'sent' | 'hidden' | 'deleted' | 'failed' | 'skipped'
  created_at: string
}

export interface ConversationStageEvent {
  id: string
  from_stage_name: string | null
  to_stage_name: string | null
  source: 'ai' | 'user'
  reason: string | null
  confidence: 'low' | 'medium' | 'high' | null
  created_at: string
  can_undo: boolean
}

export interface ConversationData {
  thread: {
    id: string
    psid: string
    full_name: string | null
    picture_url: string | null
    auto_reply_enabled: boolean
    bot_paused_until: string | null
    last_message_at: string | null
    page_name: string | null
    /** Counts captured at load time (before the view clears unread). */
    unread_count: number
    missed_count: number
  }
  messages: ConversationMessage[]
  stageEvents: ConversationStageEvent[]
  comments: ConversationComment[]
}

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

/**
 * Load the (single) messenger thread linked to this lead, plus the most
 * recent messages. Returns null when the lead has no Messenger thread yet.
 */
export async function loadConversation(
  leadId: string,
): Promise<ConversationData | null> {
  const { supabase } = await requireUser()

  const { data: thread } = await supabase
    .from('messenger_threads')
    .select(
      'id, psid, full_name, picture_url, auto_reply_enabled, bot_paused_until, last_message_at, unread_count, missed_count, page_id, facebook_pages(name)',
    )
    .eq('lead_id', leadId)
    .maybeSingle()
  if (!thread) return null

  // Opening the conversation marks it read: clear the unread badge but keep the
  // missed tally (only an explicit "Mark as read" / markThreadRead clears that).
  // Capture the counts first so the panel can still show what was waiting.
  const unreadAtOpen = (thread as { unread_count?: number | null }).unread_count ?? 0
  const missedAtOpen = (thread as { missed_count?: number | null }).missed_count ?? 0
  if (unreadAtOpen > 0) {
    await resetThreadCountersByLead(supabase, leadId, { resetMissed: false })
  }

  const { data: rawMessages, error: msgErr } = await supabase
    .from('messenger_messages')
    .select('id, direction, sender, body, created_at, error, attachments')
    .eq('thread_id', thread.id)
    .order('created_at', { ascending: true })
    .limit(200)
  if (msgErr) throw new Error(`loadConversation: ${msgErr.message}`)

  const messages = await resolveMessageAttachments(supabase, rawMessages ?? [])

  const pageName =
    (Array.isArray(thread.facebook_pages)
      ? thread.facebook_pages[0]?.name
      : (thread.facebook_pages as { name?: string } | null)?.name) ?? null

  const [{ data: events }, { data: stages }, { data: comments, error: commentErr }] =
    await Promise.all([
      supabase
        .from('lead_stage_events')
        .select('id, from_stage_id, to_stage_id, source, reason, confidence, created_at')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: true })
        .limit(200),
      supabase.from('pipeline_stages').select('id, name'),
      supabase
        .from('facebook_lead_comments')
        .select(
          'id, fb_comment_id, message, commenter_name, classification, confidence, moderation_action, graph_status, created_at',
        )
        .eq('lead_id', leadId)
        .order('created_at', { ascending: true })
        .limit(200),
    ])
  if (commentErr) throw new Error(`loadConversation comments: ${commentErr.message}`)
  const stageName = new Map((stages ?? []).map((s) => [s.id as string, s.name as string]))
  // Only the most recent AI event is undoable (avoids tangled chains).
  let lastAiId: string | null = null
  for (const e of events ?? []) {
    if (e.source === 'ai') lastAiId = e.id as string
  }
  const stageEvents: ConversationStageEvent[] = (events ?? []).map((e) => ({
    id: e.id as string,
    from_stage_name: e.from_stage_id ? (stageName.get(e.from_stage_id as string) ?? null) : null,
    to_stage_name: e.to_stage_id ? (stageName.get(e.to_stage_id as string) ?? null) : null,
    source: e.source as 'ai' | 'user',
    reason: (e.reason as string | null) ?? null,
    confidence: (e.confidence as ConversationStageEvent['confidence']) ?? null,
    created_at: e.created_at as string,
    can_undo: e.source === 'ai' && e.id === lastAiId,
  }))

  return {
    thread: {
      id: thread.id,
      psid: thread.psid,
      full_name: thread.full_name,
      picture_url: thread.picture_url,
      auto_reply_enabled: thread.auto_reply_enabled,
      bot_paused_until: (thread as { bot_paused_until?: string | null }).bot_paused_until ?? null,
      last_message_at: thread.last_message_at,
      page_name: pageName,
      unread_count: unreadAtOpen,
      missed_count: missedAtOpen,
    },
    messages,
    stageEvents,
    comments: (comments ?? []) as ConversationComment[],
  }
}

/**
 * Explicit "Mark as read": clears BOTH the unread badge and the missed tally for
 * the lead's thread. Unlike opening the conversation (which clears unread only),
 * this resets the running "messages we missed" count to zero.
 */
export async function markThreadRead(leadId: string): Promise<void> {
  const { supabase } = await requireUser()
  await resetThreadCountersByLead(supabase, leadId, { resetMissed: true })
  // Refresh the badge surfaces (projects board, leads, submissions, nav counter).
  revalidatePath('/dashboard', 'layout')
}

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

interface RawMessageRow {
  id: string
  direction: 'inbound' | 'outbound'
  sender: 'user' | 'bot' | 'operator'
  body: string
  created_at: string
  error: string | null
  attachments: unknown
}

const DISPLAY_URL_TTL_SECONDS = 60 * 60

/**
 * Normalize the heterogeneous `attachments` jsonb into display-ready entries.
 * Outbound operator rows persist re-signable `storage_path`/`media_asset_id`
 * (signed URLs expire) plus direct `url`s for external/action-page sends;
 * inbound Meta rows use `{ type, payload: { url } }`. Storage-backed entries are
 * re-signed in a single batched pass.
 */
async function resolveMessageAttachments(
  supabase: SupabaseServerClient,
  rows: RawMessageRow[],
): Promise<ConversationMessage[]> {
  const storagePaths = new Set<string>()
  for (const row of rows) {
    for (const raw of Array.isArray(row.attachments) ? row.attachments : []) {
      const path = (raw as { storage_path?: unknown }).storage_path
      if (typeof path === 'string' && path) storagePaths.add(path)
    }
  }

  const signedByPath = new Map<string, string>()
  await Promise.all(
    [...storagePaths].map(async (path) => {
      const { data } = await supabase.storage
        .from('media-assets')
        .createSignedUrl(path, DISPLAY_URL_TTL_SECONDS)
      if (data?.signedUrl) signedByPath.set(path, data.signedUrl)
    }),
  )

  const normalizeType = (raw: string | undefined): ConversationAttachment['type'] => {
    switch (raw) {
      case 'image':
      case 'video':
      case 'audio':
      case 'file':
      case 'action_page':
        return raw
      default:
        return 'file'
    }
  }

  return rows.map((row) => {
    const attachments: ConversationAttachment[] = (
      Array.isArray(row.attachments) ? row.attachments : []
    ).map((raw) => {
      const a = raw as {
        type?: string
        url?: string
        storage_path?: string
        name?: string
        payload?: { url?: string }
      }
      const url =
        (a.storage_path && signedByPath.get(a.storage_path)) ||
        a.url ||
        a.payload?.url ||
        null
      return { type: normalizeType(a.type), url, name: a.name ?? null }
    })
    return {
      id: row.id,
      direction: row.direction,
      sender: row.sender,
      body: row.body,
      created_at: row.created_at,
      error: row.error,
      attachments,
    }
  })
}

export interface LatestStageRationale {
  stage_name: string | null
  source: StageEventSource
  reason: string | null
  confidence: 'low' | 'medium' | 'high' | null
  created_at: string
}

/**
 * Most recent stage transition for a lead — surfaces "why is this lead in
 * this stage" in the drawer. Returns null when the lead has never been moved
 * (no events) or when the latest event has no destination stage.
 */
export async function loadLeadComments(leadId: string): Promise<ConversationComment[]> {
  const { supabase } = await requireUser()
  const { data, error } = await supabase
    .from('facebook_lead_comments')
    .select(
      'id, fb_comment_id, message, commenter_name, classification, confidence, moderation_action, graph_status, created_at',
    )
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(`loadLeadComments: ${error.message}`)
  return (data ?? []) as ConversationComment[]
}

export async function loadLatestStageRationale(
  leadId: string,
): Promise<LatestStageRationale | null> {
  const { supabase } = await requireUser()

  const { data: event } = await supabase
    .from('lead_stage_events')
    .select('to_stage_id, source, reason, confidence, created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{
      to_stage_id: string | null
      source: string
      reason: string | null
      confidence: 'low' | 'medium' | 'high' | null
      created_at: string
    }>()
  if (!event || !event.to_stage_id) return null

  const { data: stage } = await supabase
    .from('pipeline_stages')
    .select('name')
    .eq('id', event.to_stage_id)
    .maybeSingle<{ name: string }>()

  return {
    stage_name: stage?.name ?? null,
    source: mapEventSource(event.source),
    reason: event.reason,
    confidence: event.confidence,
    created_at: event.created_at,
  }
}

export type StageEventSource =
  | 'manual'
  | 'classifier'
  | 'deep_classifier'
  | 'action_page'
  | 'workflow'
  | 'unknown'

export interface StageJourneyEvent {
  id: string
  from_stage_name: string | null
  to_stage_name: string | null
  from_position: number | null
  to_position: number | null
  source: StageEventSource
  reason: string | null
  confidence: 'low' | 'medium' | 'high' | null
  created_at: string
}

function mapEventSource(raw: string): StageEventSource {
  switch (raw) {
    case 'user':                   return 'manual'
    case 'classifier':
    case 'ai':                     return 'classifier'  // legacy 'ai' rows
    case 'deep_classifier':        return 'deep_classifier'
    case 'action_page':
    case 'action_page_submission': return 'action_page'
    case 'workflow':               return 'workflow'
    default:                       return 'unknown'
  }
}

export interface StageJourney {
  events: StageJourneyEvent[]
  current_stage_name: string | null
  created_at: string | null
}

/**
 * Full stage transition history for a lead, oldest first, with stage names
 * resolved. Used to render the journey timeline in the lead drawer.
 */
export async function loadStageJourney(leadId: string): Promise<StageJourney> {
  const { supabase } = await requireUser()

  const [{ data: events }, { data: stages }, { data: lead }] = await Promise.all([
    supabase
      .from('lead_stage_events')
      .select('id, from_stage_id, to_stage_id, source, reason, confidence, created_at')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: true })
      .limit(500),
    supabase.from('pipeline_stages').select('id, name, position'),
    supabase
      .from('leads')
      .select('stage_id, created_at')
      .eq('id', leadId)
      .maybeSingle<{ stage_id: string; created_at: string }>(),
  ])

  const stageById = new Map(
    ((stages ?? []) as Array<{ id: string; name: string; position: number }>).map((s) => [s.id, s]),
  )
  const journey: StageJourneyEvent[] = (events ?? []).map((e) => {
    const fromId = e.from_stage_id as string | null
    const toId = e.to_stage_id as string | null
    const fromStage = fromId ? stageById.get(fromId) ?? null : null
    const toStage = toId ? stageById.get(toId) ?? null : null
    return {
      id: e.id as string,
      from_stage_name: fromStage?.name ?? null,
      to_stage_name: toStage?.name ?? null,
      from_position: fromStage?.position ?? null,
      to_position: toStage?.position ?? null,
      source: mapEventSource(e.source as string),
      reason: (e.reason as string | null) ?? null,
      confidence: (e.confidence as StageJourneyEvent['confidence']) ?? null,
      created_at: e.created_at as string,
    }
  })

  return {
    events: journey,
    current_stage_name: lead?.stage_id ? (stageById.get(lead.stage_id)?.name ?? null) : null,
    created_at: lead?.created_at ?? null,
  }
}

export async function undoStageEvent(eventId: string): Promise<void> {
  const { supabase, userId } = await requireUser()

  const { data: event, error: evErr } = await supabase
    .from('lead_stage_events')
    .select('id, lead_id, from_stage_id, to_stage_id, thread_id')
    .eq('id', eventId)
    .maybeSingle<{
      id: string
      lead_id: string
      from_stage_id: string | null
      to_stage_id: string | null
      thread_id: string | null
    }>()
  if (evErr) throw new Error(`undoStageEvent: ${evErr.message}`)
  if (!event || !event.from_stage_id) throw new Error('undoStageEvent: nothing to undo')

  // Recompute position at the bottom of the destination (from) stage.
  const { data: maxRow } = await supabase
    .from('leads')
    .select('position')
    .eq('user_id', userId)
    .eq('stage_id', event.from_stage_id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle<{ position: number }>()
  const nextPosition = (maxRow?.position ?? -1) + 1

  const { error: updErr } = await supabase
    .from('leads')
    .update({ stage_id: event.from_stage_id, position: nextPosition })
    .eq('id', event.lead_id)
  if (updErr) throw new Error(`undoStageEvent: ${updErr.message}`)

  await supabase.from('lead_stage_events').insert({
    lead_id: event.lead_id,
    user_id: userId,
    from_stage_id: event.to_stage_id,
    to_stage_id: event.from_stage_id,
    source: 'user',
    reason: 'Undid AI stage change',
    thread_id: event.thread_id,
  })

  revalidatePath('/dashboard/leads', 'layout')
}

export async function setAutoReply(leadId: string, enabled: boolean): Promise<void> {
  const { supabase } = await requireUser()
  // Enabling clears any auto-pause stamp so the operator doesn't have to wait
  // out the timer after explicitly turning the bot back on. Disabling leaves
  // the stamp alone — the manual toggle and the pause are independent states.
  const patch: Record<string, unknown> = enabled
    ? { auto_reply_enabled: true, bot_paused_until: null }
    : { auto_reply_enabled: false }
  const { error } = await supabase
    .from('messenger_threads')
    .update(patch)
    .eq('lead_id', leadId)
  if (error) throw new Error(`setAutoReply: ${error.message}`)
  revalidatePath('/dashboard/leads', 'layout')
}

/**
 * A stored attachment descriptor on an outbound operator message. The display
 * URL for storage-backed entries is minted fresh on load (signed URLs expire),
 * so we persist the re-signable `storage_path`/`media_asset_id` rather than the
 * short-lived signed URL. `url` is persisted directly only for external-URL and
 * action-page sends, where there is nothing to re-sign.
 */
export interface OperatorAttachment {
  type: MessengerAttachmentType | 'action_page'
  storage_path?: string
  media_asset_id?: string
  action_page_id?: string
  url?: string
  name?: string
}

/**
 * Shared dispatch for every operator-initiated send (text, action page, media).
 * Fetches the thread + page token, sends via the unified outbound pipeline
 * (HUMAN_AGENT policy), persists an audit row, stamps the bot-pause window, and
 * releases any workflow run lock — identical side effects regardless of payload.
 */
interface OperatorThread {
  id: string
  psid: string
  page_id: string
}

interface OperatorSendSpec {
  payload: OutboundPayload
  body: string
  attachments?: OperatorAttachment[]
}

async function dispatchOperatorSend(args: {
  context: string
  leadId: string
  build: (thread: OperatorThread) => OperatorSendSpec | Promise<OperatorSendSpec>
}): Promise<void> {
  const { context, leadId, build } = args
  const { supabase, userId } = await requireUser()

  const { data: thread, error: threadErr } = await supabase
    .from('messenger_threads')
    .select('id, psid, page_id, last_inbound_at, controlled_by_run_id, facebook_pages(page_access_token)')
    .eq('lead_id', leadId)
    .maybeSingle()
  if (threadErr) throw new Error(`${context}: ${threadErr.message}`)
  if (!thread) throw new Error(`${context}: no Messenger thread for lead`)

  const pageRow = Array.isArray(thread.facebook_pages)
    ? thread.facebook_pages[0]
    : (thread.facebook_pages as { page_access_token?: string } | null)
  if (!pageRow?.page_access_token) {
    throw new Error(`${context}: missing page access token`)
  }
  const pageToken = decryptToken(pageRow.page_access_token)

  const { payload, body, attachments } = await build({
    id: thread.id,
    psid: thread.psid,
    page_id: thread.page_id,
  })

  // Use service-role client for sendOutbound (needs to read marketing_optins table).
  const admin = createAdminClient()

  let sentId: string | null = null
  let sendError: string | null = null
  try {
    const result = await sendOutbound({
      admin,
      thread: {
        id: thread.id,
        psid: thread.psid,
        last_inbound_at: (thread as { last_inbound_at?: string | null }).last_inbound_at ?? null,
      },
      pageToken,
      payload,
      kind: 'operator',
    })
    if (result.sent) {
      sentId = result.messageId
    } else {
      sendError = `policy_blocked:${result.reason}`
    }
  } catch (e) {
    sendError = e instanceof Error ? e.message : String(e)
  }

  await supabase.from('messenger_messages').insert({
    thread_id: thread.id,
    user_id: userId,
    direction: 'outbound',
    sender: 'operator',
    fb_message_id: sentId,
    body,
    attachments: attachments ?? null,
    error: sendError,
  })

  // Stamp bot_paused_until regardless of send success/failure — the operator's
  // intent to take over is what matters, not whether the FB API accepted the message.
  const { data: cfg } = await supabase
    .from('chatbot_configs')
    .select('human_takeover_minutes')
    .eq('user_id', userId)
    .maybeSingle()
  const pauseMinutes = cfg?.human_takeover_minutes ?? 0
  if (pauseMinutes > 0) {
    await supabase
      .from('messenger_threads')
      .update({ bot_paused_until: new Date(Date.now() + pauseMinutes * 60_000).toISOString() })
      .eq('id', thread.id)
  }

  if (!sendError) {
    const threadUpdate: Record<string, unknown> = {
      last_message_at: new Date().toISOString(),
      last_message_preview: body.slice(0, 200),
    }

    // §9 operator override: clear the workflow run lock so the bot can resume
    // normal operation when the run's wait expires, and pause the active run
    // with a 24-hour auto-resume timer.
    const runId = (thread as { controlled_by_run_id?: string | null }).controlled_by_run_id ?? null
    if (runId) {
      threadUpdate.controlled_by_run_id = null
      const resumeAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

      // Read the run's current state, merge the pause reason, then write back.
      // Race window is acceptable — operator override is a rare, manual event.
      const { data: runRow } = await admin
        .from('workflow_runs')
        .select('state')
        .eq('id', runId)
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
          .eq('id', runId)
      }
    }

    await supabase
      .from('messenger_threads')
      .update(threadUpdate)
      .eq('id', thread.id)
  }

  if (sendError) throw new Error(`${context}: ${sendError}`)
  revalidatePath('/dashboard/leads', 'layout')
}

export async function replyAsOperator(leadId: string, text: string): Promise<void> {
  const body = text.trim()
  if (!body) return
  await dispatchOperatorSend({
    context: 'replyAsOperator',
    leadId,
    build: () => ({ payload: { kind: 'text', text: body }, body }),
  })
}

// ---------------------------------------------------------------------------
// Operator-triggered action-page send
// ---------------------------------------------------------------------------
const DEEPLINK_TTL_SECONDS = 30 * 24 * 60 * 60

export interface SendableActionPage {
  id: string
  title: string
  kind: string
  cta_label: string | null
}

/**
 * Published action pages the operator can send into a conversation. Drafts and
 * archived pages are excluded so unfinished pages never reach a lead.
 */
export async function listSendableActionPages(): Promise<SendableActionPage[]> {
  const { supabase, userId } = await requireUser()
  const { data, error } = await supabase
    .from('action_pages')
    .select('id, title, kind, cta_label')
    .eq('user_id', userId)
    .eq('status', 'published')
    .order('updated_at', { ascending: false })
  if (error) throw new Error(`listSendableActionPages: ${error.message}`)
  return (data ?? []) as SendableActionPage[]
}

export async function sendActionPageAsOperator(
  leadId: string,
  actionPageId: string,
): Promise<void> {
  const { supabase, userId } = await requireUser()

  // Load + authorize the page here (own client / RLS) so the deeplink builder
  // only deals with already-validated data.
  const { data: page, error: pageErr } = await supabase
    .from('action_pages')
    .select('id, title, description, slug, cta_label, signing_secret, status')
    .eq('id', actionPageId)
    .eq('user_id', userId)
    .maybeSingle<{
      id: string
      title: string
      description: string | null
      slug: string
      cta_label: string | null
      signing_secret: string
      status: string
    }>()
  if (pageErr) throw new Error(`sendActionPageAsOperator: ${pageErr.message}`)
  if (!page) throw new Error('sendActionPageAsOperator: action page not found')
  if (page.status !== 'published') {
    throw new Error('sendActionPageAsOperator: action page is not published')
  }

  await dispatchOperatorSend({
    context: 'sendActionPageAsOperator',
    leadId,
    build: (thread) => {
      const exp = Math.floor(Date.now() / 1000) + DEEPLINK_TTL_SECONDS
      const url = deeplinkActionPageUrl(page.signing_secret, {
        slug: page.slug,
        psid: thread.psid,
        pageId: thread.page_id,
        exp,
      })
      const text = [page.title, page.description?.trim()].filter(Boolean).join('\n\n').slice(0, 640)
      const ctaLabel = (page.cta_label?.trim() || 'Open').slice(0, 20)
      return {
        payload: { kind: 'button', text: text || page.title, url, ctaLabel },
        body: page.title,
        attachments: [{ type: 'action_page', action_page_id: page.id, url, name: page.title }],
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Operator-triggered attachment send (image / video / audio / file)
// ---------------------------------------------------------------------------
const MEDIA_URL_TTL_SECONDS = 60 * 60 // 1h — Meta caches via is_reusable

export type AttachmentSendInput =
  | { source: 'upload'; attachmentType: MessengerAttachmentType; url: string; name?: string }
  | { source: 'asset'; attachmentType: MessengerAttachmentType; assetId: string }
  | { source: 'url'; attachmentType: MessengerAttachmentType; url: string }

function assertHttpsUrl(raw: string, context: string): string {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`${context}: invalid URL`)
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`${context}: only https URLs are allowed`)
  }
  return parsed.toString()
}

export async function sendAttachmentAsOperator(
  leadId: string,
  input: AttachmentSendInput,
): Promise<void> {
  const { supabase, userId } = await requireUser()
  const admin = createAdminClient()

  // Resolve a public URL for Meta to fetch, and the re-signable descriptor to
  // persist for timeline rendering.
  let url: string
  const attachment: OperatorAttachment = { type: input.attachmentType }

  if (input.source === 'url' || input.source === 'upload') {
    // Operator uploads now land on ImageKit and come back as permanent public
    // URLs, so they share the external-URL path: validate https and persist the
    // URL directly (nothing to re-sign on timeline load).
    url = assertHttpsUrl(input.url, 'sendAttachmentAsOperator')
    attachment.url = url
    if (input.source === 'upload' && input.name) attachment.name = input.name
  } else {
    const { data: asset } = await supabase
      .from('media_assets')
      .select('storage_path, is_archived')
      .eq('id', input.assetId)
      .eq('user_id', userId)
      .maybeSingle<{ storage_path: string; is_archived: boolean }>()
    if (!asset || asset.is_archived) {
      throw new Error('sendAttachmentAsOperator: media asset not found')
    }
    const { data: signed, error: signErr } = await admin.storage
      .from('media-assets')
      .createSignedUrl(asset.storage_path, MEDIA_URL_TTL_SECONDS)
    if (signErr || !signed?.signedUrl) {
      throw new Error('sendAttachmentAsOperator: could not sign media asset')
    }
    url = signed.signedUrl
    attachment.media_asset_id = input.assetId
    attachment.storage_path = asset.storage_path
  }

  const payload: OutboundPayload =
    input.attachmentType === 'image'
      ? { kind: 'image', imageUrl: url }
      : { kind: input.attachmentType, url }
  const body = attachment.name ? `[${input.attachmentType}] ${attachment.name}` : `[${input.attachmentType}]`

  await dispatchOperatorSend({
    context: 'sendAttachmentAsOperator',
    leadId,
    build: () => ({ payload, body, attachments: [attachment] }),
  })
}

export async function resumeBot(leadId: string): Promise<void> {
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from('messenger_threads')
    .update({ bot_paused_until: null })
    .eq('lead_id', leadId)
  if (error) throw new Error(`resumeBot: ${error.message}`)
  revalidatePath('/dashboard/leads', 'layout')
}
