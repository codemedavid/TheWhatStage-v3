import 'server-only'
import { getSession, type SessionContext } from './get-session'

/**
 * Thrown by requireSuperadmin() when the caller is not an authenticated
 * superadmin. `status` maps straight to an HTTP response in route handlers.
 */
export class AdminAuthError extends Error {
  constructor(
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message)
    this.name = 'AdminAuthError'
  }
}

/**
 * Gate any superadmin data-fetch or mutation. Reads the role LIVE from `profiles`
 * (via getSession), so a demoted superadmin loses access immediately — we never
 * trust only the JWT role claim, which can be stale until the token refreshes.
 *
 * Throws AdminAuthError(401|403) on failure; returns the session on success.
 */
export async function requireSuperadmin(): Promise<SessionContext> {
  const session = await getSession()
  if (!session) throw new AdminAuthError(401, 'unauthenticated')
  if (session.role !== 'superadmin') throw new AdminAuthError(403, 'forbidden')
  return session
}

/**
 * Non-throwing variant for server components that prefer to render a fallback
 * (e.g. notFound()) rather than catch. Returns null when not a superadmin.
 */
export async function getSuperadminSession(): Promise<SessionContext | null> {
  const session = await getSession()
  return session && session.role === 'superadmin' ? session : null
}
