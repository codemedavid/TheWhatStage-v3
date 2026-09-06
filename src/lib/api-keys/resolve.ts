import type { SupabaseClient } from '@supabase/supabase-js'
import { hashApiKey, looksLikeApiKey } from './generate'

export type ApiKeyScope = 'read' | 'send' | 'projects'

export interface ResolvedApiKey {
  keyId: string
  userId: string
  scopes: ApiKeyScope[]
}

const VALID_SCOPES: ReadonlySet<string> = new Set<ApiKeyScope>(['read', 'send', 'projects'])

// Extract the bearer token from an Authorization header value, or null.
export function parseBearer(header: string | null): string | null {
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match ? match[1].trim() : null
}

/**
 * Map a presented API key to its owner. Returns null for unknown, revoked, or
 * malformed keys and for owners whose account is not active. Best-effort
 * updates `last_used_at` (a failure there never blocks the request).
 */
export async function resolveApiKey(
  admin: SupabaseClient,
  presented: string | null,
): Promise<ResolvedApiKey | null> {
  if (!presented || !looksLikeApiKey(presented)) return null

  const { data: key, error } = await admin
    .from('api_keys')
    .select('id, user_id, scopes, revoked_at')
    .eq('key_hash', hashApiKey(presented))
    .maybeSingle<{ id: string; user_id: string; scopes: string[] | null; revoked_at: string | null }>()
  if (error) throw new Error(`resolveApiKey: ${error.message}`)
  if (!key || key.revoked_at) return null

  const { data: profile } = await admin
    .from('profiles')
    .select('status')
    .eq('id', key.user_id)
    .maybeSingle<{ status: string | null }>()
  if (profile?.status !== 'active') return null

  void admin
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', key.id)
    .then(({ error: touchErr }) => {
      if (touchErr) console.error('[api-keys] last_used_at update failed', touchErr.message)
    })

  const scopes = (key.scopes ?? []).filter((s): s is ApiKeyScope => VALID_SCOPES.has(s))
  return { keyId: key.id, userId: key.user_id, scopes }
}
