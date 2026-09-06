import { describe, expect, it, vi } from 'vitest'
import { isAcceptableRedirectUri, registerClient } from './clients'

function adminStub() {
  const inserted: Array<Record<string, unknown>> = []
  const insertSpy = vi.fn(async (row: Record<string, unknown>) => {
    inserted.push(row)
    return { error: null }
  })
  return { admin: { from: () => ({ insert: insertSpy }) } as never, insertSpy, inserted }
}

describe('isAcceptableRedirectUri', () => {
  it.each([
    ['https://claude.ai/api/mcp/auth_callback', true],
    ['http://localhost:6274/oauth/callback', true],
    ['http://127.0.0.1:8080/cb', true],
    ['http://evil.example/cb', false],
    ['https://ok.example/cb#frag', false],
    ['not a url', false],
  ])('%s → %s', (uri, ok) => {
    expect(isAcceptableRedirectUri(uri)).toBe(ok)
  })
})

describe('registerClient', () => {
  it('registers a public client without a secret and echoes RFC 7591 fields', async () => {
    const { admin, insertSpy } = adminStub()
    const result = await registerClient(admin, {
      client_name: 'Claude',
      redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.client.client_id).toMatch(/^wscl_[0-9a-f]{32}$/)
    expect(result.client.client_secret).toBeUndefined()
    expect(result.client.client_id_issued_at).toBeTypeOf('number')
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ client_secret_hash: null, token_endpoint_auth_method: 'none' }))
  })

  it('mints a secret for confidential clients and stores only its hash', async () => {
    const { admin, inserted } = adminStub()
    const result = await registerClient(admin, {
      redirect_uris: ['https://x.example/cb'],
      token_endpoint_auth_method: 'client_secret_post',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.client.client_secret).toMatch(/^wscs_/)
    expect(result.client.client_secret_expires_at).toBe(0)
    const hash = String(inserted[0]?.client_secret_hash)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain('wscs_')
  })

  it('rejects non-loopback http redirect URIs', async () => {
    const { admin } = adminStub()
    const result = await registerClient(admin, { redirect_uris: ['http://evil.example/cb'] })
    expect(result).toMatchObject({ ok: false, error: 'invalid_redirect_uri' })
  })

  it('rejects unsupported grant types and auth methods', async () => {
    const { admin } = adminStub()
    expect(await registerClient(admin, { redirect_uris: ['https://x.example/cb'], grant_types: ['implicit'] }))
      .toMatchObject({ ok: false, error: 'invalid_client_metadata' })
    expect(await registerClient(admin, { redirect_uris: ['https://x.example/cb'], token_endpoint_auth_method: 'private_key_jwt' }))
      .toMatchObject({ ok: false, error: 'invalid_client_metadata' })
  })

  it('rejects an empty body', async () => {
    const { admin } = adminStub()
    expect(await registerClient(admin, {})).toMatchObject({ ok: false, error: 'invalid_client_metadata' })
  })
})
