'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { LeadInput, BulkUpdateInput } from '../_lib/schemas'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

function normalize(input: z.infer<typeof LeadInput>) {
  return { ...input, email: input.email || null }
}

export async function createLead(raw: unknown) {
  const input = normalize(LeadInput.parse(raw))
  const { supabase, userId } = await requireUser()

  const { data: maxRow } = await supabase
    .from('leads').select('position')
    .eq('user_id', userId).eq('stage_id', input.stage_id)
    .order('position', { ascending: false }).limit(1).maybeSingle()

  const nextPos = (maxRow?.position ?? -1) + 1
  const { error } = await supabase.from('leads').insert({
    user_id: userId, ...input, position: nextPos,
  })
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function updateLead(id: string, raw: unknown) {
  const input = normalize(LeadInput.parse(raw))
  const { supabase } = await requireUser()
  const { error } = await supabase.from('leads').update(input).eq('id', id)
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function deleteLead(id: string) {
  const { supabase } = await requireUser()
  const { error } = await supabase.from('leads').delete().eq('id', id)
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function bulkDeleteLeads(ids: string[]) {
  if (ids.length === 0) return
  const { supabase } = await requireUser()
  const { error } = await supabase.from('leads').delete().in('id', ids)
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function bulkUpdateLeads(ids: string[], raw: unknown) {
  if (ids.length === 0) return
  const partial = BulkUpdateInput.parse(raw)
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(partial)) {
    if (v !== undefined) patch[k] = v
  }
  if (Object.keys(patch).length === 0) return
  const { supabase } = await requireUser()
  const { error } = await supabase.from('leads').update(patch).in('id', ids)
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function moveLead(id: string, toStageId: string, toPosition: number) {
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from('leads')
    .update({ stage_id: toStageId, position: toPosition })
    .eq('id', id)
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function bulkMoveLeads(ids: string[], toStageId: string) {
  if (ids.length === 0) return
  const { supabase, userId } = await requireUser()

  const { data: maxRow } = await supabase
    .from('leads').select('position')
    .eq('user_id', userId).eq('stage_id', toStageId)
    .order('position', { ascending: false }).limit(1).maybeSingle()

  let pos = (maxRow?.position ?? -1) + 1
  const updates = ids.map((id) => {
    const p = pos++
    return supabase.from('leads')
      .update({ stage_id: toStageId, position: p })
      .eq('id', id)
  })
  const results = await Promise.all(updates)
  for (const r of results) if (r.error) throw r.error
  revalidatePath('/dashboard/leads', 'layout')
}
