import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import {
  DEFAULT_CHATBOT_CONFIG,
  MIN_REPLY_MAX_SENTENCES,
  MAX_REPLY_MAX_SENTENCES,
  coerceStructuredLayout,
  setStructuredMessageSettings,
} from '@/lib/chatbot/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BODY_SCHEMA = z
  .object({
    structured_messages_enabled: z.boolean().optional(),
    structured_message_layout: z.enum(['single', 'bubbles']).optional(),
    reply_length_limit_enabled: z.boolean().optional(),
    reply_max_sentences: z
      .number()
      .int('must be an integer')
      .min(MIN_REPLY_MAX_SENTENCES, `must be ≥ ${MIN_REPLY_MAX_SENTENCES}`)
      .max(MAX_REPLY_MAX_SENTENCES, `must be ≤ ${MAX_REPLY_MAX_SENTENCES}`)
      .optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'no fields to update' })

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('chatbot_configs')
    .select(
      'structured_messages_enabled, structured_message_layout, reply_length_limit_enabled, reply_max_sentences',
    )
    .eq('user_id', user.id)
    .maybeSingle<{
      structured_messages_enabled: boolean | null
      structured_message_layout: string | null
      reply_length_limit_enabled: boolean | null
      reply_max_sentences: number | null
    }>()

  return NextResponse.json({
    structured_messages_enabled:
      data?.structured_messages_enabled ?? DEFAULT_CHATBOT_CONFIG.structuredMessagesEnabled,
    structured_message_layout: coerceStructuredLayout(data?.structured_message_layout),
    reply_length_limit_enabled:
      data?.reply_length_limit_enabled ?? DEFAULT_CHATBOT_CONFIG.replyLengthLimitEnabled,
    reply_max_sentences: data?.reply_max_sentences ?? DEFAULT_CHATBOT_CONFIG.replyMaxSentences,
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
    await setStructuredMessageSettings(supabase, user.id, {
      structuredEnabled: parsed.data.structured_messages_enabled,
      layout: parsed.data.structured_message_layout,
      lengthLimitEnabled: parsed.data.reply_length_limit_enabled,
      maxSentences: parsed.data.reply_max_sentences,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'save failed' },
      { status: 500 },
    )
  }

  return NextResponse.json(parsed.data)
}
