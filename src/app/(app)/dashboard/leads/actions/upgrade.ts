'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { applyUpgrade, undoUpgrade, previewUpgrade } from '@/lib/leads/upgrade'

async function getUserId() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) throw new Error('unauthorized')
  return data.user.id
}

export async function getUpgradePreview() {
  const userId = await getUserId()
  return previewUpgrade(createAdminClient(), userId)
}

export async function applyUpgradeAction() {
  const userId = await getUserId()
  const result = await applyUpgrade(createAdminClient(), userId)
  revalidatePath('/dashboard/leads/stages')
  return result
}

export async function dismissUpgradeAction() {
  const userId = await getUserId()
  const supabase = createAdminClient()
  await supabase.from('profiles').update({ dismissed_stage_upgrade_at: new Date().toISOString() }).eq('id', userId)
  revalidatePath('/dashboard/leads/stages')
}

export async function undoUpgradeAction() {
  const userId = await getUserId()
  await undoUpgrade(createAdminClient(), userId)
  revalidatePath('/dashboard/leads/stages')
}
