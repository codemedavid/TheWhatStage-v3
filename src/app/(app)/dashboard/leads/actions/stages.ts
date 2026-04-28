'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { StageInput } from '../_lib/schemas'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

export async function createStage(raw: unknown) {
  const input = StageInput.parse(raw)
  const { supabase, userId } = await requireUser()

  const { data: maxRow } = await supabase
    .from('pipeline_stages')
    .select('position')
    .eq('user_id', userId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextPos = (maxRow?.position ?? -1) + 1
  const { error } = await supabase.from('pipeline_stages').insert({
    user_id: userId, ...input, position: nextPos, is_default: false,
  })
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function updateStage(id: string, raw: unknown) {
  const input = StageInput.parse(raw)
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from('pipeline_stages')
    .update(input)
    .eq('id', id)
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function deleteStage(id: string) {
  const { supabase, userId } = await requireUser()

  const { data: target } = await supabase
    .from('pipeline_stages')
    .select('id, is_default')
    .eq('id', id).single()

  if (!target) throw new Error('Stage not found')
  if (target.is_default) throw new Error('Cannot delete the default stage')

  const { data: def } = await supabase
    .from('pipeline_stages')
    .select('id')
    .eq('user_id', userId).eq('is_default', true).single()
  if (!def) throw new Error('No default stage to receive leads')

  const { error: moveErr } = await supabase
    .from('leads').update({ stage_id: def.id }).eq('stage_id', id)
  if (moveErr) throw moveErr

  const { error } = await supabase.from('pipeline_stages').delete().eq('id', id)
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function reorderStages(orderedIds: string[]) {
  const { supabase, userId } = await requireUser()
  const updates = orderedIds.map((id, position) =>
    supabase.from('pipeline_stages')
      .update({ position }).eq('id', id).eq('user_id', userId)
  )
  const results = await Promise.all(updates)
  for (const r of results) if (r.error) throw r.error
  revalidatePath('/dashboard/leads', 'layout')
}
