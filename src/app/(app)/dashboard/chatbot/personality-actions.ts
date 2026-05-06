'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getTemplateById, createAdoptionDraft, applyAdoptionDraft, revertToSnapshot } from '@/lib/chatbot/personality/queries'
import { gatherBusinessContext, adaptPersonality } from '@/lib/chatbot/personality/adopt'
import type { GeneratedPersonalityConfig } from '@/lib/chatbot/personality/types'

export type AdoptResult =
  | { ok: true; adoptionId: string; config: GeneratedPersonalityConfig; notes: string }
  | { ok: false; error: string }

export async function adoptPersonality(templateId: string): Promise<AdoptResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Rate-limit: max 10 adoptions per day
  const since = new Date(Date.now() - 86_400_000).toISOString()
  const { count } = await supabase
    .from('chatbot_personality_adoptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('adopted_at', since)
  if ((count ?? 0) >= 10) {
    return { ok: false, error: 'You have reached the daily limit of 10 personality adaptations. Try again tomorrow.' }
  }

  const template = await getTemplateById(supabase, templateId)
  const ctx = await gatherBusinessContext(supabase, user.id)

  // Snapshot current config for revert
  const { data: currentRow } = await supabase
    .from('chatbot_configs')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()
  const sourceSnapshot = (currentRow ?? {}) as Record<string, unknown>

  const generated = await adaptPersonality(template, ctx)

  const adoption = await createAdoptionDraft(
    supabase,
    user.id,
    templateId,
    sourceSnapshot,
    generated,
    generated.adaptationNotes,
  )

  return {
    ok: true,
    adoptionId: adoption.id,
    config: generated,
    notes: generated.adaptationNotes,
  }
}

export type ApplyResult = { ok: true } | { ok: false; error: string }

export async function applyAdoption(
  adoptionId: string,
  templateId: string,
  finalConfig: GeneratedPersonalityConfig,
): Promise<ApplyResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  await applyAdoptionDraft(supabase, user.id, adoptionId, finalConfig, templateId)
  revalidatePath('/dashboard/chatbot')
  return { ok: true }
}

export type RevertResult = { ok: true } | { ok: false; error: string }

export async function revertAdoption(adoptionId: string): Promise<RevertResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  await revertToSnapshot(supabase, user.id, adoptionId)
  revalidatePath('/dashboard/chatbot')
  return { ok: true }
}
