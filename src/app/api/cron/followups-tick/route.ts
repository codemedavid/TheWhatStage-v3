// src/app/api/cron/followups-tick/route.ts
//
// Every-minute tick: find lead_followup_schedules rows whose next_run_at is
// past due and no job is queued for them, then insert a messenger_jobs row
// per schedule. The messenger worker drains them with per-thread
// serialization (no two jobs for the same thread run in parallel).
//
// Reuses CRON_SECRET (cron auth) and MESSENGER_WORKER_SECRET (kicker).

import { after, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface DueSchedule {
  id: string
  user_id: string
  thread_id: string
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

  const { data: due, error } = await admin
    .from('lead_followup_schedules')
    .select('id, user_id, thread_id')
    .eq('status', 'pending')
    .is('job_id', null)
    .lte('next_run_at', now)
    .limit(100)

  if (error) {
    console.error('[cron.followups-tick] query failed', error.message)
    return NextResponse.json({ enqueued: 0, error: error.message }, { status: 200 })
  }

  const rows = (due ?? []) as DueSchedule[]
  let enqueued = 0

  for (const r of rows) {
    const { data: job, error: jobErr } = await admin
      .from('messenger_jobs')
      .insert({
        thread_id: r.thread_id,
        user_id: r.user_id,
        kind: 'followup_send',
        payload: { schedule_id: r.id },
        status: 'queued',
        scheduled_at: now,
        inbound_msg_id: null,
      })
      .select('id')
      .single<{ id: string }>()

    if (jobErr || !job) {
      console.warn('[cron.followups-tick] enqueue failed', r.id, jobErr?.message)
      continue
    }

    await admin
      .from('lead_followup_schedules')
      .update({ job_id: job.id, status: 'running' })
      .eq('id', r.id)

    enqueued += 1
  }

  if (enqueued > 0) {
    const base = process.env.NEXT_PUBLIC_APP_URL
    const secret = process.env.MESSENGER_WORKER_SECRET ?? process.env.WORKFLOW_WORKER_SECRET
    if (base && secret) {
      try {
        after(async () => {
          try {
            await fetch(`${base}/api/messenger/process`, {
              method: 'POST',
              headers: { 'x-worker-secret': secret },
            })
          } catch (e) {
            console.warn('[cron.followups-tick] worker trigger failed', e)
          }
        })
      } catch {
        // after() is not available outside a Next.js request scope (e.g. tests)
      }
    }
  }

  return NextResponse.json({ enqueued })
}
