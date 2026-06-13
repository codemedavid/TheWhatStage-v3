import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth/get-session'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auth/admin-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Superadmin can move a user to active (approve a pending signup, or resume
// after a pause) or to paused (kill-switch login + bot). `pending` is only
// produced by signups — there's no "un-approve" transition.
const bodySchema = z.object({
  status: z.enum(['active', 'paused']),
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
    return NextResponse.json({ error: 'cannot modify own status' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Refuse to pause a fellow superadmin — keeps the kill-switch from turning
  // into an all-admins-locked-out incident.
  const { data: target } = await admin
    .from('profiles')
    .select('role, status')
    .eq('id', id)
    .maybeSingle<{ role: string; status: string }>()

  if (!target) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  if (target.role === 'superadmin') {
    return NextResponse.json({ error: 'cannot modify another superadmin' }, { status: 403 })
  }

  const { data, error } = await admin
    .from('profiles')
    .update({ status: parsed.data.status })
    .eq('id', id)
    .select('id, status, role, email, full_name')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await logAdminAction(admin, {
    actorId: session.userId,
    actorEmail: session.email,
    action: 'user.status.set',
    targetUserId: id,
    detail: { status: parsed.data.status, previousStatus: target.status },
  })

  return NextResponse.json(data)
}
