import type { SupabaseClient } from '@supabase/supabase-js'
import { OAuthClientMetadataSchema, type OAuthClientInformationFull, type OAuthClientMetadata } from '@modelcontextprotocol/sdk/shared/auth.js'
import { CLIENT_SECRET_PREFIX, randomClientId, randomSecret, sha256Hex } from './secrets'

export type ClientAuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic'

export interface OAuthClientRecord {
  id: string
  clientSecretHash: string | null
  tokenEndpointAuthMethod: ClientAuthMethod
  clientName: string | null
  redirectUris: string[]
}

const AUTH_METHODS: ReadonlySet<string> = new Set<ClientAuthMethod>(['none', 'client_secret_post', 'client_secret_basic'])
const GRANT_TYPES: ReadonlySet<string> = new Set(['authorization_code', 'refresh_token'])
const RESPONSE_TYPES: ReadonlySet<string> = new Set(['code'])
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]'])
const MAX_REDIRECT_URIS = 10
const MAX_NAME_LEN = 120

export type RegistrationFailure = {
  ok: false
  error: 'invalid_client_metadata' | 'invalid_redirect_uri'
  description: string
}
export type RegistrationSuccess = { ok: true; client: OAuthClientInformationFull }

// Native MCP clients (Claude Desktop, Cursor, Claude Code) listen on a
// loopback port for the callback, so plain http is allowed there and only
// there. Everything else must be https with no fragment.
export function isAcceptableRedirectUri(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.hash) return false
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
}

type ValidatedMetadata = RegistrationFailure | { ok: true; data: OAuthClientMetadata }

function validateMetadata(body: unknown): ValidatedMetadata {
  const parsed = OAuthClientMetadataSchema.safeParse(body)
  if (!parsed.success) {
    return { ok: false, error: 'invalid_client_metadata', description: parsed.error.issues[0]?.message ?? 'Invalid client metadata.' }
  }
  const data = parsed.data
  if (data.redirect_uris.length === 0 || data.redirect_uris.length > MAX_REDIRECT_URIS) {
    return { ok: false, error: 'invalid_redirect_uri', description: `Provide 1-${MAX_REDIRECT_URIS} redirect_uris.` }
  }
  const bad = data.redirect_uris.find((u) => !isAcceptableRedirectUri(u))
  if (bad) {
    return { ok: false, error: 'invalid_redirect_uri', description: `redirect_uri must be https (or http on localhost): ${bad}` }
  }
  const method = data.token_endpoint_auth_method ?? 'none'
  if (!AUTH_METHODS.has(method)) {
    return { ok: false, error: 'invalid_client_metadata', description: `Unsupported token_endpoint_auth_method: ${method}` }
  }
  if ((data.grant_types ?? []).some((g) => !GRANT_TYPES.has(g))) {
    return { ok: false, error: 'invalid_client_metadata', description: 'Only authorization_code and refresh_token grants are supported.' }
  }
  if ((data.response_types ?? []).some((r) => !RESPONSE_TYPES.has(r))) {
    return { ok: false, error: 'invalid_client_metadata', description: 'Only the "code" response type is supported.' }
  }
  return { ok: true, data }
}

/** RFC 7591 dynamic registration. Secrets are only minted for confidential clients. */
export async function registerClient(admin: SupabaseClient, body: unknown): Promise<RegistrationSuccess | RegistrationFailure> {
  const validated = validateMetadata(body)
  if (!validated.ok) return validated
  const meta = validated.data
  const method = (meta.token_endpoint_auth_method ?? 'none') as ClientAuthMethod
  const clientId = randomClientId()
  const secret = method === 'none' ? null : randomSecret(CLIENT_SECRET_PREFIX)
  const issuedAt = Math.floor(Date.now() / 1000)

  const { error } = await admin.from('oauth_clients').insert({
    id: clientId,
    client_secret_hash: secret ? sha256Hex(secret) : null,
    token_endpoint_auth_method: method,
    client_name: meta.client_name?.slice(0, MAX_NAME_LEN) ?? null,
    client_uri: meta.client_uri ?? null,
    logo_uri: meta.logo_uri ?? null,
    redirect_uris: meta.redirect_uris,
  })
  if (error) throw new Error(`registerClient: ${error.message}`)

  const client: OAuthClientInformationFull = {
    ...meta,
    token_endpoint_auth_method: method,
    grant_types: meta.grant_types ?? ['authorization_code', 'refresh_token'],
    response_types: meta.response_types ?? ['code'],
    client_id: clientId,
    client_id_issued_at: issuedAt,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
  }
  return { ok: true, client }
}

interface ClientRow {
  id: string
  client_secret_hash: string | null
  token_endpoint_auth_method: string
  client_name: string | null
  redirect_uris: string[] | null
}

export async function findClient(admin: SupabaseClient, clientId: string): Promise<OAuthClientRecord | null> {
  if (!clientId) return null
  const { data, error } = await admin
    .from('oauth_clients')
    .select('id, client_secret_hash, token_endpoint_auth_method, client_name, redirect_uris')
    .eq('id', clientId)
    .maybeSingle<ClientRow>()
  if (error) throw new Error(`findClient: ${error.message}`)
  if (!data) return null
  const method = AUTH_METHODS.has(data.token_endpoint_auth_method) ? data.token_endpoint_auth_method : 'none'
  return {
    id: data.id,
    clientSecretHash: data.client_secret_hash,
    tokenEndpointAuthMethod: method as ClientAuthMethod,
    clientName: data.client_name,
    redirectUris: data.redirect_uris ?? [],
  }
}

// Exact string match, as OAuth 2.1 requires (no prefix or wildcard matching).
export function isRegisteredRedirectUri(client: OAuthClientRecord, redirectUri: string): boolean {
  return client.redirectUris.includes(redirectUri)
}
