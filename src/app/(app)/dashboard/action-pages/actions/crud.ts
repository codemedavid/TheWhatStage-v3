'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { KIND_REGISTRY, isActionPageKind } from '@/lib/action-pages/kinds'
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
  const raw = {
    kind: formData.get('kind'),
    title: formData.get('title'),
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
    pipeline_rules = JSON.parse(String(formData.get('pipeline_rules') ?? '[]'))
  } catch {
    pipeline_rules = []
  }
  const notificationText = String(formData.get('notification_text') ?? '').trim()

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
  const update: Record<string, unknown> = {
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    slug: parsed.data.slug,
    status: parsed.data.status,
    pipeline_rules: parsed.data.pipeline_rules,
    notification_template: parsed.data.notification_template ?? null,
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
  redirect(`/dashboard/action-pages/${parsed.data.id}?saved=1`)
}

export async function deleteActionPage(formData: FormData): Promise<void> {
  const parsed = DeleteActionPageInput.safeParse({ id: formData.get('id') })
  if (!parsed.success) redirect('/dashboard/action-pages?error=invalid')

  const { supabase, userId } = await requireUser()
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
  redirect('/dashboard/action-pages')
}
