import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/get-session'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Superadmin grants/revokes the University "subscriber" tier for a regular user.
// Staff (admin/superadmin) are subscribers by role, so their tier is not editable here.
const bodySchema = z.object({
  tier: z.enum(['free', 'pro']),
})

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  if (session.role !== 'superadmin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const { id } = await ctx.params
  if (id === session.userId) {
    return NextResponse.json({ error: 'cannot modify own tier' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid tier' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: target } = await admin
    .from('profiles')
    .select('role')
    .eq('id', id)
    .maybeSingle<{ role: string }>()

  if (!target) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  if (target.role !== 'user') {
    return NextResponse.json({ error: 'tier is role-derived for staff accounts' }, { status: 403 })
  }

  const { data, error } = await admin
    .from('profiles')
    .update({ subscription_tier: parsed.data.tier })
    .eq('id', id)
    .select('id, subscription_tier, role, email, full_name')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}
