import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  DEFAULT_CHATBOT_CONFIG,
  MIN_SPLIT_MAX_BUBBLES,
  MAX_SPLIT_MAX_BUBBLES,
  setSplitMessageSettings,
} from '@/lib/chatbot/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BODY_SCHEMA = z.object({
  split_messages_enabled: z.boolean(),
  split_max_bubbles: z
    .number()
    .int('must be an integer')
    .min(MIN_SPLIT_MAX_BUBBLES, `must be ≥ ${MIN_SPLIT_MAX_BUBBLES}`)
    .max(MAX_SPLIT_MAX_BUBBLES, `must be ≤ ${MAX_SPLIT_MAX_BUBBLES}`)
    .optional(),
})

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('chatbot_configs')
    .select('split_messages_enabled, split_max_bubbles')
    .eq('user_id', user.id)
    .maybeSingle<{ split_messages_enabled: boolean | null; split_max_bubbles: number | null }>()

  return NextResponse.json({
    split_messages_enabled:
      data?.split_messages_enabled ?? DEFAULT_CHATBOT_CONFIG.splitMessagesEnabled,
    split_max_bubbles: data?.split_max_bubbles ?? DEFAULT_CHATBOT_CONFIG.splitMaxBubbles,
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

  try {
    await setSplitMessageSettings(supabase, user.id, {
      enabled: parsed.data.split_messages_enabled,
      maxBubbles: parsed.data.split_max_bubbles,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'save failed' },
      { status: 500 },
    )
  }

  return NextResponse.json({
    split_messages_enabled: parsed.data.split_messages_enabled,
    ...(parsed.data.split_max_bubbles !== undefined
      ? { split_max_bubbles: parsed.data.split_max_bubbles }
      : {}),
  })
}
