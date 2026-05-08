import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Status = 'pending' | 'snoozed' | 'sent' | 'resolved' | 'cancelled' | 'failed'

interface Patch {
  status?: Status
  scheduled_at?: string
  auto_send?: boolean
  topic?: string
  resolved_reason?: 'topic_addressed' | 'manual' | 'auto_replied'
}

const ALLOWED_STATUSES: Status[] = [
  'pending',
  'snoozed',
  'resolved',
  'cancelled',
]

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

  let body: Patch
  try {
    body = (await req.json()) as Patch
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}

  if (body.status !== undefined) {
    if (!ALLOWED_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: 'bad status' }, { status: 400 })
    }
    update.status = body.status
    if (body.status === 'resolved') {
      update.resolved_at = new Date().toISOString()
      update.resolved_reason = body.resolved_reason ?? 'manual'
    }
    if (body.status === 'cancelled') {
      update.cancelled_at = new Date().toISOString()
    }
  }

  if (body.scheduled_at !== undefined) {
    const t = new Date(body.scheduled_at)
    if (Number.isNaN(t.getTime())) {
      return NextResponse.json({ error: 'bad scheduled_at' }, { status: 400 })
    }
    update.scheduled_at = t.toISOString()
    update.job_id = null // re-eligible for cron
  }

  if (body.auto_send !== undefined) update.auto_send = !!body.auto_send

  if (body.topic !== undefined) {
    const topic = String(body.topic).trim().slice(0, 500)
    if (topic.length === 0) {
      return NextResponse.json({ error: 'empty topic' }, { status: 400 })
    }
    update.topic = topic
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('lead_reminders')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(
      'id, lead_id, scheduled_at, topic, status, auto_send, fired_at, resolved_at, created_at',
    )
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(data)
}
