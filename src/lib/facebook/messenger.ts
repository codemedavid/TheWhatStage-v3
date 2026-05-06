const GRAPH = 'https://graph.facebook.com/v19.0'

const SUBSCRIBED_FIELDS = [
  'messages',
  'messaging_postbacks',
  'message_deliveries',
  'message_reads',
  'feed',
].join(',')

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Graph ${res.status}: ${text}`)
  return JSON.parse(text) as T
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Graph ${res.status}: ${await res.text()}`)
  return (await res.json()) as T
}

/**
 * Subscribe an app to a page's webhook events. Required before Messenger
 * messages will reach our webhook endpoint. Idempotent — safe to call again
 * on every save.
 */
export async function subscribePageToWebhook(pageAccessToken: string): Promise<void> {
  const url = new URL(`${GRAPH}/me/subscribed_apps`)
  url.searchParams.set('access_token', pageAccessToken)
  url.searchParams.set('subscribed_fields', SUBSCRIBED_FIELDS)
  await postJson<{ success: boolean }>(url.toString(), {})
}

/**
 * Send a plain-text reply via the Send API.
 * Uses MESSAGE_TAG when outside the standard messaging window — for v1 we
 * stay inside the 24h window so RESPONSE messaging_type is sufficient.
 */
export async function sendMessengerText(args: {
  pageAccessToken: string
  recipientPsid: string
  text: string
  messagingType?: 'RESPONSE' | 'UPDATE' | 'MESSAGE_TAG'
  tag?: 'HUMAN_AGENT'
}): Promise<{ message_id: string }> {
  const url = new URL(`${GRAPH}/me/messages`)
  url.searchParams.set('access_token', args.pageAccessToken)
  const body: Record<string, unknown> = {
    recipient: { id: args.recipientPsid },
    message: { text: args.text },
    messaging_type: args.messagingType ?? 'RESPONSE',
  }
  if (args.tag) body.tag = args.tag
  return postJson<{ message_id: string }>(url.toString(), body)
}

/**
 * Send a Messenger button-template message — a one-line text plus a single
 * URL button. Used by the bot to surface action pages with a CTA.
 *
 * `cta_label` is hard-trimmed to 20 chars (Messenger button title limit) and
 * `text` is trimmed to 640 chars (template body limit).
 */
export async function sendMessengerButton(args: {
  pageAccessToken: string
  recipientPsid: string
  text: string
  url: string
  ctaLabel: string
}): Promise<{ message_id: string }> {
  const url = new URL(`${GRAPH}/me/messages`)
  url.searchParams.set('access_token', args.pageAccessToken)
  return postJson<{ message_id: string }>(url.toString(), {
    recipient: { id: args.recipientPsid },
    messaging_type: 'RESPONSE',
    message: {
      attachment: {
        type: 'template',
        payload: {
          template_type: 'button',
          text: args.text.slice(0, 640),
          buttons: [
            {
              type: 'web_url',
              url: args.url,
              title: args.ctaLabel.slice(0, 20),
            },
          ],
        },
      },
    },
  })
}

/**
 * Send a sender_action signal — typing_on/typing_off/mark_seen.
 * typing_on shows the typing bubble for ~20s or until the next message is
 * sent (whichever comes first), so an explicit typing_off is rarely needed.
 */
export async function sendMessengerSenderAction(args: {
  pageAccessToken: string
  recipientPsid: string
  action: 'typing_on' | 'typing_off' | 'mark_seen'
}): Promise<void> {
  const url = new URL(`${GRAPH}/me/messages`)
  url.searchParams.set('access_token', args.pageAccessToken)
  await postJson<{ recipient_id?: string }>(url.toString(), {
    recipient: { id: args.recipientPsid },
    sender_action: args.action,
  })
}

/**
 * React to an inbound user message as the Page (Messenger Page Reactions).
 * Best-effort: not every page/app has this enabled — caller should swallow
 * errors so a failed reaction never blocks the actual reply.
 */
