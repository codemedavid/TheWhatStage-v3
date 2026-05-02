'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  CreateFunnelInput,
  DeleteFunnelInput,
  ReorderFunnelsInput,
  UpdateFunnelInput,
} from '../_lib/schemas'

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

function safeJson<T>(raw: FormDataEntryValue | null, fallback: T): T {
  if (typeof raw !== 'string' || raw.length === 0) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function createFunnel(formData: FormData): Promise<void> {
  const parsed = CreateFunnelInput.safeParse({
    campaign_id: formData.get('campaign_id'),
    name: formData.get('name'),
  })
  if (!parsed.success) {
    redirect(
      `/dashboard/funnels/${String(formData.get('campaign_id') ?? '')}?error=invalid`,
    )
  }

  const { supabase, userId } = await requireUser()

  // Append at the end: max(position) + 1.
  const { data: maxRow } = await supabase
    .from('funnels')
    .select('position')
    .eq('user_id', userId)
    .eq('campaign_id', parsed.data.campaign_id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle<{ position: number }>()
  const nextPosition = (maxRow?.position ?? -1) + 1

  const { data, error } = await supabase
    .from('funnels')
    .insert({
      user_id: userId,
      campaign_id: parsed.data.campaign_id,
      name: parsed.data.name,
      position: nextPosition,
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !data) {
    redirect(
      `/dashboard/funnels/${parsed.data.campaign_id}?error=create_failed&detail=${encodeURIComponent(error?.message ?? 'unknown')}`,
    )
  }
  revalidatePath(`/dashboard/funnels/${parsed.data.campaign_id}`)
  redirect(`/dashboard/funnels/${parsed.data.campaign_id}/funnels/${data.id}`)
}

export async function updateFunnel(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  const campaignId = String(formData.get('campaign_id') ?? '')
  const description = String(formData.get('description') ?? '').trim()
  const instruction = String(formData.get('instruction') ?? '')
  const actionPageRaw = String(formData.get('action_page_id') ?? '').trim()
  const nextFunnelRaw = String(formData.get('next_funnel_id') ?? '').trim()

  const raw = {
    id,
    campaign_id: campaignId,
    name: formData.get('name'),
    description: description.length ? description : null,
    requirements: safeJson(formData.get('requirements'), []),
    rules: safeJson(formData.get('rules'), []),
    instruction,
    action_page_id: actionPageRaw.length ? actionPageRaw : null,
    next_funnel_id: nextFunnelRaw.length ? nextFunnelRaw : null,
  }
  const parsed = UpdateFunnelInput.safeParse(raw)
  if (!parsed.success) {
    redirect(
      `/dashboard/funnels/${campaignId}/funnels/${id}?error=invalid&detail=${encodeURIComponent(
        parsed.error.issues[0]?.message ?? 'invalid input',
      )}`,
    )
  }

  const { supabase, userId } = await requireUser()
  const { error } = await supabase
    .from('funnels')
    .update({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      requirements: parsed.data.requirements,
      rules: parsed.data.rules,
      instruction: parsed.data.instruction,
      action_page_id: parsed.data.action_page_id,
      next_funnel_id: parsed.data.next_funnel_id,
    })
    .eq('id', parsed.data.id)
    .eq('user_id', userId)
  if (error) {
    redirect(
      `/dashboard/funnels/${campaignId}/funnels/${parsed.data.id}?error=update_failed&detail=${encodeURIComponent(error.message)}`,
    )
  }

  revalidatePath(`/dashboard/funnels/${campaignId}`)
  revalidatePath(`/dashboard/funnels/${campaignId}/funnels/${parsed.data.id}`)
  redirect(
    `/dashboard/funnels/${campaignId}/funnels/${parsed.data.id}?saved=1`,
  )
}

export async function deleteFunnel(formData: FormData): Promise<void> {
  const parsed = DeleteFunnelInput.safeParse({
    id: formData.get('id'),
    campaign_id: formData.get('campaign_id'),
  })
  if (!parsed.success) redirect('/dashboard/funnels?error=invalid')

  const { supabase, userId } = await requireUser()
  const { error } = await supabase
    .from('funnels')
    .delete()
    .eq('id', parsed.data.id)
    .eq('user_id', userId)
  if (error) {
    redirect(
      `/dashboard/funnels/${parsed.data.campaign_id}?error=delete_failed&detail=${encodeURIComponent(error.message)}`,
    )
  }
  revalidatePath(`/dashboard/funnels/${parsed.data.campaign_id}`)
  redirect(`/dashboard/funnels/${parsed.data.campaign_id}`)
}

export async function reorderFunnels(formData: FormData): Promise<void> {
  const orderedRaw = String(formData.get('ordered_ids') ?? '')
  const parsed = ReorderFunnelsInput.safeParse({
    campaign_id: formData.get('campaign_id'),
    ordered_ids: orderedRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  })
  if (!parsed.success) {
    redirect(
      `/dashboard/funnels/${String(formData.get('campaign_id') ?? '')}?error=invalid`,
    )
  }

  const { supabase, userId } = await requireUser()

  // Two-pass to avoid colliding on the unique (campaign_id, position) index:
  // first move all rows out of the contended range, then assign final values.
  const offset = 1000
  for (let i = 0; i < parsed.data.ordered_ids.length; i += 1) {
    const id = parsed.data.ordered_ids[i]
    const { error } = await supabase
      .from('funnels')
      .update({ position: offset + i })
      .eq('id', id)
      .eq('user_id', userId)
      .eq('campaign_id', parsed.data.campaign_id)
    if (error) {
      redirect(
        `/dashboard/funnels/${parsed.data.campaign_id}?error=reorder_failed&detail=${encodeURIComponent(error.message)}`,
      )
    }
  }
  for (let i = 0; i < parsed.data.ordered_ids.length; i += 1) {
    const id = parsed.data.ordered_ids[i]
    const { error } = await supabase
      .from('funnels')
      .update({ position: i })
      .eq('id', id)
      .eq('user_id', userId)
      .eq('campaign_id', parsed.data.campaign_id)
    if (error) {
      redirect(
        `/dashboard/funnels/${parsed.data.campaign_id}?error=reorder_failed&detail=${encodeURIComponent(error.message)}`,
      )
    }
  }

  revalidatePath(`/dashboard/funnels/${parsed.data.campaign_id}`)
  redirect(`/dashboard/funnels/${parsed.data.campaign_id}`)
}
