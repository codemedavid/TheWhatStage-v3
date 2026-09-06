import { describe, expect, it } from 'vitest'
import { buildRedirectUrl, pickAuthorizeParams, validateAuthorizeRequest } from './authorize-request'
import { createFakeAdmin } from './fake-admin'
import { s256Challenge } from './pkce'

const REDIRECT = 'https://claude.ai/api/mcp/auth_callback'
const CLIENT = { id: 'wscl_pub', client_secret_hash: null, token_endpoint_auth_method: 'none', client_name: 'Claude', redirect_uris: [REDIRECT] }
const CHALLENGE = s256Challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')

const good = {
  client_id: 'wscl_pub', redirect_uri: REDIRECT, response_type: 'code',
  code_challenge: CHALLENGE, code_challenge_method: 'S256', state: 'xyz', scope: undefined, resource: undefined,
}

describe('validateAuthorizeRequest', () => {
  it('accepts a well-formed PKCE request and grants all scopes by default', async () => {
    const { admin } = createFakeAdmin({ oauth_clients: [CLIENT] })
    const result = await validateAuthorizeRequest(admin, good)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.request).toMatchObject({ clientId: 'wscl_pub', state: 'xyz', scopes: ['read', 'send', 'projects'] })
  })

  it('fails closed (no redirect) for an unknown client or unregistered redirect_uri', async () => {
    const { admin } = createFakeAdmin({ oauth_clients: [CLIENT] })
    expect(await validateAuthorizeRequest(admin, { ...good, client_id: 'nope' })).toMatchObject({ ok: false, kind: 'fatal' })
    expect(await validateAuthorizeRequest(admin, { ...good, redirect_uri: 'https://evil.example/cb' })).toMatchObject({ ok: false, kind: 'fatal' })
    expect(await validateAuthorizeRequest(admin, { ...good, redirect_uri: undefined })).toMatchObject({ ok: false, kind: 'fatal' })
  })

  it('bounces PKCE / response_type / scope problems back to the client with state', async () => {
    const { admin } = createFakeAdmin({ oauth_clients: [CLIENT] })
    expect(await validateAuthorizeRequest(admin, { ...good, code_challenge: undefined }))
      .toMatchObject({ ok: false, kind: 'redirect', error: 'invalid_request', state: 'xyz', redirectUri: REDIRECT })
    expect(await validateAuthorizeRequest(admin, { ...good, code_challenge_method: 'plain' }))
      .toMatchObject({ ok: false, kind: 'redirect', error: 'invalid_request' })
    expect(await validateAuthorizeRequest(admin, { ...good, response_type: 'token' }))
      .toMatchObject({ ok: false, kind: 'redirect', error: 'unsupported_response_type' })
    expect(await validateAuthorizeRequest(admin, { ...good, scope: 'read admin' }))
      .toMatchObject({ ok: false, kind: 'redirect', error: 'invalid_scope' })
  })
})

describe('helpers', () => {
  it('pickAuthorizeParams reads from URLSearchParams and plain objects alike', () => {
    const fromQs = pickAuthorizeParams(new URLSearchParams('client_id=a&state=s'))
    expect(fromQs).toMatchObject({ client_id: 'a', state: 's', redirect_uri: undefined })
    const fromObj = pickAuthorizeParams({ client_id: ['a', 'b'], scope: 'read' })
    expect(fromObj).toMatchObject({ client_id: 'a', scope: 'read' })
  })

  it('buildRedirectUrl keeps existing query params and skips nulls', () => {
    const url = buildRedirectUrl('http://localhost:1234/cb?keep=1', { code: 'c', state: null })
    expect(url).toBe('http://localhost:1234/cb?keep=1&code=c')
  })
})
