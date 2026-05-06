import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { executeRun } from '@/lib/workflow/executor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_ATTEMPTS = 3
const BATCH_SIZE = 5
const DRAIN_DEADLINE_MS = 200_000
const RUNNING_STALE_MS = 5 * 60 * 1000

type AdminClient = ReturnType<typeof createAdminClient>

interface WorkflowJobRow {
  id: string
  run_id: string
  attempts: number
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.WORKFLOW_WORKER_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'worker not configured' }, { status: 500 })
  }
  const got = req.headers.get('x-worker-secret') ?? ''
  const a = Buffer.from(got)
  const b = Buffer.from(secret)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const admin = createAdminClient()
  const result = await drainWorkflowJobs(admin)
  return NextResponse.json(result)
}

async function claimJobs(admin: AdminClient, limit: number): Promise<WorkflowJobRow[]> {
  const { data, error } = await admin.rpc('claim_workflow_jobs', {
    p_limit: limit,
    p_stale_seconds: Math.floor(RUNNING_STALE_MS / 1000),
  })
  if (error) {
    console.error('[workflow.worker] claim rpc failed', error)
    return []
  }
  return (data ?? []) as WorkflowJobRow[]
}

async function drainWorkflowJobs(
  admin: AdminClient,
): Promise<{ processed: number; batches: number }> {
  const startedAt = Date.now()
  const claimDeadline = startedAt + DRAIN_DEADLINE_MS
  let processed = 0
  let batches = 0

  while (Date.now() < claimDeadline) {
    const jobs = await claimJobs(admin, BATCH_SIZE)
    if (jobs.length === 0) break
    batches += 1

    await Promise.allSettled(
      jobs.map((job) =>
        runWorkflowJob(admin, job).catch((e) => {
          console.error('[workflow.worker] runWorkflowJob threw', job.id, e)
        }),
      ),
    )

    processed += jobs.length
  }

  return { processed, batches }
}

async function runWorkflowJob(admin: AdminClient, job: WorkflowJobRow): Promise<void> {
  let succeeded = false
  let errorMsg: string | null = null

  try {
    await executeRun(admin, job.run_id)
    succeeded = true
  } catch (e) {
    errorMsg = e instanceof Error ? e.message : String(e)
    console.error('[workflow.worker] executeRun failed', job.run_id, errorMsg)
  }

  const attempts = job.attempts + 1
  const failed = !succeeded && attempts >= MAX_ATTEMPTS

  if (succeeded) {
    await admin
      .from('workflow_jobs')
      .update({
        status: 'done',
        attempts,
        finished_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('id', job.id)
  } else if (failed) {
    await admin
      .from('workflow_jobs')
      .update({
        status: 'failed',
        attempts,
        finished_at: new Date().toISOString(),
        last_error: errorMsg?.slice(0, 1000) ?? null,
      })
      .eq('id', job.id)
  } else {
    const backoffMs = Math.min(60_000 * attempts, 300_000)
    await admin
      .from('workflow_jobs')
      .update({
        status: 'queued',
        attempts,
        finished_at: null,
        last_error: errorMsg?.slice(0, 1000) ?? null,
        scheduled_at: new Date(Date.now() + backoffMs).toISOString(),
      })
      .eq('id', job.id)
  }
}
