import { describe, expect, it } from 'vitest'
import { createFakeAdmin } from './fake-admin'
import { issueAuthorizationCode } from './codes'
import { s256Challenge } from './pkce'
import { sha256Hex } from './secrets'
import { handleTokenRequest } from './token-endpoint'
import { resolveAccessToken } from './tokens'

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'
const PUBLIC_CLIENT = { id: 'wscl_pub', client_secret_hash: null, token_endpoint_auth_method: 'none', client_name: 'Claude', redirect_uris: [REDIRECT] }
const CONFIDENTIAL_CLIENT = { id: 'wscl_conf', client_secret_hash: sha256Hex('wscs_secret'), token_endpoint_auth_method: 'client_secret_post', client_name: 'Server app', redirect_uris: [REDIRECT] }

async function seededCode(admin: ReturnType<typeof createFakeAdmin>['admin'], clientId = 'wscl_pub') {
  return issueAuthorizationCode(admin, {
    clientId, userId: 'user-1', redirectUri: REDIRECT, scopes: ['read', 'send', 'projects'], codeChallenge: s256Challenge(VERIFIER), resource: null,
  })
}

describe('token endpoint — authorization_code', () => {
  it('exchanges a code + PKCE verifier for a usable token pair', async () => {
    const { admin } = createFakeAdmin({ oauth_clients: [PUBLIC_CLIENT] })
    const code = await seededCode(admin)

    const result = await handleTokenRequest(admin, { clientId: 'wscl_pub', clientSecret: null }, {
      grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: REDIRECT,
    })

    expect(result.status).toBe(200)
    if (result.status !== 200) return
    expect(result.body.token_type).toBe('Bearer')
    expect(result.body.access_token).toMatch(/^wsa_/)
    expect(result.body.refresh_token).toMatch(/^wsr_/)
    expect(result.body.scope).toBe('read send projects')
    const resolved = await resolveAccessToken(admin, result.body.access_token)
    expect(resolved).toMatchObject({ userId: 'user-1', clientId: 'wscl_pub', scopes: ['read', 'send', 'projects'] })
  })

  it('refuses to replay a code', async () => {
    const { admin } = createFakeAdmin({ oauth_clients: [PUBLIC_CLIENT] })
    const code = await seededCode(admin)
    const params = { grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: REDIRECT }
    await handleTokenRequest(admin, { clientId: 'wscl_pub', clientSecret: null }, params)
    const replay = await handleTokenRequest(admin, { clientId: 'wscl_pub', clientSecret: null }, params)
    expect(replay).toMatchObject({ status: 400, body: { error: 'invalid_grant' } })
  })

  it('rejects a wrong verifier, wrong redirect_uri, and a foreign client', async () => {
    const { admin } = createFakeAdmin({ oauth_clients: [PUBLIC_CLIENT, { ...PUBLIC_CLIENT, id: 'wscl_other' }] })
    const base = { grant_type: 'authorization_code', code_verifier: VERIFIER, redirect_uri: REDIRECT }

    const c1 = await seededCode(admin)
    expect(await handleTokenRequest(admin, { clientId: 'wscl_pub', clientSecret: null }, { ...base, code: c1, code_verifier: VERIFIER + 'x' }))
      .toMatchObject({ status: 400, body: { error: 'invalid_grant' } })

    const c2 = await seededCode(admin)
    expect(await handleTokenRequest(admin, { clientId: 'wscl_pub', clientSecret: null }, { ...base, code: c2, redirect_uri: 'https://claude.ai/other' }))
      .toMatchObject({ status: 400, body: { error: 'invalid_grant' } })

    const c3 = await seededCode(admin)
    expect(await handleTokenRequest(admin, { clientId: 'wscl_other', clientSecret: null }, { ...base, code: c3 }))
      .toMatchObject({ status: 400, body: { error: 'invalid_grant' } })
  })

  it('requires the verifier', async () => {
    const { admin } = createFakeAdmin({ oauth_clients: [PUBLIC_CLIENT] })
    const code = await seededCode(admin)
    expect(await handleTokenRequest(admin, { clientId: 'wscl_pub', clientSecret: null }, { grant_type: 'authorization_code', code }))
      .toMatchObject({ status: 400, body: { error: 'invalid_request' } })
  })

  it('authenticates confidential clients by secret', async () => {
    const { admin } = createFakeAdmin({ oauth_clients: [CONFIDENTIAL_CLIENT] })
    const params = { grant_type: 'authorization_code', code: await seededCode(admin, 'wscl_conf'), code_verifier: VERIFIER, redirect_uri: REDIRECT }
    expect(await handleTokenRequest(admin, { clientId: 'wscl_conf', clientSecret: 'wrong' }, params))
      .toMatchObject({ status: 401, body: { error: 'invalid_client' } })
    expect((await handleTokenRequest(admin, { clientId: 'wscl_conf', clientSecret: 'wscs_secret' }, params)).status).toBe(200)
  })

  it('rejects unknown clients and grant types', async () => {
    const { admin } = createFakeAdmin({ oauth_clients: [PUBLIC_CLIENT] })
    expect(await handleTokenRequest(admin, { clientId: 'nope', clientSecret: null }, { grant_type: 'authorization_code' }))
      .toMatchObject({ status: 401, body: { error: 'invalid_client' } })
    expect(await handleTokenRequest(admin, { clientId: 'wscl_pub', clientSecret: null }, { grant_type: 'password' }))
      .toMatchObject({ status: 400, body: { error: 'unsupported_grant_type' } })
  })
})

