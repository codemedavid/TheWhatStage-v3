'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  loadManagedFollowups,
  saveManagedFollowups,
  resetManualEdit,
  type ManagedFollowupsLoadResult,
} from '@/lib/workflow/booking-followups-persistence'
import type { FollowupTouchpoint } from '@/lib/workflow/booking-followups'

async function requireUserAndPage(pageId: string): Promise<{
  userId: string
  pageTitle: string
  pageKind: string
}> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: page } = await supabase
    .from('action_pages')
    .select('id, user_id, title, kind')
    .eq('id', pageId)
    .maybeSingle<{ id: string; user_id: string; title: string | null; kind: string }>()

  if (!page || page.user_id !== user.id) {
    throw new Error('not_found_or_forbidden')
  }
  return { userId: user.id, pageTitle: page.title ?? 'Booking', pageKind: page.kind }
}

export interface ApprovedTemplateOption {
  id: string
  name: string
  display_name: string
  language: string
  body_text: string
  variable_count: number
  buttons: Array<{ type: string; index?: number; url?: string; text?: string }>
}

export async function loadFollowupsForPage(pageId: string): Promise<{
  managed: ManagedFollowupsLoadResult | null
  approvedTemplates: ApprovedTemplateOption[]
}> {
  const { userId } = await requireUserAndPage(pageId)
  const admin = createAdminClient()

  const managed = await loadManagedFollowups(admin, pageId)

  const { data: tpls } = await admin
    .from('messenger_message_templates')
    .select('id, name, display_name, language, body_text, variable_count, buttons, meta_status')
    .eq('user_id', userId)
    .eq('meta_status', 'approved')
    .order('display_name', { ascending: true })

  const approvedTemplates: ApprovedTemplateOption[] = (tpls ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    display_name: t.display_name as string,
    language: t.language as string,
    body_text: t.body_text as string,
    variable_count: t.variable_count as number,
    buttons: (t.buttons ?? []) as ApprovedTemplateOption['buttons'],
  }))

  return { managed, approvedTemplates }
}

export async function saveFollowupsForPage(
  pageId: string,
  touchpoints: FollowupTouchpoint[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { userId, pageTitle } = await requireUserAndPage(pageId)
  const admin = createAdminClient()
  const result = await saveManagedFollowups(admin, {
    userId,
    pageId,
    pageTitle,
    touchpoints,
  })
  if (!result.ok) return { ok: false, reason: result.reason }
  revalidatePath(`/dashboard/action-pages/${pageId}`)
  return { ok: true }
}

export async function resetFollowupManagementForPage(pageId: string): Promise<void> {
  await requireUserAndPage(pageId)
  const admin = createAdminClient()
  await resetManualEdit(admin, pageId)
  revalidatePath(`/dashboard/action-pages/${pageId}`)
}
