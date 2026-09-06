import type { SupabaseClient } from '@supabase/supabase-js'
import { findClient, type OAuthClientRecord } from './clients'
import { digestsMatch, sha256Hex } from './secrets'

export interface ClientCredentials {
  clientId: string | null
  clientSecret: string | null
}

// Client credentials may come as HTTP Basic (client_secret_basic) or in the
// body (client_secret_post / public clients that only send client_id).
export function extractClientCredentials(authorizationHeader: string | null, body: Record<string, unknown>): ClientCredentials {
  const basic = /^Basic\s+(.+)$/i.exec(authorizationHeader?.trim() ?? '')
  if (basic) {
    const decoded = Buffer.from(basic[1], 'base64').toString('utf8')
    const sep = decoded.indexOf(':')
    if (sep > 0) {
      return {
        clientId: decodeURIComponent(decoded.slice(0, sep)),
        clientSecret: decodeURIComponent(decoded.slice(sep + 1)),
      }
    }
  }
  return {
    clientId: typeof body.client_id === 'string' ? body.client_id : null,
    clientSecret: typeof body.client_secret === 'string' ? body.client_secret : null,
  }
}

/**
 * Resolve and authenticate the calling client. Public clients ("none") are
 * identified by id alone; confidential clients must present their secret.
 */
export async function authenticateClient(admin: SupabaseClient, creds: ClientCredentials): Promise<OAuthClientRecord | null> {
  if (!creds.clientId) return null
  const client = await findClient(admin, creds.clientId)
  if (!client) return null
  if (client.tokenEndpointAuthMethod === 'none') return client
  if (!creds.clientSecret || !client.clientSecretHash) return null
  return digestsMatch(sha256Hex(creds.clientSecret), client.clientSecretHash) ? client : null
}
