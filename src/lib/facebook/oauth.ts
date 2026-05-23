const GRAPH = 'https://graph.facebook.com/v24.0'
const DIALOG = 'https://www.facebook.com/v24.0/dialog/oauth'
const SCOPES =
  'pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,pages_manage_engagement'

export type FacebookPage = {
  id: string
  name: string
  category: string | null
  accessToken: string
  pictureUrl: string | null
}

function appId(): string {
  const v = process.env.FB_APP_ID
  if (!v) throw new Error('FB_APP_ID is required')
  return v
}
function appSecret(): string {
  const v = process.env.FB_APP_SECRET
  if (!v) throw new Error('FB_APP_SECRET is required')
  return v
}
function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL
  if (!base) throw new Error('NEXT_PUBLIC_APP_URL is required')
  return `${base}/api/auth/facebook/callback`
}

export function buildAuthUrl(state: string): string {
  const u = new URL(DIALOG)
  u.searchParams.set('client_id', appId())
  u.searchParams.set('redirect_uri', redirectUri())
  u.searchParams.set('state', state)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', SCOPES)
  return u.toString()
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Graph API ${res.status}: ${body}`)
  }
  return (await res.json()) as T
}

export async function exchangeCodeForToken(code: string): Promise<string> {
  const u = new URL(`${GRAPH}/oauth/access_token`)
  u.searchParams.set('client_id', appId())
  u.searchParams.set('client_secret', appSecret())
  u.searchParams.set('redirect_uri', redirectUri())
  u.searchParams.set('code', code)
  const data = await getJson<{ access_token: string }>(u.toString())
  return data.access_token
}

export async function exchangeForLongLived(
  shortLived: string,
): Promise<{ token: string; expiresAt: Date | null }> {
  const u = new URL(`${GRAPH}/oauth/access_token`)
  u.searchParams.set('grant_type', 'fb_exchange_token')
  u.searchParams.set('client_id', appId())
  u.searchParams.set('client_secret', appSecret())
  u.searchParams.set('fb_exchange_token', shortLived)
  const data = await getJson<{ access_token: string; expires_in?: number }>(u.toString())
  const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null
  return { token: data.access_token, expiresAt }
}

export async function fetchMe(longLivedToken: string): Promise<string> {
  const u = new URL(`${GRAPH}/me`)
  u.searchParams.set('fields', 'id')
  u.searchParams.set('access_token', longLivedToken)
  const data = await getJson<{ id: string }>(u.toString())
  return data.id
}

export async function fetchUserPages(longLivedToken: string): Promise<FacebookPage[]> {
  const u = new URL(`${GRAPH}/me/accounts`)
  u.searchParams.set('fields', 'id,name,category,access_token,picture{url}')
  u.searchParams.set('access_token', longLivedToken)
  const data = await getJson<{
    data: Array<{
      id: string
      name: string
      category?: string | null
      access_token: string
      picture?: { data?: { url?: string } }
    }>
  }>(u.toString())
  return data.data.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category ?? null,
    accessToken: p.access_token,
    pictureUrl: p.picture?.data?.url ?? null,
  }))
}
