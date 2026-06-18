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

  const { data: thread } = await admin
    .from('messenger_threads')
    .select('id')
    .eq('lead_id', leadId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  const now = new Date()
  const nextRunAt = new Date(now.getTime() + firstStep.delay_minutes * 60_000)

  const { error: insertErr } = await admin.from('project_sequence_runs').insert({
    user_id: userId,
    project_id: projectId,
    sequence_id: seq.id,
    stage_id: stageId,
    lead_id: leadId,
    thread_id: thread?.id ?? null,
    started_at: now.toISOString(),
    next_step_idx: 0,
    next_run_at: nextRunAt.toISOString(),
    status: 'pending',
  })
  if (insertErr) throw insertErr
}
