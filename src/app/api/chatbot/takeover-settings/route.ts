import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BODY_SCHEMA = z.object({
  human_takeover_minutes: z
    .number()
    .int('must be an integer')
    .min(0, 'must be ≥ 0')
    .max(1440, 'must be ≤ 1440 (24h)'),
})

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('chatbot_configs')
    .select('human_takeover_minutes')
    .eq('user_id', user.id)
    .maybeSingle<{ human_takeover_minutes: number }>()

  return NextResponse.json({
    human_takeover_minutes: data?.human_takeover_minutes ?? 60,
  })
}

export async function PUT(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const parsed = BODY_SCHEMA.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return NextResponse.json(
      { error: first.message, path: first.path },
      { status: 400 },
    )
  }

  const { error } = await supabase.from('chatbot_configs').upsert(
    { user_id: user.id, human_takeover_minutes: parsed.data.human_takeover_minutes },
    { onConflict: 'user_id' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    human_takeover_minutes: parsed.data.human_takeover_minutes,
  })
}
