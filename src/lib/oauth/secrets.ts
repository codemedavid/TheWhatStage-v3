import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

// Prefixes make each secret recognisable to humans and secret scanners and
// let the bearer resolver route a token without a database round-trip.
export const ACCESS_TOKEN_PREFIX = 'wsa_'
export const REFRESH_TOKEN_PREFIX = 'wsr_'
export const AUTH_CODE_PREFIX = 'wsc_'
export const CLIENT_ID_PREFIX = 'wscl_'
export const CLIENT_SECRET_PREFIX = 'wscs_'

const SECRET_BYTES = 32
const CLIENT_ID_BYTES = 16

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function randomSecret(prefix: string, bytes: number = SECRET_BYTES): string {
  return prefix + randomBytes(bytes).toString('base64url')
}

export function randomClientId(): string {
  return CLIENT_ID_PREFIX + randomBytes(CLIENT_ID_BYTES).toString('hex')
}

// Constant-time comparison of two hex digests of equal length.
export function digestsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}
