import { createAdminClient } from '@/lib/supabase/admin'
import { checkRateLimit } from '@/lib/action-pages/upload-guard'
import { registerClient } from '@/lib/oauth/clients'
import { clientIp, jsonResponse, oauthError, preflightResponse, readBodyParams } from '@/lib/oauth/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Registrations are cheap rows but unauthenticated; cap them per address.
const REGISTRATIONS_PER_MINUTE = 20

/** RFC 7591 dynamic client registration, open to any MCP client. */
export async function POST(req: Request): Promise<Response> {
  if (!checkRateLimit(`oauth:register:${clientIp(req)}`, Date.now(), REGISTRATIONS_PER_MINUTE)) {
    return oauthError('invalid_request', 'Too many registrations. Try again in a minute.', 429)
  }
  let body: Record<string, unknown>
  try {
    body = await readBodyParams(req)
  } catch {
    return oauthError('invalid_client_metadata', 'Body must be valid JSON.')
  }
  try {
    const result = await registerClient(createAdminClient(), body)
    if (!result.ok) return oauthError(result.error, result.description)
    return jsonResponse(result.client, 201)
  } catch (e) {
    console.error('[oauth] register failed', e)
    return oauthError('server_error', 'Could not register the client.', 500)
  }
}

export function OPTIONS(): Response {
  return preflightResponse()
}