describe('token endpoint — refresh_token', () => {
  it('rotates the pair and retires the old refresh token', async () => {
    const { admin } = createFakeAdmin({ oauth_clients: [PUBLIC_CLIENT] })
    const code = await seededCode(admin)
    const first = await handleTokenRequest(admin, { clientId: 'wscl_pub', clientSecret: null }, {
      grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: REDIRECT,
    })
    if (first.status !== 200) throw new Error('setup')

    const refreshed = await handleTokenRequest(admin, { clientId: 'wscl_pub', clientSecret: null }, {
      grant_type: 'refresh_token', refresh_token: first.body.refresh_token,
    })
    expect(refreshed.status).toBe(200)
    if (refreshed.status !== 200) return
    expect(refreshed.body.access_token).not.toBe(first.body.access_token)
    expect(await resolveAccessToken(admin, first.body.access_token)).toBeNull()
    expect(await resolveAccessToken(admin, refreshed.body.access_token)).not.toBeNull()

    const reuse = await handleTokenRequest(admin, { clientId: 'wscl_pub', clientSecret: null }, {
      grant_type: 'refresh_token', refresh_token: first.body.refresh_token,
    })
    expect(reuse).toMatchObject({ status: 400, body: { error: 'invalid_grant' } })
  })

  it('refuses a refresh token presented by a different client', async () => {
    const { admin } = createFakeAdmin({ oauth_clients: [PUBLIC_CLIENT, { ...PUBLIC_CLIENT, id: 'wscl_other' }] })
    const code = await seededCode(admin)
    const first = await handleTokenRequest(admin, { clientId: 'wscl_pub', clientSecret: null }, {
      grant_type: 'authorization_code', code, code_verifier: VERIFIER, redirect_uri: REDIRECT,
    })
    if (first.status !== 200) throw new Error('setup')
    expect(await handleTokenRequest(admin, { clientId: 'wscl_other', clientSecret: null }, {
      grant_type: 'refresh_token', refresh_token: first.body.refresh_token,
    })).toMatchObject({ status: 400, body: { error: 'invalid_grant' } })
  })
})

describe('resolveAccessToken', () => {
  it('ignores expired and revoked tokens', async () => {
    const past = new Date(Date.now() - 1000).toISOString()
    const future = new Date(Date.now() + 60_000).toISOString()
    const { admin } = createFakeAdmin({
      oauth_tokens: [
        { id: 't1', user_id: 'u', client_id: 'c', scopes: ['read'], access_token_hash: sha256Hex('wsa_expired'), access_expires_at: past, refresh_expires_at: future, revoked_at: null },
        { id: 't2', user_id: 'u', client_id: 'c', scopes: ['read'], access_token_hash: sha256Hex('wsa_revoked'), access_expires_at: future, refresh_expires_at: future, revoked_at: past },
        { id: 't3', user_id: 'u', client_id: 'c', scopes: ['read', 'bogus'], access_token_hash: sha256Hex('wsa_live'), access_expires_at: future, refresh_expires_at: future, revoked_at: null },
      ],
    })
    expect(await resolveAccessToken(admin, 'wsa_expired')).toBeNull()
    expect(await resolveAccessToken(admin, 'wsa_revoked')).toBeNull()
    expect(await resolveAccessToken(admin, 'wsa_live')).toMatchObject({ tokenId: 't3', scopes: ['read'] })
    expect(await resolveAccessToken(admin, 'wsk_not_an_oauth_token')).toBeNull()
  })
})