export async function sendMessengerReaction(args: {
  pageAccessToken: string
  recipientPsid: string
  messageId: string
  reaction?: 'smile' | 'angry' | 'sad' | 'wow' | 'love' | 'like' | 'dislike'
}): Promise<void> {
  const url = new URL(`${GRAPH}/me/messages`)
  url.searchParams.set('access_token', args.pageAccessToken)
  await postJson<{ recipient_id?: string }>(url.toString(), {
    recipient: { id: args.recipientPsid },
    sender_action: 'react',
    payload: {
      message_id: args.messageId,
      reaction: args.reaction ?? 'like',
    },
  })
}

export async function sendMessengerImage(args: {
  pageAccessToken: string
  recipientPsid: string
  imageUrl: string
}): Promise<{ message_id: string }> {
  const url = new URL(`${GRAPH}/me/messages`)
  url.searchParams.set('access_token', args.pageAccessToken)
  return postJson<{ message_id: string }>(url.toString(), {
    recipient: { id: args.recipientPsid },
    messaging_type: 'RESPONSE',
    message: {
      attachment: {
        type: 'image',
        payload: {
          url: args.imageUrl,
          is_reusable: true,
        },
      },
    },
  })
}

export interface MessengerProfile {
  firstName: string | null
  lastName: string | null
  fullName: string
  pictureUrl: string | null
}

/**
 * Resolve the display name a Page sees for a PSID by reading the
 * conversation participants. This works in dev mode without the User Profile
 * API restrictions because the page already has access to its own threads.
 */
async function fetchNameFromConversations(args: {
  pageAccessToken: string
  psid: string
}): Promise<string | null> {
  const url = new URL(`${GRAPH}/me/conversations`)
  url.searchParams.set('user_id', args.psid)
  url.searchParams.set('fields', 'participants')
  url.searchParams.set('access_token', args.pageAccessToken)
  try {
    const data = await getJson<{
      data?: Array<{
        participants?: { data?: Array<{ id?: string; name?: string }> }
      }>
    }>(url.toString())
    for (const conv of data.data ?? []) {
      for (const p of conv.participants?.data ?? []) {
        if (p.id === args.psid && p.name && p.name.trim()) {
          return p.name.trim()
        }
      }
    }
    return null
  } catch (e) {
    console.warn('[fb.profile] conversations lookup failed', {
      psid: args.psid,
      err: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}

/**
 * Best-effort profile lookup for a Messenger PSID.
 *
 * Order of preference:
 *   1. Conversations API → returns the display name the Page already has
 *      access to (works for any user who messaged the page, no App Review).
 *   2. User Profile API (PSID lookup) → returns first/last name + profile
 *      picture, but in dev mode only works for app testers/admins.
 *
 * The picture comes only from the User Profile API; if that's blocked we
 * leave it null and the dashboard falls back to initials.
 */
export async function fetchMessengerProfile(args: {
  pageAccessToken: string
  psid: string
}): Promise<MessengerProfile> {
  const conversationsName = await fetchNameFromConversations(args)

  const url = new URL(`${GRAPH}/${encodeURIComponent(args.psid)}`)
  url.searchParams.set('fields', 'name,first_name,last_name,profile_pic')
  url.searchParams.set('access_token', args.pageAccessToken)

  let first: string | null = null
  let last: string | null = null
  let pictureUrl: string | null = null
  let profileName: string | null = null

  try {
    const data = await getJson<{
      name?: string
      first_name?: string
      last_name?: string
      profile_pic?: string
    }>(url.toString())
    first = data.first_name?.trim() || null
    last = data.last_name?.trim() || null
    profileName = data.name?.trim() || null
    pictureUrl = data.profile_pic ?? null
  } catch (e) {
    console.warn('[fb.profile] PSID lookup failed', {
      psid: args.psid,
      err: e instanceof Error ? e.message : String(e),
    })
  }

  const composite = [first, last].filter(Boolean).join(' ').trim()
  const fullName =
    conversationsName ||
    composite ||
    profileName ||
    `Messenger user ${args.psid.slice(-4)}`

  console.log('[fb.profile] resolved', {
    psid: args.psid,
    via: conversationsName
      ? 'conversations'
      : composite
        ? 'profile_first_last'
        : profileName
          ? 'profile_name'
          : 'fallback',
    hasPic: !!pictureUrl,
  })

  return { firstName: first, lastName: last, fullName, pictureUrl }
}
