import type { SupabaseClient } from '@supabase/supabase-js'
import { looksLikeApiKey } from '@/lib/api-keys/generate'
import { resolveApiKey, type ApiKeyScope } from '@/lib/api-keys/resolve'
import { resolveAccessToken } from '@/lib/oauth/tokens'
import { ACCESS_TOKEN_PREFIX } from '@/lib/oauth/secrets'

export interface McpPrincipal {
  kind: 'api_key' | 'oauth'
  /** Key id or token id, used for rate limiting and audit. */
  principalId: string
  userId: string
  scopes: ApiKeyScope[]
}

/**
 * A bearer on /api/mcp is either a long-lived API key (wsk_, for scripts) or
 * an OAuth access token (wsa_, minted through the login flow). Both resolve
 * to the same tenant principal; both require an active account.
 */
export async function resolveMcpPrincipal(admin: SupabaseClient, bearer: string | null): Promise<McpPrincipal | null> {
  if (!bearer) return null
  if (looksLikeApiKey(bearer)) {
    const key = await resolveApiKey(admin, bearer)
    return key ? { kind: 'api_key', principalId: key.keyId, userId: key.userId, scopes: key.scopes } : null
  }
  if (bearer.startsWith(ACCESS_TOKEN_PREFIX)) {
    const token = await resolveAccessToken(admin, bearer)
    if (!token) return null
    if (!(await isActiveAccount(admin, token.userId))) return null
    return { kind: 'oauth', principalId: token.tokenId, userId: token.userId, scopes: token.scopes }
  }
  return null
}

async function isActiveAccount(admin: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await admin.from('profiles').select('status').eq('id', userId).maybeSingle<{ status: string | null }>()
  return data?.status === 'active'
}
