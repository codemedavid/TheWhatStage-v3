const GRAPH = 'https://graph.facebook.com/v24.0'

const SUBSCRIBED_FIELDS = [
  'messages',
  'messaging_postbacks',
  'message_deliveries',
  'message_reads',
  'feed',
  // Required for utility-message template approval/rejection events from Meta.
  'message_template_status_update',
  // Required for human-takeover detection: page-admin replies from Page
  // Inbox / Business Suite / the Messenger app only reach us as echoes.
  'message_echoes',
].join(',')

// Retry transient Graph failures (429 throttling, 5xx) before bubbling up to
// the worker. The worker has its own rate-limit-aware requeue path, so these
// inline retries exist purely to absorb short blips without burning a job
// attempt. Cap retries low — a sustained 429 should still surface so the
// outer requeue with longer backoff can take over.
const GRAPH_MAX_RETRIES = 2
const GRAPH_BASE_DELAY_MS = 500

// Hard ceilings so a hung socket can't pin a worker slot indefinitely —
// undici (native fetch) has NO default timeout. Sends get a longer budget
// than the lightweight profile/typing reads. Mirrors capi.ts NETWORK_TIMEOUT_MS.
// On timeout, AbortSignal.timeout throws → the call fails fast → the worker's
// outer retry requeues with backoff instead of the whole batch stalling.
//
// TRADEOFF (sends have no Graph idempotency key): if Graph actually DELIVERED a
// message but its RESPONSE was slow, an abort here makes the worker retry and
// re-send (duplicate). We size SEND_TIMEOUT well above Graph's typical sub-2s
// response (and near its own ~30s server ceiling) so an abort almost always
// means a genuinely hung connection that never delivered — making the duplicate
// path vanishingly rare while still bounding a truly stuck send. READ ops
// (profile/typing) are idempotent, so they keep the tighter budget.
const SEND_TIMEOUT_MS = 30_000
const READ_TIMEOUT_MS = 8_000

function shouldRetryGraph(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600)
}

// Pull Graph's structured error code out of a response body. Graph reports
// throttling via error.code (4/17/32 = app/user/page request limit reached,
// 613 = calls exceeded the rate limit) — sometimes on HTTP 400 or even 200,
// which a status-only check misses. We surface the code in the thrown message
// so the worker's isRateLimitError can route true throttles to long backoff.
function parseGraphErrorCode(text: string): number | null {
  try {
    const j = JSON.parse(text) as { error?: { code?: unknown } }
    const code = j?.error?.code
    return typeof code === 'number' ? code : null
  } catch {
    return null
  }
}

function graphError(status: number, text: string): Error {
  const code = parseGraphErrorCode(text)
  return new Error(`Graph ${status}${code !== null ? ` (code ${code})` : ''}: ${text}`)
}

function graphRetryDelayMs(attempt: number, retryAfter: string | null): number {
  if (retryAfter) {
    const secs = Number(retryAfter)
    if (Number.isFinite(secs) && secs > 0) return Math.min(secs * 1000, 10_000)
  }
  const base = GRAPH_BASE_DELAY_MS * Math.pow(3, attempt)
  const jitter = base * (Math.random() * 0.5 - 0.25)
  return Math.floor(base + jitter)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  let lastStatus = 0
  let lastText = ''
  for (let attempt = 0; attempt <= GRAPH_MAX_RETRIES; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
    const text = await res.text()
    if (res.ok) {
      const parsed = JSON.parse(text) as T & { error?: unknown }
      // Graph occasionally returns 200 with an { error } envelope for some
      // throttles. Treat that as a failure so the worker can requeue.
      if (!parsed || typeof parsed !== 'object' || !('error' in parsed)) {
        return parsed as T
      }
      lastStatus = 200
      lastText = text
    } else {
      lastStatus = res.status
      lastText = text
    }
    if (attempt < GRAPH_MAX_RETRIES && shouldRetryGraph(lastStatus)) {
      await sleep(graphRetryDelayMs(attempt, res.headers.get('retry-after')))
      continue
    }
    break
  }
  throw graphError(lastStatus, lastText)
}

async function getJson<T>(url: string): Promise<T> {
  let lastStatus = 0
  let lastText = ''
  for (let attempt = 0; attempt <= GRAPH_MAX_RETRIES; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) })
    const text = await res.text()
    if (res.ok) return JSON.parse(text) as T
    lastStatus = res.status
    lastText = text
    if (attempt < GRAPH_MAX_RETRIES && shouldRetryGraph(res.status)) {
      await sleep(graphRetryDelayMs(attempt, res.headers.get('retry-after')))
      continue
    }
    break
  }
  throw graphError(lastStatus, lastText)
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

export type MessengerGenericButton =
  | { title: string; url: string }
  | { title: string; postback: string }

