import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit } from '@/lib/action-pages/upload-guard'
import { extractClientCredentials } from '@/lib/oauth/client-auth'
import { handleTokenRequest } from '@/lib/oauth/token-endpoint'
import { clientIp, jsonResponse, oauthError, preflightResponse, readBodyParams } from '@/lib/oauth/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TOKEN_REQUESTS_PER_MINUTE = 60

/** OAuth 2.1 token endpoint: authorization_code (PKCE) and refresh_token grants. */
export async function POST(req: Request): Promise<Response> {
  if (!checkRateLimit(`oauth:token:${clientIp(req)}`, Date.now(), TOKEN_REQUESTS_PER_MINUTE)) {
    return oauthError('invalid_request', 'Too many token requests. Try again in a minute.', 429)
  }
  let params: Record<string, unknown>
  try {
    params = await readBodyParams(req)
  } catch {
    return oauthError('invalid_request', 'Body must be form-encoded or JSON.')
  }
  const creds = extractClientCredentials(req.headers.get('authorization'), params)
  try {
    const result = await handleTokenRequest(createAdminClient(), creds, params)
    const headers: Record<string, string> = result.status === 401 ? { 'www-authenticate': 'Basic realm="whatstage-oauth"' } : {}
    return jsonResponse(result.body, result.status, headers)
  } catch (e) {
    console.error('[oauth] token request failed', e)
    return oauthError('server_error', 'Could not process the token request.', 500)
  }
}

export function OPTIONS(): Response {
  return preflightResponse()
}
