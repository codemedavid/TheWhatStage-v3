'use server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ProjectStageInput } from '../_lib/schemas'
import { projectStagesTag } from '../_lib/queries'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

export async function createProjectStage(raw: unknown): Promise<void> {
  const input = ProjectStageInput.parse(raw)
  const { supabase, userId } = await requireUser()

  const { data: maxRow } = await supabase
    .from('project_stages').select('position')
    .eq('user_id', userId).order('position', { ascending: false })
    .limit(1).maybeSingle()
  const nextPos = (maxRow?.position ?? -1) + 1

  const { error } = await supabase.from('project_stages').insert({
    user_id: userId,
    name: input.name,
    description: input.description ?? null,
    kind: input.kind ?? 'open',
    color: input.color ?? null,
    position: nextPos,
    is_default: false,
  })
  if (error) throw error
  revalidateTag(projectStagesTag(userId), 'max')
  revalidatePath('/dashboard/projects', 'layout')
}

export async function updateProjectStage(id: string, raw: unknown): Promise<void> {
  const input = ProjectStageInput.parse(raw)
  const { supabase, userId } = await requireUser()

  const update: Record<string, unknown> = {
    name: input.name,
    description: input.description ?? null,
  }
  if (input.kind !== undefined) update.kind = input.kind
  if (input.color !== undefined) update.color = input.color

  const { error } = await supabase.from('project_stages').update(update).eq('id', id)
  if (error) throw error
  revalidateTag(projectStagesTag(userId), 'max')
  revalidatePath('/dashboard/projects', 'layout')
}

export async function deleteProjectStage(id: string): Promise<void> {
  const { supabase, userId } = await requireUser()

  const { data: target } = await supabase
    .from('project_stages').select('id, is_default').eq('id', id).single()
  if (!target) throw new Error('Stage not found')
  if (target.is_default) throw new Error('Cannot delete the default stage')

  const { data: def } = await supabase
    .from('project_stages').select('id')
    .eq('user_id', userId).eq('is_default', true).single()
  if (!def) throw new Error('No default stage to receive projects')

  const { error: moveErr } = await supabase
    .from('projects').update({ stage_id: def.id }).eq('stage_id', id)
  if (moveErr) throw moveErr

  const { error } = await supabase.from('project_stages').delete().eq('id', id)
  if (error) throw error
  revalidateTag(projectStagesTag(userId), 'max')
  revalidatePath('/dashboard/projects', 'layout')
}

export async function reorderProjectStages(orderedIds: string[]): Promise<void> {
  const { supabase, userId } = await requireUser()
  const updates = orderedIds.map((id, position) =>
    supabase.from('project_stages')
      .update({ position }).eq('id', id).eq('user_id', userId),
  )
  const results = await Promise.all(updates)
  for (const r of results) if (r.error) throw r.error
  revalidateTag(projectStagesTag(userId), 'max')
  revalidatePath('/dashboard/projects', 'layout')
}