export interface MessengerGenericElement {
  title: string
  subtitle?: string
  imageUrl?: string
  defaultActionUrl?: string
  buttons?: MessengerGenericButton[]
}

/**
 * Send a Messenger generic-template carousel (horizontally scrollable cards).
 * Up to 10 elements; each element supports an image, title (80c), subtitle
 * (80c), a default web_url tap target, and up to 3 buttons (titles trimmed
 * to 20c). Buttons are either URL (`web_url`) or postback. Used to surface
 * a product or property catalog inline in chat.
 */
export async function sendMessengerGenericTemplate(args: {
  pageAccessToken: string
  recipientPsid: string
  elements: MessengerGenericElement[]
}): Promise<{ message_id: string }> {
  const url = new URL(`${GRAPH}/me/messages`)
  url.searchParams.set('access_token', args.pageAccessToken)
  const elements = args.elements.slice(0, 10).map((el) => {
    const out: Record<string, unknown> = { title: el.title.slice(0, 80) }
    if (el.subtitle) out.subtitle = el.subtitle.slice(0, 80)
    if (el.imageUrl) out.image_url = el.imageUrl
    if (el.defaultActionUrl) {
      out.default_action = { type: 'web_url', url: el.defaultActionUrl }
    }
    if (el.buttons && el.buttons.length) {
      out.buttons = el.buttons.slice(0, 3).map((b) => {
        const title = b.title.slice(0, 20)
        if ('url' in b) return { type: 'web_url', url: b.url, title }
        return { type: 'postback', payload: b.postback, title }
      })
    }
    return out
  })
  return postJson<{ message_id: string }>(url.toString(), {
    recipient: { id: args.recipientPsid },
    messaging_type: 'RESPONSE',
    message: {
      attachment: {
        type: 'template',
        payload: { template_type: 'generic', elements },
      },
    },
  })
}

/**
 * Send an approved utility-message template via the Send API.
 *
 * An approved utility template reaches a recipient who hasn't messaged us in
 * the last 24h. It is sent with `messaging_type: 'UTILITY'` and the template
 * referenced under `message.template` (by name + language). This is the
 * documented Messenger Utility Messages shape, and it replaces the old
 * `messaging_type: 'MESSAGE_TAG'` + `tag: 'UTILITY_MESSAGE'` path — the Message
 * Tags feature is being removed by Meta globally (tags unavailable after
 * Feb 2026), so the tag approach no longer works.
 *
 * The body's `{{1}}, {{2}}, ...` placeholders are filled from `bodyParameters`
 * in order. `buttonUrlOverrides` supplies dynamic values for URL buttons.
 *
 * VERIFY-BEFORE-RELYING: the exact send wire shape was confirmed against Meta's
 * (JS-rendered) utility-messages docs via a text-render proxy, not a live call.
 * Validate with one real Graph send — especially the multi-button parameter
 * mapping, which Meta's Messenger docs do not spell out.
 */
export async function sendMessengerUtilityTemplate(args: {
  pageAccessToken: string
  recipientPsid: string
  templateName: string
  language: string
  bodyParameters: string[]
  buttonUrlOverrides?: Array<{ index: number; url: string }>
  // Deprecated/no-op: messaging_type='UTILITY' works both inside and outside
  // the 24h window, so the window no longer changes the send. Retained for
  // caller compatibility.
  insideWindow?: boolean
}): Promise<{ message_id: string }> {
  const url = new URL(`${GRAPH}/me/messages`)
  url.searchParams.set('access_token', args.pageAccessToken)

  // Body variables in {{1}}..{{n}} order.
  const components: Array<Record<string, unknown>> = [
    { type: 'body', parameters: args.bodyParameters.map((v) => ({ type: 'text', text: v })) },
  ]

  // Dynamic URL button overrides. Meta's Messenger utility send expresses these
  // as a SINGLE plural 'buttons' component whose parameters carry one entry per
  // dynamic button, in button order: { type:'URL', url } (or
  // { type:'POSTBACK', payload }). NOTE: positional mapping for templates with
  // multiple buttons is not clearly documented for Messenger — needs a live test.
  if (args.buttonUrlOverrides && args.buttonUrlOverrides.length > 0) {
    components.push({
      type: 'buttons',
      parameters: [...args.buttonUrlOverrides]
        .sort((a, b) => a.index - b.index)
        .map((ov) => ({ type: 'URL', url: ov.url })),
    })
  }

  const body: Record<string, unknown> = {
    recipient: { id: args.recipientPsid },
    messaging_type: 'UTILITY',
    message: {
      template: {
        name: args.templateName,
        language: { code: args.language },
        components,
      },
    },
  }
  return postJson<{ message_id: string }>(url.toString(), body)
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
