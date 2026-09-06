import type { ConnectedAppItem } from '../_components/connected-apps-panel'

export interface GrantRow {
  client_id: string
  scopes: string[] | null
  created_at: string
  last_used_at: string | null
  oauth_clients: { client_name: string | null } | { client_name: string | null }[] | null
}

function clientNameOf(row: GrantRow): string {
  const rel = Array.isArray(row.oauth_clients) ? row.oauth_clients[0] : row.oauth_clients
  return rel?.client_name?.trim() || 'Unnamed app'
}

// One entry per client: a client that refreshed many times still shows once,
// with the earliest connection and the latest use.
export function groupGrantsByClient(rows: GrantRow[]): ConnectedAppItem[] {
  const byClient = new Map<string, ConnectedAppItem>()
  for (const row of rows) {
    const existing = byClient.get(row.client_id)
    const scopes = row.scopes ?? []
    if (!existing) {
      byClient.set(row.client_id, {
        clientId: row.client_id,
        clientName: clientNameOf(row),
        scopes,
        connectedAt: row.created_at,
        lastUsedAt: row.last_used_at,
      })
      continue
    }
    byClient.set(row.client_id, {
      ...existing,
      scopes: Array.from(new Set([...existing.scopes, ...scopes])),
      connectedAt: row.created_at < existing.connectedAt ? row.created_at : existing.connectedAt,
      lastUsedAt: laterOf(existing.lastUsedAt, row.last_used_at),
    })
  }
  return Array.from(byClient.values()).sort((a, b) => b.connectedAt.localeCompare(a.connectedAt))
}

function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a > b ? a : b
}
