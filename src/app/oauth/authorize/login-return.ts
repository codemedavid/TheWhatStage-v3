import type { RawAuthorizeParams } from '@/lib/oauth/authorize-request'

// Where to send a signed-out visitor so they land back on this exact
// authorize request after logging in.
export function loginUrlForAuthorize(raw: RawAuthorizeParams): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') qs.set(k, v)
  }
  return `/login?next=${encodeURIComponent(`/oauth/authorize?${qs.toString()}`)}`
}
