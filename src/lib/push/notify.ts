import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendExpoPush, type ExpoPushMessage } from './expo'

// Turns one inbound Messenger message into a push on every device the operator
// has signed in on. Called from the Facebook webhook behind `afterResponse`, so
// everything here is best-effort: a failure logs and returns, it never throws
// back into the inbound pipeline.

/** Notification bodies are clipped by the OS anyway; keep them short. */
export const PUSH_BODY_MAX = 140

/** Android channel created by the app at startup. Must match mobile/src/lib/push.ts. */
export const PUSH_CHANNEL_ID = 'messages'

export interface InboundPushInput {
  userId: string
  threadId: string
  leadId: string | null
  contactName: string | null
  /** Raw inbound text. Empty for an attachment-only message. */
  preview: string
}

export function pushTitle(contactName: string | null): string {
  const name = contactName?.trim()
  return name ? name : 'New message'
}

export function pushBody(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (!oneLine) return 'Sent an attachment'
  if (oneLine.length <= PUSH_BODY_MAX) return oneLine
  return `${oneLine.slice(0, PUSH_BODY_MAX)}…`
}

async function enabledTokens(admin: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await admin
    .from('push_devices')
    .select('token')
    .eq('user_id', userId)
    .eq('enabled', true)
  if (error) {
    console.warn('[push.notify] device lookup failed', error.message)
    return []
  }
  return ((data ?? []) as { token: string }[]).map((d) => d.token)
}

/** iOS app-icon badge: how many threads are currently unread. */
async function unreadBadge(admin: SupabaseClient, userId: string): Promise<number | undefined> {
  const { count, error } = await admin
    .from('messenger_threads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gt('unread_count', 0)
  if (error) return undefined
  return count ?? undefined
}

async function pruneDeadTokens(admin: SupabaseClient, tokens: string[]): Promise<void> {
  if (tokens.length === 0) return
  const { error } = await admin.from('push_devices').delete().in('token', tokens)
  if (error) console.warn('[push.notify] prune failed', error.message)
}

export async function notifyInboundMessage(
  admin: SupabaseClient,
  input: InboundPushInput,
): Promise<void> {
  try {
    const tokens = await enabledTokens(admin, input.userId)
    if (tokens.length === 0) return

    const badge = await unreadBadge(admin, input.userId)
    const messages: ExpoPushMessage[] = tokens.map((to) => ({
      to,
      title: pushTitle(input.contactName),
      body: pushBody(input.preview),
      sound: 'default',
      channelId: PUSH_CHANNEL_ID,
      ...(badge === undefined ? {} : { badge }),
      // The app routes on this: tapping opens /chat/<threadId>.
      data: {
        type: 'inbound_message',
        threadId: input.threadId,
        leadId: input.leadId,
      },
    }))

    const result = await sendExpoPush(messages)
    await pruneDeadTokens(admin, result.deadTokens)
  } catch (err) {
    console.error('[push.notify] failed', err)
  }
}
