// Lead follow-up sequence firing. The cron tick enqueues a `lead_sequence_send`
// messenger_job per due run; the messenger worker drains it (per-thread
// serialized) and calls the handler here. Each step is drafted from the lead's
// active-project AI instructions (if any) + the step instruction and sent
// through the SAME outbound + policy path as the project sequence worker. The
// draft/load/send/advance plumbing is shared via src/lib/sequences/shared.ts.

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  draftSequenceStep,
  loadSequenceSendContext,
  sendAndRecordStep,
  nextSequenceState,
} from '@/lib/sequences/shared'
import { resolveActiveProjectContext } from '@/lib/projects/active-project'

interface RunRow {
  id: string
  user_id: string
  sequence_id: string
  lead_id: string
  thread_id: string | null
  started_at: string
  next_step_idx: number
  status: string
}

interface StepRow {
  position: number
  delay_minutes: number
  instruction: string
}

export interface LeadSequenceSendJob {
  id: string
  payload: { run_id: string } | null
}

export async function handleLeadSequenceRun(
  admin: SupabaseClient,
  args: { runId: string },
): Promise<void> {
  const { data: run } = await admin
    .from('lead_sequence_runs')
    .select('id, user_id, sequence_id, lead_id, thread_id, started_at, next_step_idx, status')
    .eq('id', args.runId)
    .maybeSingle<RunRow>()

  if (!run) return
  if (run.status !== 'running' && run.status !== 'pending') return

  const { data: steps } = await admin
    .from('lead_sequence_steps')
    .select('position, delay_minutes, instruction')
    .eq('sequence_id', run.sequence_id)
    .order('position', { ascending: true })
  const stepRows = (steps ?? []) as StepRow[]
  const step = stepRows[run.next_step_idx]
  if (!step) { await markDone(admin, run.id); return }

  if (!run.thread_id) { await markFailed(admin, run.id, 'no messenger thread'); return }

  const loaded = await loadSequenceSendContext(admin, {
    threadId: run.thread_id, userId: run.user_id, leadId: run.lead_id,
  })
  if (!loaded.ok) { await markFailed(admin, run.id, loaded.reason); return }
  const { ctx } = loaded

  // Align the message to the lead's active (non-terminal) project, if any —
  // reuses the same context the live chatbot and project follow-ups use.
  const project = await resolveActiveProjectContext(admin, run.lead_id).catch(() => null)

  let text: string
  try {
    text = await draftSequenceStep({
      leadName: ctx.leadName,
      persona: ctx.persona,
      contextTitle: project?.title ?? null,
      aiInstructions: project?.ai_instructions ?? null,
      stepInstruction: step.instruction,
      recentMessages: ctx.recentMessages,
    })
  } catch (e) {
    await markFailed(admin, run.id, `draft_failed:${e instanceof Error ? e.message : String(e)}`)
    return
  }
  if (!text) { await markFailed(admin, run.id, 'empty message'); return }

  const sent = await sendAndRecordStep(admin, {
    thread: ctx.thread, pageToken: ctx.pageToken, text, userId: run.user_id,
  })
  if (!sent.sent) { await markFailed(admin, run.id, `send_blocked:${sent.reason}`); return }

  await advanceRun(admin, run, stepRows)
}

async function advanceRun(admin: SupabaseClient, run: RunRow, steps: StepRow[]): Promise<void> {
  const next = nextSequenceState(run.started_at, steps, run.next_step_idx)
  if (next.done) { await markDone(admin, run.id); return }
  await admin.from('lead_sequence_runs').update({
    next_step_idx: next.nextStepIdx,
    next_run_at: next.nextRunAt,
    status: 'pending',
    job_id: null,
  }).eq('id', run.id)
}

async function markDone(admin: SupabaseClient, id: string): Promise<void> {
  await admin.from('lead_sequence_runs').update({ status: 'done' }).eq('id', id)
}

async function markFailed(admin: SupabaseClient, id: string, reason: string): Promise<void> {
  await admin.from('lead_sequence_runs')
    .update({ status: 'failed', last_error: reason.slice(0, 500) }).eq('id', id)
}

// Worker entry point — called from messenger/process runJob when
// job.kind === 'lead_sequence_send'.
export async function handleLeadSequenceSendJob(
  admin: SupabaseClient,
  job: LeadSequenceSendJob,
): Promise<void> {
  const runId = job.payload?.run_id
  if (!runId) {
    await admin.from('messenger_jobs')
      .update({ status: 'skipped', finished_at: new Date().toISOString() }).eq('id', job.id)
    return
  }
  try {
    await handleLeadSequenceRun(admin, { runId })
    await admin.from('messenger_jobs')
      .update({ status: 'done', finished_at: new Date().toISOString() }).eq('id', job.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[lead.sequence] handler threw', job.id, msg)
    try {
      Sentry.captureException(e, { tags: { jobKind: 'lead_sequence_send', jobId: job.id, runId }, level: 'error' })
    } catch { /* never break the worker on telemetry */ }
    await admin.from('messenger_jobs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), last_error: msg.slice(0, 1000) })
      .eq('id', job.id)
  }
}
