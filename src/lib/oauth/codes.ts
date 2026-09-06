import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiKeyScope } from '@/lib/api-keys/resolve'
import { AUTH_CODE_PREFIX, randomSecret, sha256Hex } from './secrets'

const CODE_TTL_MS = 10 * 60_000

export interface AuthorizationCodeInput {
  clientId: string
  userId: string
  redirectUri: string
  scopes: ApiKeyScope[]
  codeChallenge: string
  resource: string | null
}

export interface AuthorizationCodeRecord {
  clientId: string
  userId: string
  redirectUri: string
  scopes: string[]
  codeChallenge: string
  expiresAt: string
}

export async function issueAuthorizationCode(admin: SupabaseClient, input: AuthorizationCodeInput): Promise<string> {
  const code = randomSecret(AUTH_CODE_PREFIX)
  const { error } = await admin.from('oauth_authorization_codes').insert({
    code_hash: sha256Hex(code),
    client_id: input.clientId,
    user_id: input.userId,
    redirect_uri: input.redirectUri,
    scopes: input.scopes,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    resource: input.resource,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  })
  if (error) throw new Error(`issueAuthorizationCode: ${error.message}`)
  return code
}

/**
 * Single-use: the row is deleted as it is read, so a replayed code can never
 * succeed. Expired codes are treated as absent.
 */
export async function consumeAuthorizationCode(admin: SupabaseClient, code: string): Promise<AuthorizationCodeRecord | null> {
  if (!code.startsWith(AUTH_CODE_PREFIX)) return null
  const { data, error } = await admin
    .from('oauth_authorization_codes')
    .delete()
    .eq('code_hash', sha256Hex(code))
    .select('client_id, user_id, redirect_uri, scopes, code_challenge, expires_at')
    .maybeSingle<{ client_id: string; user_id: string; redirect_uri: string; scopes: string[]; code_challenge: string; expires_at: string }>()
  if (error) throw new Error(`consumeAuthorizationCode: ${error.message}`)
  if (!data) return null
  if (Date.parse(data.expires_at) <= Date.now()) return null
  return {
    clientId: data.client_id,
    userId: data.user_id,
    redirectUri: data.redirect_uri,
    scopes: data.scopes ?? [],
    codeChallenge: data.code_challenge,
    expiresAt: data.expires_at,
  }
}
