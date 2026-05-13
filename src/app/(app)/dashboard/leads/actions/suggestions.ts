'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function getUserId() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) throw new Error('unauthorized')
  return data.user.id
}

export async function listPendingSuggestions() {
  const userId = await getUserId()
  const admin = createAdminClient()
  const { data } = await admin
    .from('pipeline_stage_suggestions')
    .select('id, stage_id, field, current_value, proposed_value, reason, created_at, pipeline_stages(name)')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  return data ?? []
}

export async function acceptSuggestion(id: string) {
  const userId = await getUserId()
  const admin = createAdminClient()

  const { data: sug } = await admin
    .from('pipeline_stage_suggestions')
    .select('stage_id, field, proposed_value')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (!sug) throw new Error('suggestion not found')

  await admin
    .from('pipeline_stages')
    .update({ [sug.field]: sug.proposed_value })
    .eq('id', sug.stage_id)
    .eq('user_id', userId)

  await admin
    .from('pipeline_stage_suggestions')
    .update({ status: 'accepted', resolved_at: new Date().toISOString(), resolved_by: userId })
    .eq('id', id)

  revalidatePath('/dashboard/leads/stages')
}

export async function rejectSuggestion(id: string) {
  const userId = await getUserId()
  const admin = createAdminClient()
  await admin
    .from('pipeline_stage_suggestions')
    .update({ status: 'rejected', resolved_at: new Date().toISOString(), resolved_by: userId })
    .eq('id', id)
    .eq('user_id', userId)
  revalidatePath('/dashboard/leads/stages')
}

export async function countPendingSuggestions(): Promise<number> {
  const userId = await getUserId()
  const admin = createAdminClient()
  const { count } = await admin
    .from('pipeline_stage_suggestions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'pending')
  return count ?? 0
}
