import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { requireSuperadmin, AdminAuthError } from '@/lib/auth/admin-guards'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAdminAction } from '@/lib/auth/admin-audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Superadmin sets (or clears, via null) a per-tenant soft-cap override in tokens.
// null reverts the tenant to their tier's cap. Display-only — never blocks.
const bodySchema = z.object({
  includedTokensOverride: z.number().int().nonnegative().nullable(),
})

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let session
  try {
    session = await requireSuperadmin()
  } catch (e) {
    if (e instanceof AdminAuthError) return NextResponse.json({ error: e.message }, { status: e.status })
    throw e
  }

  const { id } = await ctx.params
  if (id === session.userId) {
    return NextResponse.json({ error: 'cannot modify own cap' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid cap' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: target } = await admin
    .from('profiles')
    .select('role')
    .eq('id', id)
    .maybeSingle<{ role: string }>()

  if (!target) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (target.role !== 'user') {
    return NextResponse.json({ error: 'cap applies to tenant accounts only' }, { status: 403 })
  }

  const { data, error } = await admin
    .from('profiles')
    .update({ included_tokens_override: parsed.data.includedTokensOverride })
    .eq('id', id)
    .select('id, included_tokens_override')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAdminAction(admin, {
    actorId: session.userId,
    actorEmail: session.email,
    action: 'usage.cap.set',
    targetUserId: id,
    detail: { includedTokensOverride: parsed.data.includedTokensOverride },
  })

  return NextResponse.json(data)
}
