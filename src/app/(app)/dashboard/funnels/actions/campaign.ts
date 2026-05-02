'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  CreateCampaignInput,
  DeleteCampaignInput,
  ToggleCampaignEnabledInput,
  UpdateCampaignInput,
} from '../_lib/schemas'

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

function parseStringList(raw: FormDataEntryValue | null, max = 20): string[] {
  if (typeof raw !== 'string') return []
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, max)
}

export async function createCampaign(formData: FormData): Promise<void> {
  const description = String(formData.get('description') ?? '').trim()
  const parsed = CreateCampaignInput.safeParse({
    name: formData.get('name'),
    description: description.length ? description : undefined,
  })
  if (!parsed.success) {
    redirect('/dashboard/funnels/new?error=invalid')
  }

  const { supabase, userId } = await requireUser()
  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      user_id: userId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !data) {
    redirect(
      `/dashboard/funnels/new?error=create_failed&detail=${encodeURIComponent(error?.message ?? 'unknown')}`,
    )
  }

  revalidatePath('/dashboard/funnels')
  redirect(`/dashboard/funnels/${data.id}`)
}

export async function updateCampaign(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const description = String(formData.get('description') ?? '').trim()
  const goalRaw = String(formData.get('goal_action_page_id') ?? '').trim()
  const personaRaw = String(formData.get('persona') ?? '').trim()

  const raw = {
    id,
    name: formData.get('name'),
    description: description.length ? description : null,
    enabled: formData.get('enabled') === 'on' || formData.get('enabled') === 'true',
    status: formData.get('status'),
    assignment_mode: formData.get('assignment_mode'),
    weight: Number.parseInt(String(formData.get('weight') ?? '1'), 10) || 0,
    personality_mode: formData.get('personality_mode'),
    persona: personaRaw,
    do_rules: parseStringList(formData.get('do_rules')),
    dont_rules: parseStringList(formData.get('dont_rules')),
    goal_action_page_id: goalRaw.length ? goalRaw : null,
  }

  const parsed = UpdateCampaignInput.safeParse(raw)
  if (!parsed.success) {
    redirect(
      `/dashboard/funnels/${id}?error=invalid&detail=${encodeURIComponent(
        parsed.error.issues[0]?.message ?? 'invalid input',
      )}`,
    )
  }

  const { supabase, userId } = await requireUser()
  const { error } = await supabase
    .from('campaigns')
    .update({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      enabled: parsed.data.enabled,
      status: parsed.data.status,
      assignment_mode: parsed.data.assignment_mode,
      weight: parsed.data.weight,
      personality_mode: parsed.data.personality_mode,
      persona: parsed.data.persona,
      do_rules: parsed.data.do_rules,
      dont_rules: parsed.data.dont_rules,
      goal_action_page_id: parsed.data.goal_action_page_id,
    })
    .eq('id', parsed.data.id)
    .eq('user_id', userId)
  if (error) {
    redirect(
      `/dashboard/funnels/${parsed.data.id}?error=update_failed&detail=${encodeURIComponent(error.message)}`,
    )
  }

  revalidatePath('/dashboard/funnels')
  revalidatePath(`/dashboard/funnels/${parsed.data.id}`)
  redirect(`/dashboard/funnels/${parsed.data.id}?saved=1`)
}

export async function toggleCampaignEnabled(formData: FormData): Promise<void> {
  const parsed = ToggleCampaignEnabledInput.safeParse({
    id: formData.get('id'),
    enabled:
      formData.get('enabled') === 'true' || formData.get('enabled') === 'on',
  })
  if (!parsed.success) redirect('/dashboard/funnels?error=invalid')

  const { supabase, userId } = await requireUser()
  const { error } = await supabase
    .from('campaigns')
    .update({ enabled: parsed.data.enabled })
    .eq('id', parsed.data.id)
    .eq('user_id', userId)
  if (error) {
    redirect(
      `/dashboard/funnels?error=toggle_failed&detail=${encodeURIComponent(error.message)}`,
    )
  }
  revalidatePath('/dashboard/funnels')
  revalidatePath(`/dashboard/funnels/${parsed.data.id}`)
}

export async function deleteCampaign(formData: FormData): Promise<void> {
  const parsed = DeleteCampaignInput.safeParse({ id: formData.get('id') })
  if (!parsed.success) redirect('/dashboard/funnels?error=invalid')

  const { supabase, userId } = await requireUser()
  const { error } = await supabase
    .from('campaigns')
    .delete()
    .eq('id', parsed.data.id)
    .eq('user_id', userId)
  if (error) {
    redirect(
      `/dashboard/funnels?error=delete_failed&detail=${encodeURIComponent(error.message)}`,
    )
  }
  revalidatePath('/dashboard/funnels')
  redirect('/dashboard/funnels')
}
