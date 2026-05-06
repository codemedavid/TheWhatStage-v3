import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// =====================================================================
// POST /api/carts/[id]/convert — mark a cart as converted (purchase done)
// Idempotent: a cart already in 'converted' state is a no-op success.
// Once converted, the sweep will skip it (status filter), so the
// `cart_abandoned` trigger will not fire.
// =====================================================================

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: cart, error } = await supabase
    .from('carts')
    .update({ status: 'converted', converted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .in('status', ['active', 'abandoned'])
    .select('id, status, converted_at')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!cart) return NextResponse.json({ error: 'not found or already converted' }, { status: 404 })
  return NextResponse.json({ cart })
}
