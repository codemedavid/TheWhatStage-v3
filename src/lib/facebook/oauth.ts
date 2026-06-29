const GRAPH = 'https://graph.facebook.com/v24.0'
const DIALOG = 'https://www.facebook.com/v24.0/dialog/oauth'
// `pages_utility_messaging` is required for the Message Templates API (creating
// & sending UTILITY templates). Without it in the granted scope, template
// creation fails with Meta error code 200 even when the app holds standard
// access — the token simply doesn't carry the permission. Pages connected
// before this scope was added must re-connect to mint a token that includes it.
// `business_management` lets us read the pages owned by a Business Portfolio via
// /me/businesses → owned_pages/client_pages. Without it, /me/accounts only
// returns pages the user has a *direct personal* role on, so business-managed
// pages (the common case for anyone using Meta Business Suite) never appear in
// the picker. See https://developers.facebook.com/docs/pages-api
const SCOPES =
  'pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,pages_manage_engagement,pages_utility_messaging,business_management'

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
  // `auth_type=rerequest` forces Facebook to show the page-selection screen on
  // every connect. Without it, re-connecting an already-authorized app reuses
  // the previously granted page set and silently skips the picker — so pages
  // the user added after the first connect never get authorized and never
  // appear in /me/accounts. See https://developers.facebook.com/docs/pages-api
  u.searchParams.set('auth_type', 'rerequest')
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

const PAGE_FIELDS = 'id,name,category,access_token,picture{url}'

type PageRow = {
  id: string
  name: string
  category?: string | null
  access_token?: string
  picture?: { data?: { url?: string } }
}

function pageRowToPage(p: PageRow): FacebookPage {
  return {
    id: p.id,
    name: p.name,
    category: p.category ?? null,
    accessToken: p.access_token ?? '',
    pictureUrl: p.picture?.data?.url ?? null,
  }
}

// Walk a paginated Graph edge, following paging.next. Capped at 20 pages of 100
// (2000 rows) — well past any real account.
async function fetchAllRows<T>(startUrl: string): Promise<T[]> {
  type Resp = { data: T[]; paging?: { next?: string } }
  const out: T[] = []
  let next: string | undefined = startUrl
  for (let i = 0; next && i < 20; i++) {
    const page: Resp = await getJson<Resp>(next)
    out.push(...page.data)
    next = page.paging?.next
  }
  return out
}

function edgeUrl(path: string, token: string): string {
  const u = new URL(`${GRAPH}/${path}`)
  u.searchParams.set('fields', PAGE_FIELDS)
  u.searchParams.set('limit', '100')
  u.searchParams.set('access_token', token)
  return u.toString()
}

// Pages the user has a direct personal role on.
async function fetchAccountsPages(token: string): Promise<PageRow[]> {
  return fetchAllRows<PageRow>(edgeUrl('me/accounts', token))
}

// Pages owned/managed through the user's Business Portfolios. /me/accounts omits
// these, so anyone managing pages via Meta Business Suite needs this path. Every
// step is best-effort: a token without business_management 4xxs on /me/businesses,
// and that must never wipe out the /me/accounts results.
async function fetchBusinessPages(token: string): Promise<PageRow[]> {
  let businesses: Array<{ id: string }>
  try {
    const bu = new URL(`${GRAPH}/me/businesses`)
    bu.searchParams.set('fields', 'id')
    bu.searchParams.set('limit', '100')
    bu.searchParams.set('access_token', token)
    businesses = await fetchAllRows<{ id: string }>(bu.toString())
  } catch {
    return []
  }

  const out: PageRow[] = []
  for (const biz of businesses) {
    for (const edge of ['owned_pages', 'client_pages']) {
      try {
        out.push(...(await fetchAllRows<PageRow>(edgeUrl(`${biz.id}/${edge}`, token))))
      } catch {
        // One inaccessible edge shouldn't drop the rest.
      }
    }
  }
  return out
}

export async function fetchUserPages(longLivedToken: string): Promise<FacebookPage[]> {
  const [accounts, business] = await Promise.all([
    fetchAccountsPages(longLivedToken),
    fetchBusinessPages(longLivedToken),
  ])

  const seen = new Set<string>()
  const out: FacebookPage[] = []
  // /me/accounts first so a directly-managed page's token wins over a business
  // edge's (which may omit access_token). Skip rows without a usable token —
  // we can't subscribe webhooks or send without one.
  for (const row of [...accounts, ...business]) {
    if (!row.access_token || seen.has(row.id)) continue
    seen.add(row.id)
    out.push(pageRowToPage(row))
  }
  return out
}
