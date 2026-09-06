import type { SupabaseClient } from '@supabase/supabase-js'
import type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { ApiKeyScope } from '@/lib/api-keys/resolve'
import { isKnownScope } from './scopes'
import { ACCESS_TOKEN_PREFIX, REFRESH_TOKEN_PREFIX, randomSecret, sha256Hex } from './secrets'

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60

export interface ResolvedAccessToken {
  tokenId: string
  userId: string
  clientId: string
  scopes: ApiKeyScope[]
}

interface TokenRow {
  id: string
  user_id: string
  client_id: string
  scopes: string[] | null
  access_expires_at: string
  refresh_expires_at: string | null
  revoked_at: string | null
}

const TOKEN_COLUMNS = 'id, user_id, client_id, scopes, access_expires_at, refresh_expires_at, revoked_at'

function mintPair(scopes: ApiKeyScope[]): { tokens: OAuthTokens; accessHash: string; refreshHash: string; accessExpiresAt: string; refreshExpiresAt: string } {
  const accessToken = randomSecret(ACCESS_TOKEN_PREFIX)
  const refreshToken = randomSecret(REFRESH_TOKEN_PREFIX)
  const now = Date.now()
  return {
    tokens: {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
    },
    accessHash: sha256Hex(accessToken),
    refreshHash: sha256Hex(refreshToken),
    accessExpiresAt: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
    refreshExpiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
  }
}

export async function issueTokenPair(
  admin: SupabaseClient,
  input: { userId: string; clientId: string; scopes: ApiKeyScope[] },
): Promise<OAuthTokens> {
  const minted = mintPair(input.scopes)
  const { error } = await admin.from('oauth_tokens').insert({
    user_id: input.userId,
    client_id: input.clientId,
    access_token_hash: minted.accessHash,
    refresh_token_hash: minted.refreshHash,
    scopes: input.scopes,
    access_expires_at: minted.accessExpiresAt,
    refresh_expires_at: minted.refreshExpiresAt,
  })
  if (error) throw new Error(`issueTokenPair: ${error.message}`)
  return minted.tokens
}

/**
 * Refresh-token rotation: the presented refresh token is retired and a new
 * access/refresh pair takes over the same grant row. Returns null when the
 * token is unknown, revoked, expired, or belongs to another client.
 */
export async function rotateRefreshToken(
  admin: SupabaseClient,
  refreshToken: string,
  clientId: string,
): Promise<OAuthTokens | null> {
  if (!refreshToken.startsWith(REFRESH_TOKEN_PREFIX)) return null
  const { data, error } = await admin
    .from('oauth_tokens')
    .select(TOKEN_COLUMNS)
    .eq('refresh_token_hash', sha256Hex(refreshToken))
    .maybeSingle<TokenRow>()
  if (error) throw new Error(`rotateRefreshToken: ${error.message}`)
  if (!data || data.revoked_at || data.client_id !== clientId) return null
  if (!data.refresh_expires_at || Date.parse(data.refresh_expires_at) <= Date.now()) return null

  const scopes = (data.scopes ?? []).filter(isKnownScope)
  const minted = mintPair(scopes)
  const { error: updateErr } = await admin
    .from('oauth_tokens')
    .update({
      access_token_hash: minted.accessHash,
      refresh_token_hash: minted.refreshHash,
      access_expires_at: minted.accessExpiresAt,
      refresh_expires_at: minted.refreshExpiresAt,
    })
    .eq('id', data.id)
  if (updateErr) throw new Error(`rotateRefreshToken: ${updateErr.message}`)
  return minted.tokens
}

export async function resolveAccessToken(admin: SupabaseClient, presented: string): Promise<ResolvedAccessToken | null> {
  if (!presented.startsWith(ACCESS_TOKEN_PREFIX)) return null
  const { data, error } = await admin
    .from('oauth_tokens')
    .select(TOKEN_COLUMNS)
    .eq('access_token_hash', sha256Hex(presented))
    .maybeSingle<TokenRow>()
  if (error) throw new Error(`resolveAccessToken: ${error.message}`)
  if (!data || data.revoked_at) return null
  if (Date.parse(data.access_expires_at) <= Date.now()) return null

  void admin
    .from('oauth_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id)
    .then(({ error: touchErr }) => {
      if (touchErr) console.error('[oauth] last_used_at update failed', touchErr.message)
    })

  return {
    tokenId: data.id,
    userId: data.user_id,
    clientId: data.client_id,
    scopes: (data.scopes ?? []).filter(isKnownScope),
  }
}

/** Revoke a single token by either of its values (RFC 7009). Unknown tokens are a no-op. */
export async function revokeToken(admin: SupabaseClient, presented: string, clientId: string): Promise<void> {
  const column = presented.startsWith(REFRESH_TOKEN_PREFIX)
    ? 'refresh_token_hash'
    : presented.startsWith(ACCESS_TOKEN_PREFIX) ? 'access_token_hash' : null
  if (!column) return
  const { error } = await admin
    .from('oauth_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq(column, sha256Hex(presented))
    .eq('client_id', clientId)
    .is('revoked_at', null)
  if (error) throw new Error(`revokeToken: ${error.message}`)
}
