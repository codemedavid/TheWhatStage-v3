import 'server-only'

// Thin client for Expo's push service (https://docs.expo.dev/push-notifications/sending-notifications/).
//
// We post to Expo rather than APNs/FCM directly: the Expo token abstracts both
// stores, and credentials live in the EAS project instead of this repo. The
// only thing we must handle ourselves is pruning — Expo answers with
// `DeviceNotRegistered` for an uninstalled app, and a token that keeps getting
// that is dead weight on every later send.

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'

/** Expo rejects a request carrying more than 100 messages. */
export const EXPO_PUSH_CHUNK = 100

export interface ExpoPushMessage {
  /** The recipient's Expo push token (`ExponentPushToken[...]`). */
  to: string
  title: string
  body: string
  /** Delivered to the app as `notification.request.content.data`. */
  data?: Record<string, unknown>
  /** iOS app-icon badge. Omit to leave the badge untouched. */
  badge?: number
  sound?: 'default' | null
  /** Android channel; must already exist on the device or delivery is silent. */
  channelId?: string
}

export interface ExpoPushResult {
  sent: number
  failed: number
  /** Tokens Expo says are gone for good. Delete them. */
  deadTokens: string[]
}

interface ExpoTicket {
  status?: string
  message?: string
  details?: { error?: string }
}

const DEAD_TOKEN_ERROR = 'DeviceNotRegistered'

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function headers(): Record<string, string> {
  const base: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
  }
  // Only needed when the Expo account has "enhanced security for push" on.
  const accessToken = process.env.EXPO_ACCESS_TOKEN
  if (accessToken) base.authorization = `Bearer ${accessToken}`
  return base
}

async function sendChunk(messages: ExpoPushMessage[]): Promise<ExpoPushResult> {
  let res: Response
  try {
    res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(messages),
    })
  } catch (err) {
    // Network failure. Nothing to prune — the tokens may be perfectly fine.
    console.error('[push.expo] request failed', err)
    return { sent: 0, failed: messages.length, deadTokens: [] }
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    console.error(`[push.expo] ${res.status} from Expo`, detail.slice(0, 500))
    return { sent: 0, failed: messages.length, deadTokens: [] }
  }

  const body = (await res.json().catch(() => null)) as { data?: ExpoTicket[] } | null
  const tickets = body?.data
  if (!Array.isArray(tickets)) {
    console.error('[push.expo] unexpected response shape', body)
    return { sent: 0, failed: messages.length, deadTokens: [] }
  }

  // Tickets come back positionally, so ticket[i] belongs to messages[i].
  let sent = 0
  let failed = 0
  const deadTokens: string[] = []
  tickets.forEach((ticket, i) => {
    if (ticket?.status === 'ok') {
      sent += 1
      return
    }
    failed += 1
    const token = messages[i]?.to
    if (ticket?.details?.error === DEAD_TOKEN_ERROR && token) deadTokens.push(token)
    else console.warn('[push.expo] ticket error', ticket?.details?.error ?? ticket?.message)
  })
  return { sent, failed, deadTokens }
}

/**
 * Deliver every message, one request per 100. A failing chunk is logged and
 * counted, never thrown: push is best-effort bookkeeping that runs behind an
 * already-committed response, so one bad batch must not lose the rest.
 */
export async function sendExpoPush(messages: readonly ExpoPushMessage[]): Promise<ExpoPushResult> {
  if (messages.length === 0) return { sent: 0, failed: 0, deadTokens: [] }

  const results = await Promise.all(chunk(messages, EXPO_PUSH_CHUNK).map(sendChunk))
  return results.reduce<ExpoPushResult>(
    (acc, r) => ({
      sent: acc.sent + r.sent,
      failed: acc.failed + r.failed,
      deadTokens: [...acc.deadTokens, ...r.deadTokens],
    }),
    { sent: 0, failed: 0, deadTokens: [] },
  )
}
