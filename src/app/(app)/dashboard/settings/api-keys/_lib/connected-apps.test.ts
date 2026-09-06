import { describe, expect, it } from 'vitest'
import { groupGrantsByClient } from './connected-apps'

describe('groupGrantsByClient', () => {
  it('collapses many grants per client into one entry with earliest connect and latest use', () => {
    const apps = groupGrantsByClient([
      { client_id: 'a', scopes: ['read'], created_at: '2026-09-02T00:00:00Z', last_used_at: '2026-09-05T00:00:00Z', oauth_clients: { client_name: 'Claude' } },
      { client_id: 'a', scopes: ['send'], created_at: '2026-09-01T00:00:00Z', last_used_at: null, oauth_clients: { client_name: 'Claude' } },
      { client_id: 'b', scopes: [], created_at: '2026-09-03T00:00:00Z', last_used_at: null, oauth_clients: null },
    ])
    expect(apps).toEqual([
      { clientId: 'b', clientName: 'Unnamed app', scopes: [], connectedAt: '2026-09-03T00:00:00Z', lastUsedAt: null },
      { clientId: 'a', clientName: 'Claude', scopes: ['read', 'send'], connectedAt: '2026-09-01T00:00:00Z', lastUsedAt: '2026-09-05T00:00:00Z' },
    ])
  })
})
