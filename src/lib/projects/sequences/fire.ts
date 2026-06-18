// Project follow-up sequence firing. The cron tick enqueues a
// `project_sequence_send` messenger_job per due run; the messenger worker drains
// it (per-thread serialized) and calls the handler here. Each step is drafted
// from the project's AI instructions + the step instruction and sent through the
// SAME outbound + policy path the follow-up engine uses. The draft/load/send/
// advance plumbing is shared with the lead-sequence worker via
// src/lib/sequences/shared.ts.

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  draftSequenceStep,
  loadSequenceSendContext,
  sendAndRecordStep,
  nextSequenceState,
} from '@/lib/sequences/shared'

interface RunRow {
  id: string
  user_id: string
  project_id: string
  sequence_id: string
  stage_id: string
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

interface ProjectRow {
  id: string
  stage_id: string
  title: string
  ai_instructions: string | null
}

export interface ProjectSequenceSendJob {
  id: string
  payload: { run_id: string } | null
}

export async function handleProjectSequenceRun(
  admin: SupabaseClient,
  args: { runId: string },
): Promise<void> {
  const { data: run } = await admin
    .from('project_sequence_runs')
    .select('id, user_id, project_id, sequence_id, stage_id, lead_id, thread_id, started_at, next_step_idx, status')
    .eq('id', args.runId)
    .maybeSingle<RunRow>()

  if (!run) return
  if (run.status !== 'running' && run.status !== 'pending') return

  const { data: project } = await admin
    .from('projects')
    .select('id, stage_id, title, ai_instructions')
    .eq('id', run.project_id)
    .maybeSingle<ProjectRow>()

  // Project deleted or moved out of the stage that seeded this run — stop.
  if (!project) { await markDone(admin, run.id); return }
  if (project.stage_id !== run.stage_id) {
    await admin.from('project_sequence_runs')
      .update({ status: 'cancelled', last_error: 'project left stage' }).eq('id', run.id)
    return
  }

  const { data: steps } = await admin
    .from('project_stage_sequence_steps')
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

  let text: string
  try {
    text = await draftSequenceStep({
      leadName: ctx.leadName,
      persona: ctx.persona,
      contextTitle: project.title,
      aiInstructions: project.ai_instructions,
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
  await admin.from('project_sequence_runs').update({
    next_step_idx: next.nextStepIdx,
    next_run_at: next.nextRunAt,
    status: 'pending',
    job_id: null,
  }).eq('id', run.id)
}

async function markDone(admin: SupabaseClient, id: string): Promise<void> {
  await admin.from('project_sequence_runs').update({ status: 'done' }).eq('id', id)
}

async function markFailed(admin: SupabaseClient, id: string, reason: string): Promise<void> {
  await admin.from('project_sequence_runs')
    .update({ status: 'failed', last_error: reason.slice(0, 500) }).eq('id', id)
}

// Worker entry point — called from messenger/process runJob when
// job.kind === 'project_sequence_send'.
export async function handleProjectSequenceSendJob(
  admin: SupabaseClient,
  job: ProjectSequenceSendJob,
): Promise<void> {
  const runId = job.payload?.run_id
  if (!runId) {
    await admin.from('messenger_jobs')
      .update({ status: 'skipped', finished_at: new Date().toISOString() }).eq('id', job.id)
    return
  }
  try {
    await handleProjectSequenceRun(admin, { runId })
    await admin.from('messenger_jobs')
      .update({ status: 'done', finished_at: new Date().toISOString() }).eq('id', job.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[project.sequence] handler threw', job.id, msg)
    try {
      Sentry.captureException(e, { tags: { jobKind: 'project_sequence_send', jobId: job.id, runId }, level: 'error' })
    } catch { /* never break the worker on telemetry */ }
    await admin.from('messenger_jobs')
      .update({ status: 'failed', finished_at: new Date().toISOString(), last_error: msg.slice(0, 1000) })
      .eq('id', job.id)
  }
}
