import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// =====================================================================
// POST /api/carts — create a cart (with optional items)
//
// Body:
// {
//   lead_id?: string,
//   thread_id?: string,
//   currency?: string,    // defaults 'USD'
//   source?: string,      // 'messenger_bot' | 'action_page' | 'web' | ...
//   items?: Array<{ name, quantity, unit_price, product_id?, image_url? }>
// }
//
// Total amount is computed server-side from items. The cart is created with
// status='active'; the workflow tick sweeps active carts that have been idle
// for >= the configured threshold and fires `cart_abandoned` triggers.
// =====================================================================

interface CartItemInput {
  name?: string
  quantity?: number
  unit_price?: number
  product_id?: string
  image_url?: string
}

interface CreateCartBody {
  lead_id?: string
  thread_id?: string
  currency?: string
  source?: string
  items?: CartItemInput[]
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: CreateCartBody
  try {
    body = (await req.json()) as CreateCartBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const items = (body.items ?? []).filter(
    (i): i is Required<Pick<CartItemInput, 'name' | 'quantity' | 'unit_price'>> & CartItemInput =>
      typeof i.name === 'string' &&
      typeof i.quantity === 'number' &&
      i.quantity > 0 &&
      typeof i.unit_price === 'number' &&
      i.unit_price >= 0,
  )

  const totalAmount = items.reduce((sum, i) => sum + i.unit_price * i.quantity, 0)

  const { data: cart, error: cartErr } = await supabase
    .from('carts')
    .insert({
      user_id: user.id,
      lead_id: body.lead_id ?? null,
      thread_id: body.thread_id ?? null,
      total_amount: totalAmount > 0 ? totalAmount : null,
      currency: body.currency ?? 'USD',
      source: body.source ?? null,
    })
    .select('id, status, total_amount, currency, source')
    .single()

  if (cartErr || !cart) {
    return NextResponse.json({ error: cartErr?.message ?? 'cart insert failed' }, { status: 500 })
  }

  if (items.length > 0) {
    const rows = items.map((i) => ({
      cart_id: cart.id,
      product_id: i.product_id ?? null,
      name: i.name,
      quantity: i.quantity,
      unit_price: i.unit_price,
      image_url: i.image_url ?? null,
    }))
    const { error: itemsErr } = await supabase.from('cart_items').insert(rows)
    if (itemsErr) {
      console.error('[carts] cart_items insert failed', itemsErr.message)
    }
  }

  return NextResponse.json({ cart })
}
