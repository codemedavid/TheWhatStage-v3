import { after, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface DueReminder {
  id: string
  user_id: string
  thread_id: string | null
}

export async function GET(req: Request): Promise<NextResponse> {
  const isDev = process.env.NODE_ENV !== 'production'
  if (!isDev) {
    const auth = req.headers.get('authorization')
    const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
    if (!process.env.CRON_SECRET || auth !== expected) {
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  // Auto-send reminders that are due, have a thread, and haven't been queued yet.
  const { data: due, error } = await admin
    .from('lead_reminders')
    .select('id, user_id, thread_id')
    .eq('status', 'pending')
    .eq('auto_send', true)
    .is('job_id', null)
    .not('thread_id', 'is', null)
    .lte('scheduled_at', now)
    .limit(50)

  if (error) {
    console.error('[cron.reminders-tick] query failed', error.message)
    return NextResponse.json({ enqueued: 0, error: error.message }, { status: 200 })
  }

  const rows = (due ?? []) as DueReminder[]
  let enqueued = 0

  for (const r of rows) {
    if (!r.thread_id) continue

    const { data: job, error: jobErr } = await admin
      .from('messenger_jobs')
      .insert({
        thread_id: r.thread_id,
        user_id: r.user_id,
        kind: 'reminder_fire',
        payload: { reminder_id: r.id },
        status: 'queued',
        scheduled_at: now,
        inbound_msg_id: null,
      })
      .select('id')
      .single<{ id: string }>()

    if (jobErr || !job) {
      console.warn('[cron.reminders-tick] enqueue failed', r.id, jobErr?.message)
      continue
    }

    await admin
      .from('lead_reminders')
      .update({ job_id: job.id })
      .eq('id', r.id)

    enqueued += 1
  }

  // Kick the worker so jobs drain promptly.
  if (enqueued > 0) {
    const base = process.env.NEXT_PUBLIC_APP_URL
    const secret = process.env.MESSENGER_WORKER_SECRET ?? process.env.WORKFLOW_WORKER_SECRET
    if (base && secret) {
      after(async () => {
        try {
          await fetch(`${base}/api/messenger/process`, {
            method: 'POST',
            headers: { 'x-worker-secret': secret },
          })
        } catch (e) {
          console.warn('[cron.reminders-tick] worker trigger failed', e)
        }
      })
    }
  }

  return NextResponse.json({ enqueued })
}
