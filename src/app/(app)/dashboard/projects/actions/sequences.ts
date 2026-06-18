'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SequenceInput } from '../_lib/schemas'
import { fetchStageSequence, type StageSequence } from '../_lib/queries'
import { seedStageProjectsImmediate, cancelStageSequenceRuns } from '@/lib/projects/sequences/seed'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

// Reject stage ids the caller does not own before any admin-client (RLS-bypassing)
// writes touch that stage.
async function assertStageOwned(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  stageId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('project_stages').select('id')
    .eq('id', stageId).eq('user_id', userId).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Stage not found')
}

// Client-callable loader for the per-stage sequence editor.
export async function loadStageSequence(stageId: string): Promise<StageSequence> {
  const { supabase, userId } = await requireUser()
  return fetchStageSequence(supabase, userId, stageId)
}

// Upsert the per-stage sequence config and fully replace its steps. Applies to
// every project that enters this stage. When the sequence is enabled, projects
// ALREADY in the stage are enrolled immediately (first touch on the next tick);
// when disabled, their in-flight runs are cancelled. Returns how many existing
// projects were newly enrolled so the UI can confirm something happened.
export async function saveStageSequence(raw: unknown): Promise<{ seeded: number }> {
  const input = SequenceInput.parse(raw)
  const { supabase, userId } = await requireUser()
  await assertStageOwned(supabase, userId, input.stage_id)

  const { data: seq, error: seqErr } = await supabase
    .from('project_stage_sequences')
    .upsert(
      { user_id: userId, stage_id: input.stage_id, enabled: input.enabled },
      { onConflict: 'stage_id' },
    )
    .select('id').single()
  if (seqErr) throw seqErr

  // Replace steps: clear then re-insert with fresh positions.
  const { error: delErr } = await supabase
    .from('project_stage_sequence_steps').delete().eq('sequence_id', seq.id)
  if (delErr) throw delErr

  if (input.steps.length > 0) {
    const rows = input.steps.map((s, position) => ({
      user_id: userId,
      sequence_id: seq.id,
      position,
      delay_minutes: s.delay_minutes,
      instruction: s.instruction,
      fallback_message: s.fallback_message?.trim() || null,
      channel: s.channel,
    }))
    const { error: insErr } = await supabase
      .from('project_stage_sequence_steps').insert(rows)
    if (insErr) throw insErr
  }

  // Enroll / unenroll projects already sitting in this stage. Uses the admin
  // client to match the cron/worker path (and to read messenger_threads).
  const admin = createAdminClient()
  let seeded = 0
  if (input.enabled && input.steps.length > 0) {
    seeded = await seedStageProjectsImmediate(admin, { userId, stageId: input.stage_id })
  } else {
    await cancelStageSequenceRuns(admin, userId, input.stage_id, 'stage sequence disabled')
  }

  revalidatePath('/dashboard/projects', 'layout')
  return { seeded }
}

export async function setStageSequenceEnabled(stageId: string, enabled: boolean): Promise<{ seeded: number }> {
  const { supabase, userId } = await requireUser()
  await assertStageOwned(supabase, userId, stageId)
  const { error } = await supabase
    .from('project_stage_sequences')
    .upsert(
      { user_id: userId, stage_id: stageId, enabled },
      { onConflict: 'stage_id' },
    )
  if (error) throw error

  const admin = createAdminClient()
  let seeded = 0
  if (enabled) {
    seeded = await seedStageProjectsImmediate(admin, { userId, stageId })
  } else {
    await cancelStageSequenceRuns(admin, userId, stageId, 'stage sequence disabled')
  }

  revalidatePath('/dashboard/projects', 'layout')
  return { seeded }
}
