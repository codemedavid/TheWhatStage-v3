import type { SupabaseClient } from '@supabase/supabase-js'

// Cancel any active (pending/running) sequence run for a project. Called when a
// project leaves a stage, reaches a terminal stage, or the customer replies.
export async function cancelActiveProjectSequenceRuns(
  admin: SupabaseClient,
  projectId: string,
  reason: string,
): Promise<void> {
  const { error } = await admin
    .from('project_sequence_runs')
    .update({ status: 'cancelled', last_error: reason })
    .eq('project_id', projectId)
    .in('status', ['pending', 'running'])
  if (error) throw error
}

// Cancel every active run for a whole stage. Used when a stage's sequence is
// turned off so in-flight projects stop receiving touches. Scoped by user_id
// because the caller uses the service-role admin client (RLS bypassed).
export async function cancelStageSequenceRuns(
  admin: SupabaseClient,
  userId: string,
  stageId: string,
  reason: string,
): Promise<void> {
  const { error } = await admin
    .from('project_sequence_runs')
    .update({ status: 'cancelled', last_error: reason })
    .eq('user_id', userId)
    .eq('stage_id', stageId)
    .in('status', ['pending', 'running'])
  if (error) throw error
}

// Resolve the lead's most recent Messenger thread id, or null when the lead has
// no thread (e.g. a web-form lead with no PSID).
async function latestThreadId(admin: SupabaseClient, leadId: string): Promise<string | null> {
  const { data: thread } = await admin
    .from('messenger_threads')
    .select('id')
    .eq('lead_id', leadId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  return thread?.id ?? null
}

type SeedArgs = {
  userId: string
  projectId: string
  leadId: string
  stageId: string
}

// Seed a follow-up sequence run when a project enters a stage that has an
// enabled sequence with at least one step. Idempotent per project: any prior
// active run is cancelled first (so the one-active-run-per-project unique index
// is never violated). thread_id may be null when the lead has no Messenger
// thread; the firing worker fails such runs gracefully.
export async function seedProjectSequenceRun(admin: SupabaseClient, args: SeedArgs): Promise<void> {
  const { userId, projectId, leadId, stageId } = args

  const { data: seq, error: seqErr } = await admin
    .from('project_stage_sequences')
    .select('id, enabled')
    .eq('stage_id', stageId)
    .maybeSingle()
  if (seqErr) throw seqErr
  if (!seq || !seq.enabled) return

  const { data: firstStep, error: stepErr } = await admin
    .from('project_stage_sequence_steps')
    .select('delay_minutes')
    .eq('sequence_id', seq.id)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (stepErr) throw stepErr
  if (!firstStep) return

  // Always clear any existing active run before seeding a new one.
  await cancelActiveProjectSequenceRuns(admin, projectId, 'reseeded on stage entry')

  const threadId = await latestThreadId(admin, leadId)

  const now = new Date()
  const nextRunAt = new Date(now.getTime() + firstStep.delay_minutes * 60_000)

  const { error: insertErr } = await admin.from('project_sequence_runs').insert({
    user_id: userId,
    project_id: projectId,
    sequence_id: seq.id,
    stage_id: stageId,
    lead_id: leadId,
    thread_id: threadId,
    started_at: now.toISOString(),
    next_step_idx: 0,
    next_run_at: nextRunAt.toISOString(),
    status: 'pending',
  })
  if (insertErr) throw insertErr
}

// Seed runs for every project ALREADY sitting in a stage when its sequence is
// enabled — the first touch is scheduled immediately (next_run_at = now).
// Without this, turning a sequence on for a populated stage produces zero
// follow-ups until each project is moved out and back. Projects that already
// have an active run are left untouched (no reset of in-flight sequences).
// Returns the number of new runs seeded.
export async function seedStageProjectsImmediate(
  admin: SupabaseClient,
  args: { userId: string; stageId: string },
): Promise<number> {
  const { userId, stageId } = args

  const { data: seq, error: seqErr } = await admin
    .from('project_stage_sequences')
    .select('id, enabled')
    .eq('stage_id', stageId)
    .maybeSingle()
  if (seqErr) throw seqErr
  if (!seq || !seq.enabled) return 0

  const { count: stepCount, error: cntErr } = await admin
    .from('project_stage_sequence_steps')
    .select('id', { count: 'exact', head: true })
    .eq('sequence_id', seq.id)
  if (cntErr) throw cntErr
  if (!stepCount) return 0

  const { data: projects, error: projErr } = await admin
    .from('projects')
    .select('id, lead_id')
    .eq('user_id', userId)
    .eq('stage_id', stageId)
  if (projErr) throw projErr
  if (!projects || projects.length === 0) return 0

  // Skip projects that already have an active run for this stage.
  const { data: activeRuns, error: runErr } = await admin
    .from('project_sequence_runs')
    .select('project_id')
    .eq('stage_id', stageId)
    .in('status', ['pending', 'running'])
  if (runErr) throw runErr
  const active = new Set((activeRuns ?? []).map((r) => (r as { project_id: string }).project_id))

  const now = new Date().toISOString()
  let seeded = 0
  for (const p of projects as Array<{ id: string; lead_id: string }>) {
    if (active.has(p.id)) continue
    const threadId = await latestThreadId(admin, p.lead_id)
    const { error: insertErr } = await admin.from('project_sequence_runs').insert({
      user_id: userId,
      project_id: p.id,
      sequence_id: seq.id,
      stage_id: stageId,
      lead_id: p.lead_id,
      thread_id: threadId,
      started_at: now,
      next_step_idx: 0,
      next_run_at: now, // first touch fires on the next cron tick
      status: 'pending',
    })
    // Swallow the unique-active-run race; surface anything else.
    if (insertErr && (insertErr as { code?: string }).code !== '23505') throw insertErr
    if (!insertErr) seeded += 1
  }
  return seeded
}
