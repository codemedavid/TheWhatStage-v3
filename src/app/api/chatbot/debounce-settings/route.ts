import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  DEFAULT_MESSAGE_DEBOUNCE_SECONDS,
  MAX_MESSAGE_DEBOUNCE_SECONDS,
} from '@/lib/chatbot/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BODY_SCHEMA = z.object({
  message_debounce_seconds: z
    .number()
    .int('must be an integer')
    .min(0, 'must be ≥ 0')
    .max(MAX_MESSAGE_DEBOUNCE_SECONDS, `must be ≤ ${MAX_MESSAGE_DEBOUNCE_SECONDS}`),
})

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('chatbot_configs')
    .select('message_debounce_seconds')
    .eq('user_id', user.id)
    .maybeSingle<{ message_debounce_seconds: number }>()

  return NextResponse.json({
    message_debounce_seconds: data?.message_debounce_seconds ?? DEFAULT_MESSAGE_DEBOUNCE_SECONDS,
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
    return NextResponse.json({ error: first.message, path: first.path }, { status: 400 })
  }

  const { error } = await supabase.from('chatbot_configs').upsert(
    { user_id: user.id, message_debounce_seconds: parsed.data.message_debounce_seconds },
    { onConflict: 'user_id' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    message_debounce_seconds: parsed.data.message_debounce_seconds,
  })
}
