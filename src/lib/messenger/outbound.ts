import { createAdminClient } from '@/lib/supabase/admin'
import {
  sendMessengerButton,
  sendMessengerGenericTemplate,
  sendMessengerImage,
  sendMessengerText,
  type MessengerGenericElement,
} from '@/lib/facebook/messenger'

type AdminClient = ReturnType<typeof createAdminClient>

// ---------------------------------------------------------------------------
// Public payload shapes — callers pick one kind and fill its fields.
// ---------------------------------------------------------------------------
export type OutboundPayload =
  | { kind: 'text'; text: string }
  | { kind: 'button'; text: string; url: string; ctaLabel: string }
  | { kind: 'image'; imageUrl: string }
  | { kind: 'generic_template'; elements: MessengerGenericElement[] }

// 'bot'                   — automated reply inside a job worker (24h window only)
// 'operator'              — manual send from the dashboard inbox (HUMAN_AGENT 7d window)
// 'submission_echo'       — confirmation message after action-page submit
// 'workflow_human_agent'  — workflow send that may use HUMAN_AGENT tag outside 24h.
//                           Use only for human-reviewable / human-staged messages
//                           (Meta requires a human in the loop for HUMAN_AGENT).
export type SendKind = 'bot' | 'operator' | 'submission_echo' | 'workflow_human_agent'

// ---------------------------------------------------------------------------
// Channel-policy resolution
// ---------------------------------------------------------------------------
export type SendPolicy =
  | { mode: 'RESPONSE' }
  | { mode: 'HUMAN_AGENT' }
  | { mode: 'MARKETING_MESSAGE' }
  | { mode: 'OTN'; token: string }
  | { mode: 'paused'; reason: 'window' | 'optin' | 'otn' }

const WINDOW_MS = 24 * 60 * 60 * 1000

function isInsideWindow(lastInboundAt: string | null): boolean {
  if (!lastInboundAt) return false
  return Date.now() - new Date(lastInboundAt).getTime() < WINDOW_MS
}

// Exported so callers (e.g. the workflow executor in Step 2) can inspect the
// policy without committing to a send.
export async function resolveSendPolicy(
  admin: AdminClient,
  threadId: string,
  lastInboundAt: string | null,
  kind: SendKind,
): Promise<SendPolicy> {
  if (isInsideWindow(lastInboundAt)) return { mode: 'RESPONSE' }

  // Operators can always send — HUMAN_AGENT tag gives a 7-day window for
  // manually-initiated messages. This path is never available to bots.
  if (kind === 'operator') return { mode: 'HUMAN_AGENT' }

  // Workflows opted into "human agent default" piggyback the same 7-day tag.
  // Caller should keep these messages reviewable — Meta policy requires a real
  // human in the loop for HUMAN_AGENT.
  if (kind === 'workflow_human_agent') return { mode: 'HUMAN_AGENT' }

  // Outside 24h for bot / submission_echo: check marketing opt-in.
  const { data: optin } = await admin
    .from('messenger_marketing_optins')
    .select('opted_out_at')
    .eq('thread_id', threadId)
    .maybeSingle()

  if (optin && !optin.opted_out_at) return { mode: 'MARKETING_MESSAGE' }

  // Check for an unconsumed, non-expired OTN token on this thread.
  const now = new Date().toISOString()
  const { data: otn } = await admin
    .from('messenger_otn_tokens')
    .select('token')
    .eq('thread_id', threadId)
    .is('consumed_at', null)
    .or(`expires_at.is.null,expires_at.gt.${now}`)
    .order('requested_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (otn) return { mode: 'OTN', token: otn.token }

  return { mode: 'paused', reason: 'window' }
}

// ---------------------------------------------------------------------------
// Unified outbound send
// ---------------------------------------------------------------------------
export type OutboundResult =
  | { sent: true; messageId: string }
  | { sent: false; reason: string }

export async function sendOutbound(args: {
  admin: AdminClient
  thread: {
    id: string
    psid: string
    last_inbound_at: string | null
  }
  pageToken: string
  payload: OutboundPayload
  kind: SendKind
}): Promise<OutboundResult> {
  const { admin, thread, pageToken, payload, kind } = args

  const policy = await resolveSendPolicy(admin, thread.id, thread.last_inbound_at, kind)

  if (policy.mode === 'paused') {
    console.warn('[outbound] send blocked by channel policy', {
      threadId: thread.id,
      reason: policy.reason,
      kind,
    })
    return { sent: false, reason: policy.reason }
  }

  // MARKETING_MESSAGE: Meta requires Business-level registration for this API.
  // Until that is wired up, block the send so we never spam leads.
  // The preview UI already shows these rows as "paused:optin" — this guard
  // is a belt-and-braces check at dispatch time.
  if (policy.mode === 'MARKETING_MESSAGE') {
    console.warn('[outbound] MARKETING_MESSAGE blocked — Meta registration not yet wired', {
      threadId: thread.id,
    })
    return { sent: false, reason: 'marketing_blocked' }
  }

  // OTN: consume the token — mark it as used so it cannot be spent twice.
  if (policy.mode === 'OTN') {
    await admin
      .from('messenger_otn_tokens')
      .update({ consumed_at: new Date().toISOString() })
      .eq('thread_id', thread.id)
      .is('consumed_at', null)
      .order('requested_at', { ascending: true })
      .limit(1)
  }

  // Determine the messaging_type to use. HUMAN_AGENT requires MESSAGE_TAG + tag field.
  const useHumanAgent = policy.mode === 'HUMAN_AGENT'

  let messageId: string

  if (payload.kind === 'text') {
    const result = await sendMessengerText({
      pageAccessToken: pageToken,
      recipientPsid: thread.psid,
      text: payload.text,
      ...(useHumanAgent ? { messagingType: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' } : {}),
    })
    messageId = result.message_id
  } else if (payload.kind === 'button') {
    const result = await sendMessengerButton({
      pageAccessToken: pageToken,
      recipientPsid: thread.psid,
      text: payload.text,
      url: payload.url,
      ctaLabel: payload.ctaLabel,
    })
    messageId = result.message_id
  } else if (payload.kind === 'generic_template') {
    const result = await sendMessengerGenericTemplate({
      pageAccessToken: pageToken,
      recipientPsid: thread.psid,
      elements: payload.elements,
    })
    messageId = result.message_id
  } else {
    const result = await sendMessengerImage({
      pageAccessToken: pageToken,
      recipientPsid: thread.psid,
      imageUrl: payload.imageUrl,
    })
    messageId = result.message_id
  }

  await admin
    .from('messenger_threads')
    .update({ last_outbound_at: new Date().toISOString() })
    .eq('id', thread.id)

  return { sent: true, messageId }
}
