import { createHash } from 'node:crypto'

// RFC 7636 verifier alphabet, 43-128 chars.
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/

export function isValidCodeVerifier(verifier: string): boolean {
  return VERIFIER_RE.test(verifier)
}

export function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

// OAuth 2.1 mandates PKCE with S256; "plain" is deliberately not accepted.
export function verifyPkceS256(verifier: string, expectedChallenge: string): boolean {
  if (!isValidCodeVerifier(verifier)) return false
  return s256Challenge(verifier) === expectedChallenge
}
