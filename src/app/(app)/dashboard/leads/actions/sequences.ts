'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { LeadSequenceInput } from '../_lib/sequence-schemas'
import { seedLeadSequenceRun, cancelActiveLeadSequenceRuns } from '@/lib/leads/sequences/seed'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

export type LeadSequenceStep = {
  id: string
  position: number
  delay_minutes: number
  instruction: string
  channel: 'messenger'
}

export type LeadSequenceRunInfo = {
  status: 'pending' | 'running' | 'done' | 'cancelled' | 'failed'
  next_step_idx: number
  next_run_at: string
} | null

export type LeadSequence = {
  id: string | null
  enabled: boolean
  steps: LeadSequenceStep[]
  run: LeadSequenceRunInfo
}

// Load the lead's follow-up sequence config plus any active run, for the lead
// drawer's Follow-up tab.
export async function loadLeadSequence(leadId: string): Promise<LeadSequence> {
  const { supabase, userId } = await requireUser()

  const { data: seq, error } = await supabase
    .from('lead_sequences')
    .select('id, enabled')
    .eq('user_id', userId).eq('lead_id', leadId).maybeSingle()
  if (error) throw error

  let steps: LeadSequenceStep[] = []
  if (seq) {
    const { data: stepRows, error: stepErr } = await supabase
      .from('lead_sequence_steps')
      .select('id, position, delay_minutes, instruction, channel')
      .eq('sequence_id', seq.id).order('position', { ascending: true })
    if (stepErr) throw stepErr
    steps = (stepRows ?? []) as LeadSequenceStep[]
  }

  const { data: runRow } = await supabase
    .from('lead_sequence_runs')
    .select('status, next_step_idx, next_run_at')
    .eq('user_id', userId).eq('lead_id', leadId)
    .in('status', ['pending', 'running'])
    .order('next_run_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  return {
    id: (seq?.id as string | undefined) ?? null,
    enabled: (seq?.enabled as boolean | undefined) ?? false,
    steps,
    run: (runRow as LeadSequenceRunInfo) ?? null,
  }
}

// Upsert the lead's sequence config and fully replace its steps. Mirrors the
// per-stage saveStageSequence.
export async function saveLeadSequence(raw: unknown): Promise<void> {
  const input = LeadSequenceInput.parse(raw)
  const { supabase, userId } = await requireUser()

  // Authorize the FK target: only the caller's own lead may carry a sequence.
  // Otherwise a known lead UUID from another tenant could be enrolled and then
  // messaged through that tenant's page by the firing worker.
  const { data: leadOwned } = await supabase
    .from('leads').select('id').eq('id', input.lead_id).eq('user_id', userId).maybeSingle()
  if (!leadOwned) throw new Error('Lead not found')

  const { data: seq, error: seqErr } = await supabase
    .from('lead_sequences')
    .upsert(
      { user_id: userId, lead_id: input.lead_id, enabled: input.enabled },
      { onConflict: 'lead_id' },
    )
    .select('id').single()
  if (seqErr) throw seqErr

  const { error: delErr } = await supabase
    .from('lead_sequence_steps').delete().eq('sequence_id', seq.id)
  if (delErr) throw delErr

  if (input.steps.length > 0) {
    const rows = input.steps.map((s, position) => ({
      user_id: userId,
      sequence_id: seq.id,
      position,
      delay_minutes: s.delay_minutes,
      instruction: s.instruction,
      channel: s.channel,
    }))
    const { error: insErr } = await supabase
      .from('lead_sequence_steps').insert(rows)
    if (insErr) throw insErr
  }

  revalidatePath('/dashboard/leads', 'layout')
}

// Start the lead's follow-up sequence: validate it is enabled and has steps,
// then seed a run (which cancels any prior active run).
export async function enrollLeadSequence(leadId: string): Promise<void> {
  const { supabase, userId } = await requireUser()

  const { data: seq, error } = await supabase
    .from('lead_sequences').select('id, enabled')
    .eq('user_id', userId).eq('lead_id', leadId).maybeSingle()
  if (error) throw error
  if (!seq) throw new Error('Save a follow-up sequence for this lead first')
  if (!seq.enabled) throw new Error('Enable the sequence before starting it')

  const { count, error: countErr } = await supabase
    .from('lead_sequence_steps')
    .select('id', { count: 'exact', head: true })
    .eq('sequence_id', seq.id)
  if (countErr) throw countErr
  if (!count) throw new Error('Add at least one follow-up step first')

  await seedLeadSequenceRun(createAdminClient(), { userId, leadId })
  revalidatePath('/dashboard/leads', 'layout')
}

// Stop the lead's active follow-up sequence run. Uses the RLS-scoped user
// client so a caller can only ever cancel their own lead's runs.
export async function cancelLeadSequence(leadId: string): Promise<void> {
  const { supabase } = await requireUser()
  await cancelActiveLeadSequenceRuns(supabase, leadId, 'stopped by user')
  revalidatePath('/dashboard/leads', 'layout')
}
