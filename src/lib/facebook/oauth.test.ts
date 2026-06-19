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
      'pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,pages_manage_engagement,pages_utility_messaging',
    )
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

  it('fetches /me/accounts pages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        data: [
          { id: 'p1', name: 'Page One', category: 'Business', access_token: 'pt1', picture: { data: { url: 'https://cdn/p1.jpg' } } },
          { id: 'p2', name: 'Page Two', category: null, access_token: 'pt2' },
        ],
      }), { status: 200 }),
    ) as unknown as typeof fetch)
    const { fetchUserPages } = await import('./oauth')
    const pages = await fetchUserPages('long-1')
    expect(pages).toEqual([
      { id: 'p1', name: 'Page One', category: 'Business', accessToken: 'pt1', pictureUrl: 'https://cdn/p1.jpg' },
      { id: 'p2', name: 'Page Two', category: null, accessToken: 'pt2', pictureUrl: null },
    ])
  })

  it('follows paging.next to fetch all pages across multiple responses', async () => {
    const responses: Array<{ body: unknown }> = [
      {
        body: {
          data: [
            { id: 'p1', name: 'Page 1', access_token: 'pt1' },
            { id: 'p2', name: 'Page 2', access_token: 'pt2' },
          ],
          paging: {
            next: 'https://graph.facebook.com/v24.0/me/accounts?after=cursor-1',
          },
        },
      },
      {
        body: {
          data: [
            { id: 'p3', name: 'Page 3', access_token: 'pt3' },
            { id: 'p4', name: 'Page 4', access_token: 'pt4' },
          ],
          paging: {
            next: 'https://graph.facebook.com/v24.0/me/accounts?after=cursor-2',
          },
        },
      },
      {
        body: {
          data: [{ id: 'p5', name: 'Page 5', access_token: 'pt5' }],
        },
      },
    ]
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(typeof input === 'string' ? input : input.toString())
        const next = responses.shift()
        if (!next) throw new Error('unexpected extra fetch call')
        return new Response(JSON.stringify(next.body), { status: 200 })
      }) as unknown as typeof fetch,
    )
    const { fetchUserPages } = await import('./oauth')
    const pages = await fetchUserPages('long-1')
    expect(pages.map((p) => p.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
    expect(calls).toHaveLength(3)
    expect(calls[0]).toContain('limit=100')
    expect(calls[1]).toBe('https://graph.facebook.com/v24.0/me/accounts?after=cursor-1')
    expect(calls[2]).toBe('https://graph.facebook.com/v24.0/me/accounts?after=cursor-2')
  })

  it('throws on non-2xx Graph response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'bad code' } }), { status: 400 }),
    ) as unknown as typeof fetch)
    const { exchangeCodeForToken } = await import('./oauth')
    await expect(exchangeCodeForToken('bad')).rejects.toThrow()
  })
})
