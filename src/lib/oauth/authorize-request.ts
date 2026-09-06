import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiKeyScope } from '@/lib/api-keys/resolve'
import { findClient, isRegisteredRedirectUri, type OAuthClientRecord } from './clients'
import { resolveRequestedScopes } from './scopes'

// Shape of a valid /oauth/authorize request once the client is trusted.
export interface AuthorizeRequest {
  clientId: string
  redirectUri: string
  codeChallenge: string
  state: string | null
  scopes: ApiKeyScope[]
  resource: string | null
}

export type AuthorizeValidation =
  | { ok: true; client: OAuthClientRecord; request: AuthorizeRequest }
  // The redirect target itself is untrusted: show the error, never redirect.
  | { ok: false; kind: 'fatal'; message: string }
  // Client + redirect are fine; hand the error back to the client per RFC 6749 §4.1.2.1.
  | { ok: false; kind: 'redirect'; redirectUri: string; state: string | null; error: string; description: string }

const CHALLENGE_RE = /^[A-Za-z0-9\-._~]{43,128}$/

const rawSchema = z.object({
  client_id: z.string().min(1).max(200),
  redirect_uri: z.string().min(1).max(2048),
  response_type: z.string().optional(),
  code_challenge: z.string().optional(),
  code_challenge_method: z.string().optional(),
  state: z.string().max(2048).optional(),
  scope: z.string().max(500).optional(),
  resource: z.string().max(2048).optional(),
})

export type RawAuthorizeParams = Record<string, string | undefined>

export function pickAuthorizeParams(source: URLSearchParams | Record<string, string | string[] | undefined>): RawAuthorizeParams {
  const get = (k: string): string | undefined => {
    if (source instanceof URLSearchParams) return source.get(k) ?? undefined
    const v = source[k]
    return Array.isArray(v) ? v[0] : v
  }
  return {
    client_id: get('client_id'),
    redirect_uri: get('redirect_uri'),
    response_type: get('response_type'),
    code_challenge: get('code_challenge'),
    code_challenge_method: get('code_challenge_method'),
    state: get('state'),
    scope: get('scope'),
    resource: get('resource'),
  }
}

export async function validateAuthorizeRequest(admin: SupabaseClient, raw: RawAuthorizeParams): Promise<AuthorizeValidation> {
  const parsed = rawSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, kind: 'fatal', message: 'Missing or malformed client_id / redirect_uri.' }
  }
  const p = parsed.data
  const client = await findClient(admin, p.client_id)
  if (!client) return { ok: false, kind: 'fatal', message: 'Unknown client. Ask the app to register again.' }
  if (!isRegisteredRedirectUri(client, p.redirect_uri)) {
    return { ok: false, kind: 'fatal', message: 'redirect_uri is not registered for this client.' }
  }

  const state = p.state ?? null
  const bounce = (error: string, description: string): AuthorizeValidation =>
    ({ ok: false, kind: 'redirect', redirectUri: p.redirect_uri, state, error, description })

  if (p.response_type !== 'code') return bounce('unsupported_response_type', 'response_type must be "code".')
  if (!p.code_challenge || !CHALLENGE_RE.test(p.code_challenge)) return bounce('invalid_request', 'code_challenge is required (PKCE).')
  if ((p.code_challenge_method ?? 'plain') !== 'S256') return bounce('invalid_request', 'code_challenge_method must be S256.')
  const scopes = resolveRequestedScopes(p.scope)
  if (!scopes) return bounce('invalid_scope', 'Unknown scope requested.')

  return {
    ok: true,
    client,
    request: {
      clientId: client.id,
      redirectUri: p.redirect_uri,
      codeChallenge: p.code_challenge,
      state,
      scopes,
      resource: p.resource ?? null,
    },
  }
}

// Append OAuth response params to the registered redirect URI, keeping any
// query it already carries.
export function buildRedirectUrl(redirectUri: string, params: Record<string, string | null>): string {
  const url = new URL(redirectUri)
  for (const [k, v] of Object.entries(params)) {
    if (v !== null) url.searchParams.set(k, v)
  }
  return url.toString()
}
