import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface PatchBody {
  status?: 'cancelled'
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const { data: sequence, error } = await supabase
    .from('lead_reminder_sequences')
    .select(
      'id, lead_id, thread_id, anchor_at, topic, status, resolved_at, resolved_reason, cancelled_at, created_at',
    )
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!sequence) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const { data: touchpoints } = await supabase
    .from('lead_reminders')
    .select(
      'id, sequence_position, scheduled_at, status, pre_generated_text, fallback_text, fired_at',
    )
    .eq('sequence_id', id)
    .order('sequence_position', { ascending: true })

  return NextResponse.json({ sequence, touchpoints: touchpoints ?? [] })
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  if (body.status !== 'cancelled') {
    return NextResponse.json({ error: 'only status=cancelled supported' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('lead_reminder_sequences')
    .update({
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      resolved_reason: 'manual',
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, status, cancelled_at')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(data)
}
