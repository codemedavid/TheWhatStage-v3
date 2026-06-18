// src/app/api/cron/project-sequences/route.ts
//
// Every-minute tick: find project_sequence_runs whose next_run_at is past due
// with no job queued, then enqueue one messenger_jobs row per run. The
// messenger worker drains them (per-thread serialized) via the
// `project_sequence_send` kind. Mirrors cron/followups-tick.

import { after, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface DueRun {
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

  const { data: due, error } = await admin
    .from('project_sequence_runs')
    .select('id, user_id, thread_id')
    .eq('status', 'pending')
    .is('job_id', null)
    .lte('next_run_at', now)
    .limit(100)

  if (error) {
    console.error('[cron.project-sequences] query failed', error.message)
    // Non-200 so a failing tick is visible in cron.job_run_details / net._http_response
    // instead of masquerading as a successful run. Body stays generic — the raw
    // DB message is logged server-side, not echoed.
    return NextResponse.json({ enqueued: 0, error: 'query failed' }, { status: 500 })
  }

  const rows = (due ?? []) as DueRun[]
  let enqueued = 0

  for (const r of rows) {
    // A run with no Messenger thread can never deliver — fail it now so it
    // does not sit pending forever.
    if (!r.thread_id) {
      await admin.from('project_sequence_runs')
        .update({ status: 'failed', last_error: 'no messenger thread' }).eq('id', r.id)
      continue
    }

    const { data: job, error: jobErr } = await admin
      .from('messenger_jobs')
      .insert({
        thread_id: r.thread_id,
        user_id: r.user_id,
        kind: 'project_sequence_send',
        payload: { run_id: r.id },
        status: 'queued',
        scheduled_at: now,
        inbound_msg_id: null,
      })
      .select('id')
      .single<{ id: string }>()

    if (jobErr || !job) {
      console.warn('[cron.project-sequences] enqueue failed', r.id, jobErr?.message)
      continue
    }

    await admin.from('project_sequence_runs')
      .update({ job_id: job.id, status: 'running' }).eq('id', r.id)
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
            console.warn('[cron.project-sequences] worker trigger failed', e)
          }
        })
      } catch {
        // after() unavailable outside a Next.js request scope (e.g. tests)
      }
    }
  }

  return NextResponse.json({ enqueued })
}
