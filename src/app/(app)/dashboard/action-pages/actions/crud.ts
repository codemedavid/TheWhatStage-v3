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
import { parseRealestateConfig } from '@/app/a/[slug]/_kinds/realestate/schema'
import { parseSalesConfig } from '@/app/a/[slug]/_kinds/sales/schema'
import { syncRealestateToBusinessItems, syncSalesToBusinessItems } from '@/lib/action-pages/rag/sync'

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
      status: meta.defaultStatusOnCreate,
      config: meta.defaultConfig,
      pipeline_rules: meta.defaultPipelineRules.map((r) => ({
        outcome: r.outcome,
        to_stage_id: null,
        reason: r.reason,
      })),
      cta_label: meta.defaultCtaLabel,
      notification_template: { text: meta.defaultNotificationText },
      bot_send_instructions: meta.defaultBotSendInstructions,
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
    .select('slug, kind, status, title')
    .eq('id', parsed.data.id)
    .eq('user_id', userId)
    .maybeSingle<{ slug: string; kind: string; status: 'draft' | 'published' | 'archived'; title: string }>()

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

  // Sync properties/products into business_items for RAG
  if (parsed.data.config !== undefined && existing) {
    const kind = existing.kind
    if (kind === 'realestate') {
      const realestateConfig = parseRealestateConfig(parsed.data.config)
      syncRealestateToBusinessItems(supabase, userId, parsed.data.id, realestateConfig).catch((err) => {
        console.error('[rag.sync] realestate sync failed', err)
      })
    } else if (kind === 'sales') {
      const salesConfig = parseSalesConfig(parsed.data.config)
      syncSalesToBusinessItems(supabase, userId, parsed.data.id, parsed.data.slug, salesConfig).catch((err) => {
        console.error('[rag.sync] sales sync failed', err)
      })
    }
  }

  revalidatePath('/dashboard/action-pages')
  revalidatePath(`/dashboard/action-pages/${parsed.data.id}`)
  updateTag(actionPageSlugTag(parsed.data.slug))
  if (existing?.slug && existing.slug !== parsed.data.slug) {
    updateTag(actionPageSlugTag(existing.slug))
  }
  // Detect transitions touching the chatbot's primary goal:
  //   - non-published -> published: maybe auto-assign or offer/switch banner
  //   - published -> non-published: clear stale primary_action_page_id if it
  //     points to this page (keeps settings dropdown and DB consistent)
  let primaryGoalRedirect: 'offer' | 'switch' | null = null
  const becamePublished =
    !!existing && existing.status !== 'published' && parsed.data.status === 'published'
  const leftPublished =
    !!existing && existing.status === 'published' && parsed.data.status !== 'published'

  if (becamePublished) {
    const { data: cfg } = await supabase
      .from('chatbot_configs')
      .select('primary_action_page_id')
      .eq('user_id', userId)
      .maybeSingle<{ primary_action_page_id: string | null }>()
    const currentGoalId = cfg?.primary_action_page_id ?? null

    if (currentGoalId === parsed.data.id) {
      // Already the goal — nothing to do.
    } else if (currentGoalId === null) {
      const { count } = await supabase
        .from('action_pages')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'published')
        .neq('id', parsed.data.id)
      if ((count ?? 0) === 0) {
        await supabase
          .from('chatbot_configs')
          .upsert(
            { user_id: userId, primary_action_page_id: parsed.data.id },
            { onConflict: 'user_id' },
          )
        revalidatePath('/dashboard/chatbot')
        revalidatePath('/dashboard/action-pages')
      } else {
        primaryGoalRedirect = 'offer'
      }
    } else {
      primaryGoalRedirect = 'switch'
    }
  } else if (leftPublished) {
    const { data: cfg } = await supabase
      .from('chatbot_configs')
      .select('primary_action_page_id')
      .eq('user_id', userId)
      .maybeSingle<{ primary_action_page_id: string | null }>()
    if (cfg?.primary_action_page_id === parsed.data.id) {
      await supabase
        .from('chatbot_configs')
        .update({ primary_action_page_id: null })
        .eq('user_id', userId)
      revalidatePath('/dashboard/chatbot')
      revalidatePath('/dashboard/action-pages')
    }
  }

  const params = new URLSearchParams({ saved: '1' })
  if (primaryGoalRedirect) {
    params.set('just_published', '1')
    params.set('offer_primary', primaryGoalRedirect)
  }
  redirect(`/dashboard/action-pages/${parsed.data.id}?${params.toString()}`)
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
