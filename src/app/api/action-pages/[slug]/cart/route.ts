import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyDeeplink } from '@/lib/action-pages/signing'
import {
  loadActiveVisitorCart,
  replaceVisitorCart,
  type VisitorCartContext,
  type VisitorCartItem,
} from '@/lib/action-pages/visitor-cart'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface PageRow {
  id: string
  user_id: string
  status: string
  signing_secret: string
}

async function loadPage(slug: string): Promise<{
  admin: ReturnType<typeof createAdminClient>
  page: PageRow | null
}> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('action_pages')
    .select('id, user_id, status, signing_secret')
    .eq('slug', slug)
    .maybeSingle<PageRow>()
  return { admin, page: data ?? null }
}

function readClaims(url: URL, slug: string, secret: string) {
  const p = url.searchParams.get('p')
  const g = url.searchParams.get('g')
  const e = url.searchParams.get('e')
  const t = url.searchParams.get('t')
  if (!p || !g || !e || !t) return null
  const v = verifyDeeplink(secret, slug, { p, g, e, t })
  return v.ok && v.claims ? v.claims : null
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params
  const { admin, page } = await loadPage(slug)
  if (!page || page.status !== 'published') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  const claims = readClaims(new URL(req.url), slug, page.signing_secret)
  if (!claims) return NextResponse.json({ items: [] })

  const cartCtx: VisitorCartContext = {
    actionPageId: page.id,
    psid: claims.psid,
    pageOwnerId: page.user_id,
    fbPageId: claims.pageId,
  }
  try {
    const cart = await loadActiveVisitorCart(admin as any, cartCtx)
    return NextResponse.json(cart)
  } catch {
    return NextResponse.json({ items: [] })
  }
}

interface PutBody {
  items?: VisitorCartItem[]
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params
  const { admin, page } = await loadPage(slug)
  if (!page || page.status !== 'published') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  let body: PutBody
  try {
    body = (await req.json()) as PutBody
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const items = Array.isArray(body.items)
    ? body.items
        .filter((i): i is VisitorCartItem => !!i && typeof i.id === 'string' && typeof i.quantity === 'number')
        .map((i) => ({ id: i.id, quantity: i.quantity }))
    : []

  const claims = readClaims(new URL(req.url), slug, page.signing_secret)
  if (!claims) return NextResponse.json({ skipped: true })

  const cartCtx: VisitorCartContext = {
    actionPageId: page.id,
    psid: claims.psid,
    pageOwnerId: page.user_id,
    fbPageId: claims.pageId,
  }
  try {
    await replaceVisitorCart(admin as any, cartCtx, items)
    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('[carts] PUT failed', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'write_failed' }, { status: 500 })
  }
}
