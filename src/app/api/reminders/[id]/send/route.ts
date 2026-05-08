import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { fireReminder } from '@/lib/reminders/fire'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  // RLS-checked ownership: confirm the reminder belongs to this user
  // before invoking the admin-client send pipeline.
  const { data: owned } = await supabase
    .from('lead_reminders')
    .select('id')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!owned) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const admin = createAdminClient()
  const result = await fireReminder(admin, id)

  return NextResponse.json({ ok: result.ok, reason: result.reason ?? null })
}
