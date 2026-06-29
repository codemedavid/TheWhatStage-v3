import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest'

beforeAll(() => {
  process.env.FB_APP_ID = 'app-id'
  process.env.FB_APP_SECRET = 'app-secret'
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
})

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('facebook/oauth', () => {
  it('builds a consent URL with the right scopes and redirect', async () => {
    const { buildAuthUrl } = await import('./oauth')
    const url = new URL(buildAuthUrl('signed-state'))
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v24.0/dialog/oauth')
    expect(url.searchParams.get('client_id')).toBe('app-id')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/api/auth/facebook/callback',
    )
    expect(url.searchParams.get('state')).toBe('signed-state')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe(
      'pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,pages_manage_engagement,pages_utility_messaging,business_management',
    )
  })

  it('re-requests page selection so newly added pages can be granted', async () => {
    // Without auth_type=rerequest, Facebook skips the page picker on re-connect
    // and silently reuses the previously granted pages — newly added pages never
    // get authorized, so /me/accounts keeps returning only the original page(s).
    const { buildAuthUrl } = await import('./oauth')
    const url = new URL(buildAuthUrl('signed-state'))
    expect(url.searchParams.get('auth_type')).toBe('rerequest')
  })

  it('exchanges code → short-lived token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'short-1', token_type: 'bearer' }), {
        status: 200,
      }),
    ) as unknown as typeof fetch)
    const { exchangeCodeForToken } = await import('./oauth')
    const tok = await exchangeCodeForToken('the-code')
    expect(tok).toBe('short-1')
    const calledUrl = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain('https://graph.facebook.com/v24.0/oauth/access_token')
    expect(calledUrl).toContain('code=the-code')
    expect(calledUrl).toContain('client_id=app-id')
    expect(calledUrl).toContain('client_secret=app-secret')
  })

  it('exchanges short-lived → long-lived', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'long-1', expires_in: 5184000 }), {
        status: 200,
      }),
    ) as unknown as typeof fetch)
    const { exchangeForLongLived } = await import('./oauth')
    const out = await exchangeForLongLived('short-1')
    expect(out.token).toBe('long-1')
    expect(out.expiresAt instanceof Date).toBe(true)
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain('grant_type=fb_exchange_token')
    expect(url).toContain('fb_exchange_token=short-1')
  })

  it('fetches /me id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ id: '12345' }), { status: 200 }),
    ) as unknown as typeof fetch)
    const { fetchMe } = await import('./oauth')
    expect(await fetchMe('long-1')).toBe('12345')
  })

  // Route-aware fetch stub: fetchUserPages now hits both /me/accounts and the
  // business edges (/me/businesses → owned_pages/client_pages) in parallel, so a
  // sequential shift() mock no longer models the call pattern. `route` maps a URL
  // to its JSON body; unmatched URLs default to an empty page list.
  function stubGraph(route: (url: string) => unknown): string[] {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        calls.push(url)
        const body = route(url) ?? { data: [] }
        return new Response(JSON.stringify(body), { status: 200 })
      }) as unknown as typeof fetch,
    )
    return calls
  }

  it('fetches /me/accounts pages', async () => {
    stubGraph((url) => {
      if (url.includes('/me/accounts')) {
        return {
          data: [
            { id: 'p1', name: 'Page One', category: 'Business', access_token: 'pt1', picture: { data: { url: 'https://cdn/p1.jpg' } } },
            { id: 'p2', name: 'Page Two', category: null, access_token: 'pt2' },
          ],
        }
      }
      return { data: [] }
    })
    const { fetchUserPages } = await import('./oauth')
    const pages = await fetchUserPages('long-1')
    expect(pages).toEqual([
      { id: 'p1', name: 'Page One', category: 'Business', accessToken: 'pt1', pictureUrl: 'https://cdn/p1.jpg' },
      { id: 'p2', name: 'Page Two', category: null, accessToken: 'pt2', pictureUrl: null },
    ])
  })

  it('follows paging.next to fetch all pages across multiple /me/accounts responses', async () => {
    const accountsByCursor: Record<string, unknown> = {
      start: {
        data: [
          { id: 'p1', name: 'Page 1', access_token: 'pt1' },
          { id: 'p2', name: 'Page 2', access_token: 'pt2' },
        ],
        paging: { next: 'https://graph.facebook.com/v24.0/me/accounts?after=cursor-1' },
      },
      'cursor-1': {
        data: [
          { id: 'p3', name: 'Page 3', access_token: 'pt3' },
          { id: 'p4', name: 'Page 4', access_token: 'pt4' },
        ],
        paging: { next: 'https://graph.facebook.com/v24.0/me/accounts?after=cursor-2' },
      },
      'cursor-2': {
        data: [{ id: 'p5', name: 'Page 5', access_token: 'pt5' }],
      },
    }
    stubGraph((url) => {
      if (url.includes('/me/accounts')) {
        if (url.includes('after=cursor-1')) return accountsByCursor['cursor-1']
        if (url.includes('after=cursor-2')) return accountsByCursor['cursor-2']
        return accountsByCursor.start
      }
      return { data: [] }
    })
    const { fetchUserPages } = await import('./oauth')
    const pages = await fetchUserPages('long-1')
    expect(pages.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
  })

  it('merges Business Portfolio pages that /me/accounts omits, deduped by id', async () => {
    // /me/accounts lists only pages the user has a direct personal role on.
    // Business-portfolio pages must be discovered via /me/businesses →
    // owned_pages / client_pages, then merged. p1 appears in both sources and
    // must not be duplicated; p9 is business-owned and missing from /me/accounts.
    stubGraph((url) => {
      if (url.includes('/me/accounts')) {
        return { data: [{ id: 'p1', name: 'Direct Page', access_token: 'pt1' }] }
      }
      if (url.includes('/me/businesses')) {
        return { data: [{ id: 'biz-1' }] }
      }
      if (url.includes('/biz-1/owned_pages')) {
        return {
          data: [
            { id: 'p1', name: 'Direct Page', access_token: 'pt1' },
            { id: 'p9', name: 'Business Page', category: 'Auto', access_token: 'pt9', picture: { data: { url: 'https://cdn/p9.jpg' } } },
          ],
        }
      }
      return { data: [] }
    })
    const { fetchUserPages } = await import('./oauth')
    const pages = await fetchUserPages('long-1')
    const ids = pages.map((p) => p.id)
    expect(ids).toContain('p9')
    expect(ids.filter((id) => id === 'p1')).toHaveLength(1)
    const p9 = pages.find((p) => p.id === 'p9')
    expect(p9).toEqual({
      id: 'p9',
      name: 'Business Page',
      category: 'Auto',
      accessToken: 'pt9',
      pictureUrl: 'https://cdn/p9.jpg',
    })
  })

  it('still returns /me/accounts pages when the business lookup fails', async () => {
    // Older connections (token minted before business_management was granted)
    // will 4xx on /me/businesses. That must not wipe out the primary results.
    stubGraph((url) => {
      if (url.includes('/me/accounts')) {
        return { data: [{ id: 'p1', name: 'Direct Page', access_token: 'pt1' }] }
      }
      return null // unmatched → handled below
    })
    // Re-stub with an error for business endpoints specifically.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString()
        if (url.includes('/me/businesses')) {
          return new Response(JSON.stringify({ error: { message: 'no business_management' } }), { status: 400 })
        }
        if (url.includes('/me/accounts')) {
          return new Response(JSON.stringify({ data: [{ id: 'p1', name: 'Direct Page', access_token: 'pt1' }] }), { status: 200 })
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 })
      }) as unknown as typeof fetch,
    )
    const { fetchUserPages } = await import('./oauth')
    const pages = await fetchUserPages('long-1')
    expect(pages.map((p) => p.id)).toEqual(['p1'])
  })

  it('throws on non-2xx Graph response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'bad code' } }), { status: 400 }),
    ) as unknown as typeof fetch)
    const { exchangeCodeForToken } = await import('./oauth')
    await expect(exchangeCodeForToken('bad')).rejects.toThrow()
  })
})
