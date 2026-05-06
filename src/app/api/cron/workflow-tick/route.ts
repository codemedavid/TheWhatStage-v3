import { after, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sweepStageIdleTriggers, sweepCartAbandonedTriggers } from '@/lib/workflow/dispatcher'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request): Promise<NextResponse> {
  const isDev = process.env.NODE_ENV !== 'production'
  if (!isDev) {
    const auth = req.headers.get('authorization')
    const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
    if (!process.env.CRON_SECRET || auth !== expected) {
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  const base = process.env.NEXT_PUBLIC_APP_URL
  const secret = process.env.WORKFLOW_WORKER_SECRET
  if (!base || !secret) {
    return NextResponse.json(
      { fired: false, reason: 'NEXT_PUBLIC_APP_URL or WORKFLOW_WORKER_SECRET missing' },
      { status: 200 },
    )
  }

  const admin = createAdminClient()
  const { data, error } = await admin.rpc('enqueue_due_workflow_runs')
  if (error) {
    console.error('[cron.workflow-tick] enqueue_due_workflow_runs failed', error.message)
  }
  const enqueued = (data as number | null) ?? 0

  // stage_idle sweep
  sweepStageIdleTriggers(admin).catch((e) =>
    console.error('[cron.workflow-tick] sweepStageIdleTriggers threw', e),
  )

  // cart_abandoned sweep — marks idle active carts as abandoned and fires triggers
  sweepCartAbandonedTriggers(admin).catch((e) =>
    console.error('[cron.workflow-tick] sweepCartAbandonedTriggers threw', e),
  )

  after(async () => {
    try {
      await fetch(`${base}/api/workflow/process`, {
        method: 'POST',
        headers: { 'x-worker-secret': secret },
      })
    } catch (e) {
      console.warn('[cron.workflow-tick] worker trigger failed', e)
    }
  })

  return NextResponse.json({ fired: true, enqueued })
}
