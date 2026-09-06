import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit } from '@/lib/action-pages/upload-guard'
import { authenticateClient, extractClientCredentials } from '@/lib/oauth/client-auth'
import { revokeToken } from '@/lib/oauth/tokens'
import { clientIp, oauthError, preflightResponse, readBodyParams } from '@/lib/oauth/http'
import { CORS_HEADERS } from '@/lib/oauth/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const REVOKES_PER_MINUTE = 60

/** RFC 7009. Always 200 for a well-formed request, even if the token was unknown. */
export async function POST(req: Request): Promise<Response> {
  if (!checkRateLimit(`oauth:revoke:${clientIp(req)}`, Date.now(), REVOKES_PER_MINUTE)) {
    return oauthError('invalid_request', 'Too many requests. Try again in a minute.', 429)
  }
  let params: Record<string, unknown>
  try {
    params = await readBodyParams(req)
  } catch {
    return oauthError('invalid_request', 'Body must be form-encoded or JSON.')
  }
  const token = typeof params.token === 'string' ? params.token : ''
  if (!token) return oauthError('invalid_request', 'token is required.')
  const admin = createAdminClient()
  try {
    const client = await authenticateClient(admin, extractClientCredentials(req.headers.get('authorization'), params))
    if (!client) return oauthError('invalid_client', 'Unknown client or bad client credentials.', 401)
    await revokeToken(admin, token, client.id)
    return new Response(null, { status: 200, headers: CORS_HEADERS })
  } catch (e) {
    console.error('[oauth] revoke failed', e)
    return oauthError('server_error', 'Could not revoke the token.', 500)
  }
}

export function OPTIONS(): Response {
  return preflightResponse()
}
