import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))
vi.mock('@/lib/action-pages/visitor-cart', () => ({
  loadActiveVisitorCart: vi.fn(),
  replaceVisitorCart: vi.fn(),
}))
vi.mock('@/lib/action-pages/signing', () => ({
  verifyDeeplink: vi.fn(),
}))

import { GET, PUT } from './route'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadActiveVisitorCart, replaceVisitorCart } from '@/lib/action-pages/visitor-cart'
import { verifyDeeplink } from '@/lib/action-pages/signing'

function pageFixture() {
  return { id: 'page-1', user_id: 'owner-1', status: 'published', signing_secret: 'secret' }
}

function adminFor(page: ReturnType<typeof pageFixture> | null) {
  const maybySingle = vi.fn().mockResolvedValue({ data: page, error: null })
  const eq = vi.fn().mockReturnValue({ maybeSingle: maybySingle })
  const select = vi.fn().mockReturnValue({ eq })
  return { from: vi.fn().mockReturnValue({ select }) } as unknown as ReturnType<typeof createAdminClient>
}

beforeEach(() => { vi.resetAllMocks() })

describe('GET /api/action-pages/[slug]/cart', () => {
  it('returns empty items when claims are missing', async () => {
    vi.mocked(createAdminClient).mockReturnValue(adminFor(pageFixture()))
    const req = new Request('http://test/api/action-pages/s/cart')
    const res = await GET(req, { params: Promise.resolve({ slug: 's' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ items: [] })
    expect(loadActiveVisitorCart).not.toHaveBeenCalled()
  })

  it('returns empty items when verifyDeeplink fails', async () => {
    vi.mocked(createAdminClient).mockReturnValue(adminFor(pageFixture()))
    vi.mocked(verifyDeeplink).mockReturnValue({ ok: false, reason: 'expired' })
    const req = new Request('http://test/api/action-pages/s/cart?p=PSID&g=fb&e=1&t=tok')
    const res = await GET(req, { params: Promise.resolve({ slug: 's' }) })
    const body = await res.json()
    expect(body).toEqual({ items: [] })
  })

  it('returns saved items when claims valid', async () => {
    vi.mocked(createAdminClient).mockReturnValue(adminFor(pageFixture()))
    vi.mocked(verifyDeeplink).mockReturnValue({ ok: true, claims: { slug: 's', psid: 'PSID', pageId: 'fb', exp: 9 } })
    vi.mocked(loadActiveVisitorCart).mockResolvedValue({ items: [{ id: 'prod-1', quantity: 2 }] })
    const req = new Request('http://test/api/action-pages/s/cart?p=PSID&g=fb&e=9&t=tok')
    const res = await GET(req, { params: Promise.resolve({ slug: 's' }) })
    const body = await res.json()
    expect(body).toEqual({ items: [{ id: 'prod-1', quantity: 2 }] })
  })

  it('returns 404 when page not published', async () => {
    vi.mocked(createAdminClient).mockReturnValue(adminFor(null))
    const req = new Request('http://test/api/action-pages/s/cart')
    const res = await GET(req, { params: Promise.resolve({ slug: 's' }) })
    expect(res.status).toBe(404)
  })
})

describe('PUT /api/action-pages/[slug]/cart', () => {
  it('skips when claims missing', async () => {
    vi.mocked(createAdminClient).mockReturnValue(adminFor(pageFixture()))
    const req = new Request('http://test/api/action-pages/s/cart', {
      method: 'PUT',
      body: JSON.stringify({ items: [{ id: 'prod-1', quantity: 1 }] }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await PUT(req, { params: Promise.resolve({ slug: 's' }) })
    const body = await res.json()
    expect(body).toEqual({ skipped: true })
    expect(replaceVisitorCart).not.toHaveBeenCalled()
  })

  it('writes when claims valid', async () => {
    vi.mocked(createAdminClient).mockReturnValue(adminFor(pageFixture()))
    vi.mocked(verifyDeeplink).mockReturnValue({ ok: true, claims: { slug: 's', psid: 'PSID', pageId: 'fb', exp: 9 } })
    vi.mocked(replaceVisitorCart).mockResolvedValue(undefined)
    const req = new Request('http://test/api/action-pages/s/cart?p=PSID&g=fb&e=9&t=tok', {
      method: 'PUT',
      body: JSON.stringify({ items: [{ id: 'prod-1', quantity: 2 }] }),
      headers: { 'content-type': 'application/json' },
    })
    const res = await PUT(req, { params: Promise.resolve({ slug: 's' }) })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(replaceVisitorCart).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actionPageId: 'page-1', psid: 'PSID', pageOwnerId: 'owner-1', fbPageId: 'fb' }),
      [{ id: 'prod-1', quantity: 2 }],
    )
  })

  it('rejects invalid JSON', async () => {
    vi.mocked(createAdminClient).mockReturnValue(adminFor(pageFixture()))
    const req = new Request('http://test/api/action-pages/s/cart', {
      method: 'PUT', body: 'not json', headers: { 'content-type': 'application/json' },
    })
    const res = await PUT(req, { params: Promise.resolve({ slug: 's' }) })
    expect(res.status).toBe(400)
  })
})
