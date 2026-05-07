'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { KIND_REGISTRY, isActionPageKind } from '@/lib/action-pages/kinds'
import { actionPageSlugTag } from '@/app/a/[slug]/_lib/load'
import {
  CreateActionPageInput,
  DeleteActionPageInput,
  UpdateActionPageInput,
} from '../_lib/schemas'
import { slugifyTitle } from '../_lib/slug'

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

export async function createActionPage(formData: FormData): Promise<void> {
  const rawDescription = String(formData.get('description') ?? '').trim()
  const raw = {
    kind: formData.get('kind'),
    title: formData.get('title'),
    description: rawDescription.length > 0 ? rawDescription : undefined,
  }
  const parsed = CreateActionPageInput.safeParse(raw)
  if (!parsed.success) {
    redirect('/dashboard/action-pages/new?error=invalid')
  }
  if (!isActionPageKind(parsed.data.kind)) {
    redirect('/dashboard/action-pages/new?error=invalid_kind')
  }
  const meta = KIND_REGISTRY[parsed.data.kind]

  const { supabase, userId } = await requireUser()

  const slug = slugifyTitle(parsed.data.title)
  const { data, error } = await supabase
    .from('action_pages')
    .insert({
      user_id: userId,
      kind: parsed.data.kind,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      slug,
      status: 'draft',
      config: meta.defaultConfig,
      pipeline_rules: meta.defaultPipelineRules.map((r) => ({
        outcome: r.outcome,
        to_stage_id: null,
        reason: r.reason,
      })),
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !data) {
    redirect(
      `/dashboard/action-pages/new?error=create_failed&detail=${encodeURIComponent(error?.message ?? 'unknown')}`,
    )
  }

  revalidatePath('/dashboard/action-pages')
  redirect(`/dashboard/action-pages/${data.id}`)
}

export async function updateActionPage(formData: FormData): Promise<void> {
  let pipeline_rules: unknown
  try {
    const raw = JSON.parse(String(formData.get('pipeline_rules') ?? '[]'))
    // Filter out incomplete rules (empty outcome) so they don't block the save.
    pipeline_rules = Array.isArray(raw)
      ? raw.filter((r: { outcome?: string }) => typeof r.outcome === 'string' && r.outcome.trim().length > 0)
      : []
  } catch {
    pipeline_rules = []
  }
  const notificationText = String(formData.get('notification_text') ?? '').trim()
  const ctaLabelRaw = String(formData.get('cta_label') ?? '').trim()
  const botInstructionsRaw = String(formData.get('bot_send_instructions') ?? '').trim()

  let config: unknown = undefined
  const rawConfig = formData.get('config')
  if (typeof rawConfig === 'string' && rawConfig.length > 0) {
    try {
      config = JSON.parse(rawConfig)
    } catch {
      config = undefined
    }
  }

  const raw: Record<string, unknown> = {
    id: formData.get('id'),
    title: formData.get('title'),
    description: (formData.get('description') as string | null) || null,
    slug: String(formData.get('slug') ?? '')
      .trim()
      .toLowerCase(),
    status: formData.get('status'),
    pipeline_rules,
    notification_template: notificationText ? { text: notificationText } : null,
    cta_label: ctaLabelRaw ? ctaLabelRaw.slice(0, 50) : null,
    bot_send_instructions: botInstructionsRaw ? botInstructionsRaw.slice(0, 2000) : null,
  }
  if (config !== undefined) raw.config = config
  const parsed = UpdateActionPageInput.safeParse(raw)
  if (!parsed.success) {
    const id = String(formData.get('id') ?? '')
    redirect(
      `/dashboard/action-pages/${id}?error=invalid&detail=${encodeURIComponent(
        parsed.error.issues[0]?.message ?? 'invalid input',
      )}`,
    )
  }

  const { supabase, userId } = await requireUser()

  const { data: existing } = await supabase
    .from('action_pages')
    .select('slug')
    .eq('id', parsed.data.id)
    .eq('user_id', userId)
    .maybeSingle<{ slug: string }>()

  const update: Record<string, unknown> = {
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    slug: parsed.data.slug,
    status: parsed.data.status,
    pipeline_rules: parsed.data.pipeline_rules,
    notification_template: parsed.data.notification_template ?? null,
    cta_label: parsed.data.cta_label ?? null,
    bot_send_instructions: parsed.data.bot_send_instructions ?? null,
  }
  if (parsed.data.config !== undefined) update.config = parsed.data.config

  const { error } = await supabase
    .from('action_pages')
    .update(update)
    .eq('id', parsed.data.id)
    .eq('user_id', userId)
  if (error) {
    redirect(
      `/dashboard/action-pages/${parsed.data.id}?error=update_failed&detail=${encodeURIComponent(error.message)}`,
    )
  }

  revalidatePath('/dashboard/action-pages')
  revalidatePath(`/dashboard/action-pages/${parsed.data.id}`)
  updateTag(actionPageSlugTag(parsed.data.slug))
  if (existing?.slug && existing.slug !== parsed.data.slug) {
    updateTag(actionPageSlugTag(existing.slug))
  }
  redirect(`/dashboard/action-pages/${parsed.data.id}?saved=1`)
}

export async function deleteActionPage(formData: FormData): Promise<void> {
  const parsed = DeleteActionPageInput.safeParse({ id: formData.get('id') })
  if (!parsed.success) redirect('/dashboard/action-pages?error=invalid')

  const { supabase, userId } = await requireUser()
  const { data: existing } = await supabase
    .from('action_pages')
    .select('slug')
    .eq('id', parsed.data.id)
    .eq('user_id', userId)
    .maybeSingle<{ slug: string }>()
  const { error } = await supabase
    .from('action_pages')
    .delete()
    .eq('id', parsed.data.id)
    .eq('user_id', userId)
  if (error) {
    redirect(
      `/dashboard/action-pages?error=delete_failed&detail=${encodeURIComponent(error.message)}`,
    )
  }
  revalidatePath('/dashboard/action-pages')
  if (existing?.slug) updateTag(actionPageSlugTag(existing.slug))
  redirect('/dashboard/action-pages')
}
