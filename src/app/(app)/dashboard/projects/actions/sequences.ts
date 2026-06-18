'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SequenceInput } from '../_lib/schemas'
import { fetchStageSequence, type StageSequence } from '../_lib/queries'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

// Client-callable loader for the per-stage sequence editor.
export async function loadStageSequence(stageId: string): Promise<StageSequence> {
  const { supabase, userId } = await requireUser()
  return fetchStageSequence(supabase, userId, stageId)
}

// Upsert the per-stage sequence config and fully replace its steps. Applies to
// every project that enters this stage.
export async function saveStageSequence(raw: unknown): Promise<void> {
  const input = SequenceInput.parse(raw)
  const { supabase, userId } = await requireUser()

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
      channel: s.channel,
    }))
    const { error: insErr } = await supabase
      .from('project_stage_sequence_steps').insert(rows)
    if (insErr) throw insErr
  }

  revalidatePath('/dashboard/projects', 'layout')
}

export async function setStageSequenceEnabled(stageId: string, enabled: boolean): Promise<void> {
  const { supabase, userId } = await requireUser()
  const { error } = await supabase
    .from('project_stage_sequences')
    .upsert(
      { user_id: userId, stage_id: stageId, enabled },
      { onConflict: 'stage_id' },
    )
  if (error) throw error
  revalidatePath('/dashboard/projects', 'layout')
}
