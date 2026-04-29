import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const TEN_MINUTES_MS = 10 * 60 * 1000

type Payload = { u: string; n: string; t: number }

function secret(): string {
  const s = process.env.FB_APP_SECRET
  if (!s) throw new Error('FB_APP_SECRET is required')
  return s
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

function sign(body: string): string {
  return b64url(createHmac('sha256', secret()).update(body).digest())
}

export function signState(userId: string): string {
  const payload: Payload = { u: userId, n: b64url(randomBytes(16)), t: Date.now() }
  const body = b64url(Buffer.from(JSON.stringify(payload)))
  return `${body}.${sign(body)}`
}

export function verifyState(raw: string, expectedUserId: string): boolean {
  const dot = raw.indexOf('.')
  if (dot < 0) return false
  const body = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  const expected = sign(body)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false
  let payload: Payload
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8'))
  } catch {
    return false
  }
  if (payload.u !== expectedUserId) return false
  if (Date.now() - payload.t > TEN_MINUTES_MS) return false
  return true
}
