import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// =====================================================================
// PATCH /api/carts/[id] — update lead / thread / status / total
// Useful when an action-page submit later attaches a lead to a cart that
// was created anonymously, or to manually mark abandoned/converted.
// =====================================================================

interface UpdateCartBody {
  lead_id?: string | null
  thread_id?: string | null
  status?: 'active' | 'abandoned' | 'converted'
  total_amount?: number | null
  currency?: string
  source?: string | null
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: UpdateCartBody
  try {
    body = (await req.json()) as UpdateCartBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if ('lead_id' in body) updates.lead_id = body.lead_id
  if ('thread_id' in body) updates.thread_id = body.thread_id
  if ('total_amount' in body) updates.total_amount = body.total_amount
  if ('currency' in body) updates.currency = body.currency
  if ('source' in body) updates.source = body.source
  if (body.status) {
    updates.status = body.status
    if (body.status === 'converted') updates.converted_at = new Date().toISOString()
    if (body.status === 'abandoned') updates.abandoned_at = new Date().toISOString()
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'no updates supplied' }, { status: 400 })
  }

  const { data: cart, error } = await supabase
    .from('carts')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, status, total_amount, currency, source')
    .maybeSingle()

  if (error || !cart) {
    return NextResponse.json({ error: error?.message ?? 'not found' }, { status: 404 })
  }

  return NextResponse.json({ cart })
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('carts')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deleted: true })
}
