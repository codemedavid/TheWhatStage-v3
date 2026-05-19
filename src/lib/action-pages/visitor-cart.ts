import type { SupabaseClient } from '@supabase/supabase-js'

export interface VisitorCartItem {
  id: string        // product_id
  quantity: number
}

export interface VisitorCartContext {
  actionPageId: string
  psid: string
  pageOwnerId: string
  fbPageId: string | null
}

interface CartRow {
  id: string
  currency: string | null
  status: string
}

async function findActiveCartId(
  admin: SupabaseClient,
  ctx: VisitorCartContext,
): Promise<CartRow | null> {
  const { data } = await admin
    .from('carts')
    .select('id, currency, status')
    .eq('action_page_id', ctx.actionPageId)
    .eq('psid', ctx.psid)
    .eq('status', 'active')
    .maybeSingle<CartRow>()
  return data
}

async function resolveLeadId(
  admin: SupabaseClient,
  ctx: VisitorCartContext,
): Promise<string | null> {
  if (!ctx.fbPageId) return null
  const { data } = await admin
    .from('messenger_threads')
    .select('lead_id')
    .eq('page_id', ctx.fbPageId)
    .eq('psid', ctx.psid)
    .maybeSingle<{ lead_id: string | null }>()
  return data?.lead_id ?? null
}

export async function loadActiveVisitorCart(
  admin: SupabaseClient,
  ctx: VisitorCartContext,
): Promise<{ items: VisitorCartItem[] }> {
  const cart = await findActiveCartId(admin, ctx)
  if (!cart) return { items: [] }

  const { data } = await admin
    .from('cart_items')
    .select('product_id, quantity')
    .eq('cart_id', cart.id)

  const items: VisitorCartItem[] = (data ?? [])
    .map((row) => ({
      id: (row.product_id as string | null) ?? '',
      quantity: Number(row.quantity ?? 0),
    }))
    .filter((i) => i.id && i.quantity > 0)

  return { items }
}

interface ProductRow {
  id: string
  title: string
  price_amount: number | null
  currency: string
  cover_image_url: string | null
}

async function fetchProducts(
  admin: SupabaseClient,
  pageOwnerId: string,
  ids: string[],
): Promise<Map<string, ProductRow>> {
  if (ids.length === 0) return new Map()
  const { data } = await admin
    .from('business_items')
    .select('id, title, price_amount, currency, cover_image_url')
    .eq('user_id', pageOwnerId)
    .eq('status', 'published')
    .in('id', ids)
  const map = new Map<string, ProductRow>()
  for (const row of data ?? []) {
    map.set(row.id as string, {
      id: row.id as string,
      title: row.title as string,
      price_amount:
        row.price_amount === null || row.price_amount === undefined
          ? null
          : Number(row.price_amount),
      currency: (row.currency as string) ?? 'USD',
      cover_image_url: (row.cover_image_url as string | null) ?? null,
    })
  }
  return map
}

export async function replaceVisitorCart(
  admin: SupabaseClient,
  ctx: VisitorCartContext,
  items: VisitorCartItem[],
): Promise<void> {
  const clean = items
    .filter((i) => typeof i.id === 'string' && i.id && Number.isFinite(i.quantity) && i.quantity > 0)
    .map((i) => ({ id: i.id, quantity: Math.min(999, Math.floor(i.quantity)) }))

  const productMap = await fetchProducts(admin, ctx.pageOwnerId, clean.map((i) => i.id))
  const lines = clean
    .filter((i) => productMap.has(i.id))
    .map((i) => {
      const p = productMap.get(i.id)!
      return {
        product_id: p.id,
        name: p.title,
        quantity: i.quantity,
        unit_price: p.price_amount ?? 0,
        image_url: p.cover_image_url,
        currency: p.currency,
      }
    })

  const total = lines.reduce((sum, l) => sum + l.unit_price * l.quantity, 0)
  const currency = lines[0]?.currency ?? 'USD'

  let cart = await findActiveCartId(admin, ctx)
  if (!cart) {
    const leadId = await resolveLeadId(admin, ctx)
    const { data: inserted } = await admin
      .from('carts')
      .insert({
        user_id: ctx.pageOwnerId,
        action_page_id: ctx.actionPageId,
        psid: ctx.psid,
        lead_id: leadId,
        source: 'action_page',
        status: 'active',
        currency,
        total_amount: total > 0 ? total : null,
      })
      .select('id, currency, status')
      .single<CartRow>()
    cart = inserted
  }
  if (!cart) return

  await admin.from('cart_items').delete().eq('cart_id', cart.id)

  if (lines.length > 0) {
    await admin.from('cart_items').insert(
      lines.map((l) => ({
        cart_id: cart!.id,
        product_id: l.product_id,
        name: l.name,
        quantity: l.quantity,
        unit_price: l.unit_price,
        image_url: l.image_url,
      })),
    )
  }

  await admin
    .from('carts')
    .update({ total_amount: total > 0 ? total : null, currency })
    .eq('id', cart.id)
}

export async function convertVisitorCart(
  admin: SupabaseClient,
  ctx: VisitorCartContext,
): Promise<void> {
  const cart = await findActiveCartId(admin, ctx)
  if (!cart) return
  await admin
    .from('carts')
    .update({ status: 'converted', converted_at: new Date().toISOString() })
    .eq('id', cart.id)
}
