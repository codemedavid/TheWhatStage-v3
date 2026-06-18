import type { SupabaseClient } from '@supabase/supabase-js'

// Cancel any active (pending/running) sequence run for a lead. Called when the
// user re-enrolls a lead or explicitly stops the lead's follow-up sequence.
export async function cancelActiveLeadSequenceRuns(
  admin: SupabaseClient,
  leadId: string,
  reason: string,
): Promise<void> {
  const { error } = await admin
    .from('lead_sequence_runs')
    .update({ status: 'cancelled', last_error: reason })
    .eq('lead_id', leadId)
    .in('status', ['pending', 'running'])
  if (error) throw error
}

type SeedArgs = {
  userId: string
  leadId: string
}

// Seed a follow-up run when the user enrolls a lead whose sequence is enabled
// and has at least one step. Idempotent per lead: any prior active run is
// cancelled first (so the one-active-run-per-lead unique index is never
// violated). thread_id may be null when the lead has no Messenger thread; the
// firing worker fails such runs gracefully.
export async function seedLeadSequenceRun(admin: SupabaseClient, args: SeedArgs): Promise<void> {
  const { userId, leadId } = args

  const { data: seq, error: seqErr } = await admin
    .from('lead_sequences')
    .select('id, enabled')
    .eq('lead_id', leadId)
    .maybeSingle()
  if (seqErr) throw seqErr
  if (!seq || !seq.enabled) return

  const { data: firstStep, error: stepErr } = await admin
    .from('lead_sequence_steps')
    .select('delay_minutes')
    .eq('sequence_id', seq.id)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (stepErr) throw stepErr
  if (!firstStep) return

  // Always clear any existing active run before seeding a new one.
  await cancelActiveLeadSequenceRuns(admin, leadId, 'reseeded on enroll')

  const { data: thread } = await admin
    .from('messenger_threads')
    .select('id')
    .eq('lead_id', leadId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()

  const now = new Date()
  const nextRunAt = new Date(now.getTime() + firstStep.delay_minutes * 60_000)

  const { error: insertErr } = await admin.from('lead_sequence_runs').insert({
    user_id: userId,
    sequence_id: seq.id,
    lead_id: leadId,
    thread_id: thread?.id ?? null,
    started_at: now.toISOString(),
    next_step_idx: 0,
    next_run_at: nextRunAt.toISOString(),
    status: 'pending',
  })
  if (insertErr) throw insertErr
}
