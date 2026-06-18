// Project follow-up sequence firing. The cron tick enqueues a
// `project_sequence_send` messenger_job per due run; the messenger worker drains
// it (per-thread serialized) and calls the handler here. Each step is drafted
// from the project's AI instructions + the step instruction and sent through the
// SAME outbound + policy path the follow-up engine uses. When the draft comes
// back empty or errors, the step's fallback_message (or a built-in default) is
// sent instead, so a touch is never silently dropped. The draft/load/send/
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

// Last-resort line when a step has no fallback_message and the LLM draft is
// empty/errors. Generic and safe in any context so a touch still goes out.
const DEFAULT_FALLBACK =
  'Hi! Just following up here — let me know if you have any questions or if there’s anything I can help with.'

// Bound the per-step draft so a slow/hung model degrades to the fallback
// instead of blocking the per-thread job queue. This lives in the PROJECT
// worker (not the shared draft) on purpose: the project engine always has a
// fallback, whereas the lead worker has none and must keep the model's full
// retry budget rather than fail a run on a transient slowdown.
const DRAFT_TIMEOUT_MS = 8_000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`draft timed out after ${ms}ms`)), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

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
  fallback_message: string | null
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

// What a single run attempt resolved to. Drives the messenger_jobs row status
// so monitoring reflects real delivery (previously every non-throwing run was
// marked 'done', hiding empty-message / send-blocked / no-thread drops).
export type RunOutcome = 'sent' | 'done' | 'cancelled' | 'failed' | 'skipped'
export interface RunResult {
  outcome: RunOutcome
  reason?: string
}

export async function handleProjectSequenceRun(
  admin: SupabaseClient,
  args: { runId: string },
): Promise<RunResult> {
  const { data: run } = await admin
    .from('project_sequence_runs')
    .select('id, user_id, project_id, sequence_id, stage_id, lead_id, thread_id, started_at, next_step_idx, status')
    .eq('id', args.runId)
    .maybeSingle<RunRow>()

  if (!run) return { outcome: 'skipped', reason: 'run missing' }
  if (run.status !== 'running' && run.status !== 'pending') {
    return { outcome: 'skipped', reason: `status ${run.status}` }
  }

  const { data: project } = await admin
    .from('projects')
    .select('id, stage_id, title, ai_instructions')
    .eq('id', run.project_id)
    .maybeSingle<ProjectRow>()

  // Project deleted or moved out of the stage that seeded this run — stop.
  if (!project) { await markDone(admin, run.id); return { outcome: 'done', reason: 'project deleted' } }
  if (project.stage_id !== run.stage_id) {
    await admin.from('project_sequence_runs')
      .update({ status: 'cancelled', last_error: 'project left stage' }).eq('id', run.id)
    return { outcome: 'cancelled', reason: 'project left stage' }
  }

  const { data: steps } = await admin
    .from('project_stage_sequence_steps')
    .select('position, delay_minutes, instruction, fallback_message')
    .eq('sequence_id', run.sequence_id)
    .order('position', { ascending: true })
  const stepRows = (steps ?? []) as StepRow[]
  const step = stepRows[run.next_step_idx]
  if (!step) { await markDone(admin, run.id); return { outcome: 'done', reason: 'no more steps' } }

  if (!run.thread_id) { await markFailed(admin, run.id, 'no messenger thread'); return { outcome: 'failed', reason: 'no messenger thread' } }

  const loaded = await loadSequenceSendContext(admin, {
    threadId: run.thread_id, userId: run.user_id, leadId: run.lead_id,
  })
  if (!loaded.ok) { await markFailed(admin, run.id, loaded.reason); return { outcome: 'failed', reason: loaded.reason } }
  const { ctx } = loaded

  // Draft the touch. An empty completion or a thrown draft error must NOT kill
  // the run — fall back to the step's fallback_message (or the default) so the
  // touch still sends. This is the only in-engine cause of non-delivery today
  // (small model returns empty for some instructions, e.g. Tagalog).
  let text = ''
  try {
    text = await withTimeout(draftSequenceStep({
      leadName: ctx.leadName,
      persona: ctx.persona,
      contextTitle: project.title,
      aiInstructions: project.ai_instructions,
      stepInstruction: step.instruction,
      recentMessages: ctx.recentMessages,
    }), DRAFT_TIMEOUT_MS)
  } catch (e) {
    console.warn('[project.sequence] draft failed, using fallback', run.id, e instanceof Error ? e.message : String(e))
  }
  if (!text) {
    text = step.fallback_message?.trim() || DEFAULT_FALLBACK
  }

  const sent = await sendAndRecordStep(admin, {
    thread: ctx.thread, pageToken: ctx.pageToken, text, userId: run.user_id,
  })
  if (!sent.sent) { await markFailed(admin, run.id, `send_blocked:${sent.reason}`); return { outcome: 'failed', reason: `send_blocked:${sent.reason}` } }

  await advanceRun(admin, run, stepRows)
  return { outcome: 'sent' }
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
// job.kind === 'project_sequence_send'. The job status mirrors the run outcome
// so monitoring sees real delivery, not a blanket 'done'.
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
    const result = await handleProjectSequenceRun(admin, { runId })
    const status =
      result.outcome === 'failed' ? 'failed'
      : result.outcome === 'skipped' ? 'skipped'
      : 'done'
    await admin.from('messenger_jobs')
      .update({
        status,
        finished_at: new Date().toISOString(),
        ...(result.outcome === 'failed' ? { last_error: (result.reason ?? 'run failed').slice(0, 1000) } : {}),
      })
      .eq('id', job.id)
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
