import { createHmac, timingSafeEqual } from 'node:crypto'

export interface DeeplinkClaims {
  slug: string
  psid: string
  pageId: string
  exp: number
}

function b64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input) : input
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function sign(secret: string, payload: string): string {
  return b64url(createHmac('sha256', secret).update(payload).digest())
}

function payloadString(claims: DeeplinkClaims): string {
  return [claims.slug, claims.psid, claims.pageId, String(claims.exp)].join('|')
}

export function signDeeplink(secret: string, claims: DeeplinkClaims): string {
  return sign(secret, payloadString(claims))
}

/**
 * Build the query-string params for a public action-page URL with a verified
 * PSID + page id deeplink. Use from the chatbot when generating a Messenger
 * Button Template so submissions can be attributed back to the lead.
 */
export function buildDeeplinkParams(
  secret: string,
  claims: DeeplinkClaims,
): URLSearchParams {
  const sp = new URLSearchParams()
  sp.set('p', claims.psid)
  sp.set('g', claims.pageId)
  sp.set('e', String(claims.exp))
  sp.set('t', signDeeplink(secret, claims))
  return sp
}

export interface VerifyResult {
  ok: boolean
  reason?: 'missing' | 'expired' | 'bad_signature'
  claims?: DeeplinkClaims
}

/**
 * Verify a signed deeplink. Returns ok:true only when all four params
 * (p, g, e, t) are present, the HMAC matches the page's signing_secret,
 * and the expiration is in the future.
 *
 * Pass nowMs to override the clock in tests.
 */
export function verifyDeeplink(
  secret: string,
  slug: string,
  params: URLSearchParams | { p?: string; g?: string; e?: string; t?: string },
  nowMs: number = Date.now(),
): VerifyResult {
  const get = (k: 'p' | 'g' | 'e' | 't') =>
    params instanceof URLSearchParams ? params.get(k) : (params[k] ?? null)

  const psid = get('p')
  const pageId = get('g')
  const expRaw = get('e')
  const token = get('t')
  if (!psid || !pageId || !expRaw || !token) return { ok: false, reason: 'missing' }

  const exp = Number(expRaw)
  if (!Number.isFinite(exp)) return { ok: false, reason: 'missing' }
  if (exp * 1000 < nowMs) return { ok: false, reason: 'expired' }

  const expected = sign(secret, payloadString({ slug, psid, pageId, exp }))
  const a = Buffer.from(token)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad_signature' }
  }

  return { ok: true, claims: { slug, psid, pageId, exp } }
}
