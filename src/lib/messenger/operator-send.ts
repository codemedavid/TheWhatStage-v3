import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptToken } from '@/lib/facebook/crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendOutbound, type OutboundPayload } from '@/lib/messenger/outbound'
import { deeplinkActionPageUrl } from '@/lib/action-pages/urls'
import type { MessengerAttachmentType } from '@/lib/facebook/messenger'

// Operator-initiated sends shared by the dashboard (cookie session) and the
// MCP server (API key). Every function takes an explicit client + owner id.
// Callers own cache revalidation.

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

export interface OperatorThread {
  id: string
  psid: string
  page_id: string
}

export interface OperatorSendSpec {
  payload: OutboundPayload
  body: string
  attachments?: OperatorAttachment[]
}

/**
 * Outcome of an operator-initiated send. A `policy_blocked:*` or FB API failure
 * is an EXPECTED, already-persisted result (the failed message row carries the
 * machine-readable error and is shown inline in the thread), so it is returned
 * as `{ ok: false }` rather than thrown. Genuine infrastructure failures (no
 * thread, missing page token, DB errors) still throw.
 */
export type SendResult = { ok: true } | { ok: false; error: string }

const WORKFLOW_RESUME_MS = 24 * 60 * 60 * 1000

/**
 * Shared dispatch for every operator-initiated send (text, action page, media).
 * Fetches the thread + page token, sends via the unified outbound pipeline
 * (HUMAN_AGENT policy), persists an audit row, stamps the bot-pause window, and
 * releases any workflow run lock — identical side effects regardless of payload.
 */
export async function dispatchOperatorSendFor(args: {
  supabase: SupabaseClient
  userId: string
  context: string
  leadId: string
  build: (thread: OperatorThread) => OperatorSendSpec | Promise<OperatorSendSpec>
}): Promise<SendResult> {
  const { supabase, userId, context, leadId, build } = args

  const { data: thread, error: threadErr } = await supabase
    .from('messenger_threads')
    .select('id, psid, page_id, last_inbound_at, controlled_by_run_id, facebook_pages(page_access_token)')
    .eq('lead_id', leadId)
    .eq('user_id', userId)
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

  if (sendError) return { ok: false, error: sendError }

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
    const resumeAt = new Date(Date.now() + WORKFLOW_RESUME_MS).toISOString()

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

  return { ok: true }
}

export async function replyAsOperatorFor(
  supabase: SupabaseClient,
  userId: string,
  leadId: string,
  text: string,
): Promise<SendResult> {
  const body = text.trim()
  if (!body) return { ok: true }
  return dispatchOperatorSendFor({
    supabase,
    userId,
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
  description: string | null
  cta_label: string | null
}

/**
 * Published action pages the operator can send into a conversation. Drafts and
 * archived pages are excluded so unfinished pages never reach a lead.
 */
export async function listSendableActionPagesFor(
  supabase: SupabaseClient,
  userId: string,
): Promise<SendableActionPage[]> {
  const { data, error } = await supabase
    .from('action_pages')
    .select('id, title, kind, description, cta_label')
    .eq('user_id', userId)
    .eq('status', 'published')
    .order('updated_at', { ascending: false })
  if (error) throw new Error(`listSendableActionPages: ${error.message}`)
  return (data ?? []) as SendableActionPage[]
}

// Meta limits: button text ≤ 640 chars, button label ≤ 20 chars.
const ACTION_PAGE_TEXT_MAX = 640
const ACTION_PAGE_CTA_MAX = 20

/**
 * Per-send overrides for the message body and CTA label. Both are optional —
 * when omitted (or blank after trimming) the action page's saved defaults are
 * used. These never mutate the saved action_pages record.
 */
export interface ActionPageSendOverrides {
  messageText?: string
  ctaLabel?: string
}

const actionPageOverridesSchema = z.object({
  messageText: z.string().trim().min(1).max(ACTION_PAGE_TEXT_MAX).optional(),
  ctaLabel: z.string().trim().min(1).max(ACTION_PAGE_CTA_MAX).optional(),
})

export async function sendActionPageFor(
  supabase: SupabaseClient,
  userId: string,
  leadId: string,
  actionPageId: string,
  overrides?: ActionPageSendOverrides,
): Promise<SendResult> {
  // Validate per-send overrides at the boundary. Invalid/blank values fall back
  // to the saved defaults rather than blocking the send.
  const parsed = actionPageOverridesSchema.safeParse(overrides ?? {})
  const overrideText = parsed.success ? parsed.data.messageText : undefined
  const overrideCta = parsed.success ? parsed.data.ctaLabel : undefined

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

  return dispatchOperatorSendFor({
    supabase,
    userId,
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
      const defaultText = [page.title, page.description?.trim()].filter(Boolean).join('\n\n')
      const text = (overrideText ?? defaultText).slice(0, ACTION_PAGE_TEXT_MAX)
      const ctaLabel = (overrideCta || page.cta_label?.trim() || 'Open').slice(0, ACTION_PAGE_CTA_MAX)
      // History preview + attachment name reflect what was actually sent.
      const body = text || page.title
      return {
        payload: { kind: 'button', text: body, url, ctaLabel },
        body,
        attachments: [{ type: 'action_page', action_page_id: page.id, url, name: body }],
      }
    },
  })
}
