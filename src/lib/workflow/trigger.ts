import { createAdminClient } from '@/lib/supabase/admin'
import type { WorkflowRunState } from './types'

type AdminClient = ReturnType<typeof createAdminClient>

export async function triggerWorkflowWorker(): Promise<void> {
  const base = process.env.NEXT_PUBLIC_APP_URL
  const secret = process.env.WORKFLOW_WORKER_SECRET
  if (!base || !secret) {
    console.warn('[workflow.trigger] worker not configured')
    return
  }
  try {
    await fetch(`${base}/api/workflow/process`, {
      method: 'POST',
      headers: { 'x-worker-secret': secret },
    })
  } catch (e) {
    console.warn('[workflow.trigger] worker trigger failed', e)
  }
}

export async function interruptWorkflowRun(
  admin: AdminClient,
  runId: string,
  event: NonNullable<WorkflowRunState['interrupt_event']>,
): Promise<void> {
  try {
    const { data: run } = await admin
      .from('workflow_runs')
      .select('id, status, state')
      .eq('id', runId)
      .maybeSingle<{ id: string; status: string; state: WorkflowRunState }>()

    if (!run || run.status !== 'waiting') return

    const interruptOn = run.state.interrupt_on ?? []
    const isOtnGranted = event.kind === 'otn_granted'
    const isAllowed =
      isOtnGranted || interruptOn.includes(event.kind as 'inbound_message' | 'stage_changed' | 'submission_received')
    if (!isAllowed) return

    const mergedState: WorkflowRunState = {
      ...run.state,
      interrupt_event: event,
    }

    const { data: updated } = await admin
      .from('workflow_runs')
      .update({
        status: 'running',
        next_run_at: null,
        state: mergedState,
        updated_at: new Date().toISOString(),
      })
      .eq('id', runId)
      .eq('status', 'waiting')
      .select('id')
      .maybeSingle<{ id: string }>()

    if (!updated) return

    await admin.from('workflow_jobs').insert({
      run_id: runId,
      scheduled_at: new Date().toISOString(),
    })

    await triggerWorkflowWorker()
  } catch (e) {
    console.error('[workflow.trigger] interruptWorkflowRun failed', e)
  }
}
