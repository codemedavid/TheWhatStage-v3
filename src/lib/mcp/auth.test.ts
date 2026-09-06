import { describe, expect, it } from 'vitest'
import { createFakeAdmin } from '@/lib/oauth/fake-admin'
import { sha256Hex } from '@/lib/oauth/secrets'
import { hashApiKey } from '@/lib/api-keys/generate'
import { resolveMcpPrincipal } from './auth'

const API_KEY = 'wsk_' + 'a'.repeat(43)
const future = new Date(Date.now() + 60_000).toISOString()

function seeded(status = 'active') {
  return createFakeAdmin({
    profiles: [{ id: 'user-1', status }],
    api_keys: [{ id: 'k1', user_id: 'user-1', scopes: ['read'], revoked_at: null, key_hash: hashApiKey(API_KEY) }],
    oauth_tokens: [{ id: 't1', user_id: 'user-1', client_id: 'c', scopes: ['read', 'send'], access_token_hash: sha256Hex('wsa_live'), access_expires_at: future, refresh_expires_at: future, revoked_at: null }],
  }).admin
}

describe('resolveMcpPrincipal', () => {
  it('routes wsk_ bearers to API keys and wsa_ bearers to OAuth tokens', async () => {
    const admin = seeded()
    expect(await resolveMcpPrincipal(admin, API_KEY)).toMatchObject({ kind: 'api_key', principalId: 'k1', userId: 'user-1', scopes: ['read'] })
    expect(await resolveMcpPrincipal(admin, 'wsa_live')).toMatchObject({ kind: 'oauth', principalId: 't1', userId: 'user-1', scopes: ['read', 'send'] })
  })

  it('rejects unknown formats, missing bearers, and inactive accounts', async () => {
    expect(await resolveMcpPrincipal(seeded(), null)).toBeNull()
    expect(await resolveMcpPrincipal(seeded(), 'Bearer-shaped-garbage')).toBeNull()
    expect(await resolveMcpPrincipal(seeded('paused'), 'wsa_live')).toBeNull()
    expect(await resolveMcpPrincipal(seeded('paused'), API_KEY)).toBeNull()
  })
})
