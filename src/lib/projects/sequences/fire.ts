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
  draftSequenceBatch,
  loadSequenceSendContext,
  sendAndRecordStep,
  nextSequenceState,
  retrieveKnowledge,
  type BatchDraft,
} from '@/lib/sequences/shared'
import type { SequenceSendContext } from '@/lib/sequences/shared'

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

// The one-shot batch drafts the WHOLE sequence in a single call, so it gets a
// larger budget than a single step — it still runs at most once per lead (on
// the first touch), then every later touch reads the stored result.
const BATCH_TIMEOUT_MS = 20_000

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
  // The one-shot batch drafts, generated on the first touch and reused for the
  // rest of the sequence. Null until generated.
  drafts: BatchDraft[] | null
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

// Per-stage follow-up guidance + rules, layered on top of the global chatbot
// brain. Null fields when the stage has no extra guidance.
interface SequenceRulesRow {
  stage_instructions: string | null
  do_rules: string[] | null
  dont_rules: string[] | null
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
    .select('id, user_id, project_id, sequence_id, stage_id, lead_id, thread_id, started_at, next_step_idx, status, drafts')
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

  // Pull knowledge relevant to THIS project + sequence (best-effort,
  // time-bounded). Shared by the one-shot batch and the per-step fallback so we
  // never retrieve twice in the same run.
  const knowledge = await withTimeout(
    retrieveKnowledge(admin, run.user_id, knowledgeQuery(stepRows, project)),
    DRAFT_TIMEOUT_MS,
  ).catch(() => '')

  // Resolve the touch text. Preference order (a touch is NEVER dropped):
  //   1. the ONE-SHOT batch draft for this position (generated once per lead);
  //   2. a live single-step draft (only if the batch lacks this position);
  //   3. the step's fallback_message;
  //   4. the built-in default.
  const drafts = await resolveBatchDrafts(admin, run, stepRows, ctx, project, knowledge)
  let text = drafts.find((d) => d.position === run.next_step_idx)?.text ?? ''

  if (!text) {
    try {
      text = await withTimeout(draftSequenceStep({
        leadName: ctx.leadName,
        persona: ctx.persona,
        instructions: ctx.instructions,
        doRules: ctx.doRules,
        dontRules: ctx.dontRules,
        knowledge,
        contextTitle: project.title,
        aiInstructions: project.ai_instructions,
        stepInstruction: step.instruction,
        recentMessages: ctx.recentMessages,
      }), DRAFT_TIMEOUT_MS)
    } catch (e) {
      console.warn('[project.sequence] draft failed, using fallback', run.id, e instanceof Error ? e.message : String(e))
    }
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

// Build the knowledge-retrieval query for the whole sequence: every step goal
// plus the project title + facts, deduped of empties.
function knowledgeQuery(steps: StepRow[], project: ProjectRow): string {
  return [...steps.map((s) => s.instruction), project.title, project.ai_instructions]
    .filter(Boolean)
    .join(' — ')
}

// Return the run's per-touch drafts. Reuses the stored batch when present;
// otherwise generates the WHOLE sequence in ONE LLM call (grounded in the full
// chatbot brain + per-stage rules + this project's facts) and persists it so
// every later touch is a zero-LLM read. A failed/empty batch returns [] — the
// caller then drafts the single step live and/or uses the fallback message, so
// a touch is never dropped.
async function resolveBatchDrafts(
  admin: SupabaseClient,
  run: RunRow,
  steps: StepRow[],
  ctx: SequenceSendContext,
  project: ProjectRow,
  knowledge: string,
): Promise<BatchDraft[]> {
  if (Array.isArray(run.drafts) && run.drafts.length > 0) return run.drafts

  const { data: rules } = await admin
    .from('project_stage_sequences')
    .select('stage_instructions, do_rules, dont_rules')
    .eq('id', run.sequence_id)
    .maybeSingle<SequenceRulesRow>()

  let drafts: BatchDraft[] = []
  try {
    drafts = await withTimeout(draftSequenceBatch({
      leadName: ctx.leadName,
      persona: ctx.persona,
      instructions: ctx.instructions,
      doRules: ctx.doRules,
      dontRules: ctx.dontRules,
      knowledge,
      contextTitle: project.title,
      aiInstructions: project.ai_instructions,
      stageInstructions: rules?.stage_instructions ?? null,
      stageDoRules: rules?.do_rules ?? [],
      stageDontRules: rules?.dont_rules ?? [],
      steps: steps.map((s) => ({ position: s.position, delayMinutes: s.delay_minutes, instruction: s.instruction })),
      recentMessages: ctx.recentMessages,
    }), BATCH_TIMEOUT_MS)
  } catch (e) {
    console.warn('[project.sequence] batch draft failed', run.id, e instanceof Error ? e.message : String(e))
  }

  if (drafts.length > 0) {
    await admin.from('project_sequence_runs').update({ drafts }).eq('id', run.id)
  }
  return drafts
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
