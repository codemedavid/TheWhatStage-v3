import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  FOLLOWUP_SETTINGS_SCHEMA,
  loadFollowupSettings,
} from '@/lib/followups/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const settings = await loadFollowupSettings(supabase, user.id)
  return NextResponse.json({ settings })
}

export async function PUT(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: { settings?: unknown }
  try {
    body = (await req.json()) as { settings?: unknown }
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const parsed = FOLLOWUP_SETTINGS_SCHEMA.safeParse(body.settings)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return NextResponse.json(
      { error: first.message, path: first.path },
      { status: 400 },
    )
  }

  const { error } = await supabase.from('chatbot_configs').upsert(
    { user_id: user.id, followup_settings: parsed.data },
    { onConflict: 'user_id' },
  )
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ settings: parsed.data })
}
