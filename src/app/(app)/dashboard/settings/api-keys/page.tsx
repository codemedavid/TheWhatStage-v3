import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { createClient } from '@/lib/supabase/server'
import { ApiKeysPanel, type ApiKeyListItem } from './_components/api-keys-panel'
import { ConnectedAppsPanel } from './_components/connected-apps-panel'
import { groupGrantsByClient, type GrantRow } from './_lib/connected-apps'

function mcpEndpointUrl(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  return `${base}/api/mcp`
}

export default async function ApiKeysSettingsPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = await createClient()
  const { data } = await supabase
    .from('api_keys')
    .select('id, name, key_prefix, scopes, last_used_at, revoked_at, created_at')
    .eq('user_id', session.userId)
    .order('created_at', { ascending: false })

  const keys: ApiKeyListItem[] = (data ?? []).map((k) => ({
    id: k.id as string,
    name: k.name as string,
    prefix: k.key_prefix as string,
    scopes: (k.scopes as string[] | null) ?? [],
    lastUsedAt: (k.last_used_at as string | null) ?? null,
    revokedAt: (k.revoked_at as string | null) ?? null,
    createdAt: k.created_at as string,
  }))

  const { data: grants } = await supabase
    .from('oauth_tokens')
    .select('client_id, scopes, created_at, last_used_at, oauth_clients(client_name)')
    .eq('user_id', session.userId)
    .is('revoked_at', null)
    .gt('refresh_expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
  const apps = groupGrantsByClient((grants ?? []) as GrantRow[])

  return (
    <ApiKeysPanel
      keys={keys}
      endpointUrl={mcpEndpointUrl()}
      connectedApps={<ConnectedAppsPanel apps={apps} />}
    />
  )
}
