import type { SupabaseClient } from '@supabase/supabase-js'
import type { OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { consumeAuthorizationCode } from './codes'
import { verifyPkceS256 } from './pkce'
import { isKnownScope } from './scopes'
import { issueTokenPair, rotateRefreshToken } from './tokens'
import { authenticateClient, type ClientCredentials } from './client-auth'
import type { OAuthErrorBody } from './http'

export type TokenResult =
  | { status: 200; body: OAuthTokens }
  | { status: 400 | 401; body: OAuthErrorBody }

function fail(status: 400 | 401, error: OAuthErrorBody['error'], description: string): TokenResult {
  return { status, body: { error, error_description: description } }
}

function str(params: Record<string, unknown>, key: string): string | null {
  const v = params[key]
  return typeof v === 'string' && v.length > 0 ? v : null
}

async function authorizationCodeGrant(admin: SupabaseClient, clientId: string, params: Record<string, unknown>): Promise<TokenResult> {
  const code = str(params, 'code')
  const verifier = str(params, 'code_verifier')
  const redirectUri = str(params, 'redirect_uri')
  if (!code) return fail(400, 'invalid_request', 'code is required.')
  if (!verifier) return fail(400, 'invalid_request', 'code_verifier is required (PKCE).')

  const record = await consumeAuthorizationCode(admin, code)
  if (!record) return fail(400, 'invalid_grant', 'Authorization code is invalid, expired, or already used.')
  if (record.clientId !== clientId) return fail(400, 'invalid_grant', 'Authorization code was issued to a different client.')
  if (redirectUri && redirectUri !== record.redirectUri) return fail(400, 'invalid_grant', 'redirect_uri does not match the authorization request.')
  if (!verifyPkceS256(verifier, record.codeChallenge)) return fail(400, 'invalid_grant', 'PKCE verification failed.')

  const tokens = await issueTokenPair(admin, {
    userId: record.userId,
    clientId,
    scopes: record.scopes.filter(isKnownScope),
  })
  return { status: 200, body: tokens }
}

async function refreshTokenGrant(admin: SupabaseClient, clientId: string, params: Record<string, unknown>): Promise<TokenResult> {
  const refreshToken = str(params, 'refresh_token')
  if (!refreshToken) return fail(400, 'invalid_request', 'refresh_token is required.')
  const tokens = await rotateRefreshToken(admin, refreshToken, clientId)
  if (!tokens) return fail(400, 'invalid_grant', 'Refresh token is invalid, expired, or revoked.')
  return { status: 200, body: tokens }
}

/** RFC 6749 §4.1.3 / §6 token endpoint, framed as data so it is testable without HTTP. */
export async function handleTokenRequest(
  admin: SupabaseClient,
  creds: ClientCredentials,
  params: Record<string, unknown>,
): Promise<TokenResult> {
  const client = await authenticateClient(admin, creds)
  if (!client) return fail(401, 'invalid_client', 'Unknown client or bad client credentials.')

  const grantType = str(params, 'grant_type')
  if (grantType === 'authorization_code') return authorizationCodeGrant(admin, client.id, params)
  if (grantType === 'refresh_token') return refreshTokenGrant(admin, client.id, params)
  return fail(400, 'unsupported_grant_type', 'grant_type must be authorization_code or refresh_token.')
}
