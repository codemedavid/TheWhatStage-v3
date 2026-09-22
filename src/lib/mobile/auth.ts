import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAccountStatus } from '@/lib/auth/account-status'

// Bearer-token auth for the /api/mobile/* routes.
//
// The dashboard's API routes read the Supabase session from cookies, which a
// native app never has. The Expo client instead sends its Supabase access
// token as `Authorization: Bearer <jwt>`; we verify it with the admin client
// (auth.getUser(token) validates signature + expiry against GoTrue) and apply
// the same profiles.status gate as src/lib/auth/get-session.ts.

export type MobilePrincipal = {
  userId: string
  email: string
  admin: ReturnType<typeof createAdminClient>
}

export class MobileAuthError extends Error {
  constructor(readonly status: 401 | 403, message: string) {
    super(message)
  }
}

function parseBearer(header: string | null): string | null {
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : null
}

// Verifying a bearer token costs two network hops — GoTrue `getUser` plus the
// profiles read — on EVERY mobile call. Both answers are stable for the life of
// a screen's worth of taps, so a verified token is memoised briefly per warm
// instance. The trade: a suspension or ban takes up to VERIFY_TTL_MS to lock a
// device out. Keep the TTL short enough that this stays a non-issue.
const VERIFY_TTL_MS = 30_000
const VERIFY_CACHE_MAX = 500

type VerifiedToken = { userId: string; email: string; expiresAt: number }

const verifiedTokens = new Map<string, VerifiedToken>()

/** Test seam: drop every memoised verification. Not used in production code. */
export function resetMobileAuthCache(): void {
  verifiedTokens.clear()
}

function readCache(token: string): VerifiedToken | null {
  const hit = verifiedTokens.get(token)
  if (!hit) return null
  if (hit.expiresAt <= Date.now()) {
    verifiedTokens.delete(token)
    return null
  }
  return hit
}

function writeCache(token: string, entry: Omit<VerifiedToken, 'expiresAt'>): void {
  // Cheap bound: drop the oldest insertion once the map is full.
  if (verifiedTokens.size >= VERIFY_CACHE_MAX) {
    const oldest = verifiedTokens.keys().next()
    if (!oldest.done) verifiedTokens.delete(oldest.value)
  }
  verifiedTokens.set(token, { ...entry, expiresAt: Date.now() + VERIFY_TTL_MS })
}

export async function requireMobileUser(req: NextRequest): Promise<MobilePrincipal> {
  const token = parseBearer(req.headers.get('authorization'))
  if (!token) throw new MobileAuthError(401, 'missing bearer token')

  const admin = createAdminClient()

  const cached = readCache(token)
  if (cached) return { userId: cached.userId, email: cached.email, admin }

  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) throw new MobileAuthError(401, 'invalid or expired token')

  const { data: profile } = await admin
    .from('profiles')
    .select('role, status')
    .eq('id', data.user.id)
    .maybeSingle<{ role: string | null; status: string | null }>()

  const status = isAccountStatus(profile?.status) ? profile.status : 'active'
  if (status !== 'active' && profile?.role !== 'superadmin') {
    throw new MobileAuthError(403, `account ${status}`)
  }

  const principal = { userId: data.user.id, email: data.user.email ?? '' }
  writeCache(token, principal)
  return { ...principal, admin }
}

/** Uniform JSON error envelope for mobile routes. */
export function mobileError(err: unknown): NextResponse {
  if (err instanceof MobileAuthError) {
    return NextResponse.json({ ok: false, error: err.message }, { status: err.status })
  }
  const message = err instanceof Error ? err.message : 'unexpected error'
  console.error('[api.mobile]', err)
  return NextResponse.json({ ok: false, error: message }, { status: 500 })
}
