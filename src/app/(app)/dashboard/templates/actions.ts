'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptToken } from '@/lib/facebook/crypto'
import { createMessengerTemplate } from '@/lib/facebook/messenger-templates'
import {
  countVariables,
  isValidTemplateName,
  validateButtons,
  type MessengerMessageTemplate,
  type TemplateFormInput,
  type TemplateButton,
} from '@/lib/messenger-templates/types'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

export async function loadTemplates(): Promise<MessengerMessageTemplate[]> {
  const { supabase, userId } = await requireUser()

  // First-visit seeding: if the user has no templates yet, populate the
  // 28 defaults via the SECURITY DEFINER seeder. Idempotent — the function
  // ON CONFLICT DO NOTHINGs.
  const { count } = await supabase
    .from('messenger_message_templates')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  if ((count ?? 0) === 0) {
    await supabase.rpc('seed_default_message_templates', { p_user_id: userId })
  }

  const { data, error } = await supabase
    .from('messenger_message_templates')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`loadTemplates: ${error.message}`)
  return (data ?? []) as MessengerMessageTemplate[]
}

function normalizeInput(input: TemplateFormInput) {
  const name = input.name.trim().toLowerCase()
  if (!isValidTemplateName(name)) {
    throw new Error('Template name must be lowercase letters, digits, or underscores (≤64 chars).')
  }
  if (!input.display_name.trim()) throw new Error('Display name is required.')
  if (!input.body_text.trim()) throw new Error('Body text is required.')

  const variable_count = countVariables(input.body_text)
  const sample_values = (input.sample_values ?? []).slice(0, variable_count)
  if (variable_count > 0 && sample_values.length < variable_count) {
    throw new Error(`This template has ${variable_count} variables — please provide a sample value for each.`)
  }
  for (const v of sample_values) {
    if (!v?.trim()) throw new Error('Sample values cannot be blank.')
  }

  const buttons: TemplateButton[] = input.buttons ?? []
  const buttonErr = validateButtons(buttons)
  if (buttonErr) throw new Error(buttonErr)

  return {
    name,
    display_name: input.display_name.trim(),
    language: (input.language || 'en_US').trim(),
    body_text: input.body_text.trim(),
    variable_count,
    sample_values,
    buttons,
    header: input.header ?? null,
    footer: input.footer?.trim() || null,
    page_id: input.page_id ?? null,
  }
}

export async function createTemplate(input: TemplateFormInput): Promise<string> {
  const { supabase, userId } = await requireUser()
  const row = normalizeInput(input)
  const { data, error } = await supabase
    .from('messenger_message_templates')
    .insert({ ...row, user_id: userId })
    .select('id')
    .single<{ id: string }>()
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new Error(`A template named "${row.name}" already exists.`)
    }
    throw new Error(`createTemplate: ${error.message}`)
  }
  revalidatePath('/dashboard/templates')
  return data.id
}

export async function updateTemplate(
  id: string,
  input: TemplateFormInput,
): Promise<void> {
  const { supabase, userId } = await requireUser()
  const row = normalizeInput(input)

  // Once submitted/approved, body changes require re-submission. We reset
  // the meta status back to draft so the user is forced to re-submit.
  const { data: existing } = await supabase
    .from('messenger_message_templates')
    .select('meta_status, body_text, buttons, language')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle<{
      meta_status: string
      body_text: string
      buttons: TemplateButton[]
      language: string
    }>()
  if (!existing) throw new Error('Template not found.')

  const reviewable =
    existing.body_text !== row.body_text ||
    existing.language !== row.language ||
    JSON.stringify(existing.buttons) !== JSON.stringify(row.buttons)
  const resetStatus = reviewable && existing.meta_status !== 'draft'

  const { error } = await supabase
    .from('messenger_message_templates')
    .update({
      ...row,
      ...(resetStatus
        ? {
            meta_status: 'draft',
            meta_template_id: null,
            meta_rejection_reason: null,
            submitted_at: null,
            approved_at: null,
          }
        : {}),
    })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new Error(`A template named "${row.name}" already exists.`)
    }
    throw new Error(`updateTemplate: ${error.message}`)
  }
  revalidatePath('/dashboard/templates')
}

export async function deleteTemplate(id: string): Promise<void> {
  const { supabase, userId } = await requireUser()
  const { error } = await supabase
    .from('messenger_message_templates')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`deleteTemplate: ${error.message}`)
  revalidatePath('/dashboard/templates')
}

export async function duplicateTemplate(id: string): Promise<string> {
  const { supabase, userId } = await requireUser()
  const { data: src, error: readErr } = await supabase
    .from('messenger_message_templates')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .single<MessengerMessageTemplate>()
  if (readErr || !src) throw new Error('Template not found.')

  // Find an unused name suffix.
  const base = src.name
  let suffix = 2
  let candidate = `${base}_copy`
  while (true) {
    const { data: hit } = await supabase
      .from('messenger_message_templates')
      .select('id')
      .eq('user_id', userId)
      .eq('name', candidate)
      .maybeSingle()
    if (!hit) break
    candidate = `${base}_copy${suffix++}`
  }

  const { data: inserted, error: insErr } = await supabase
    .from('messenger_message_templates')
    .insert({
      user_id: userId,
      page_id: src.page_id,
      name: candidate,
      display_name: `${src.display_name} (copy)`,
      language: src.language,
      body_text: src.body_text,
      variable_count: src.variable_count,
      sample_values: src.sample_values,
      buttons: src.buttons,
      header: src.header,
      footer: src.footer,
      // Always start a duplicate as draft — no carry-over of Meta state.
      meta_status: 'draft',
    })
    .select('id')
    .single<{ id: string }>()
  if (insErr) throw new Error(`duplicateTemplate: ${insErr.message}`)
  revalidatePath('/dashboard/templates')
  return inserted.id
}

/**
 * Submit a template to Meta's Message Templates API. Resolves a target page
 * (the template's pinned `page_id`, falling back to the user's first
 * connected page), calls the Graph API, and stores the returned template id
 * + status. The webhook handler at /api/webhooks/facebook receives
 * `message_template_status_update` events and flips the row to approved /
 * rejected as Meta finishes its review.
 *
 * Failures from Meta are surfaced verbatim so the user can fix the body
 * (length, disallowed phrases, missing samples) and retry.
 */
export async function submitTemplateForReview(id: string): Promise<void> {
  const { supabase, userId } = await requireUser()
  const { data: tpl } = await supabase
    .from('messenger_message_templates')
    .select('id, name, page_id, language, body_text, variable_count, sample_values, buttons, footer, meta_status')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle<MessengerMessageTemplate>()
  if (!tpl) throw new Error('Template not found.')
  if (tpl.meta_status !== 'draft' && tpl.meta_status !== 'rejected') {
    throw new Error(`Cannot submit a template in "${tpl.meta_status}" state.`)
  }
  if (tpl.variable_count > 0 && tpl.sample_values.length < tpl.variable_count) {
    throw new Error('Please add a sample value for every variable before submitting.')
  }

  // Resolve target page via the admin client so we can read the encrypted
  // page_access_token. RLS on facebook_pages joins through facebook_connections
  // and would block the user-scoped client from reading the token directly.
  const admin = createAdminClient()
  const pageRow = await resolveTargetPage(admin, userId, tpl.page_id)
  if (!pageRow) {
    throw new Error(
      'No connected Facebook page found. Connect a page in Settings → Facebook before submitting templates.',
    )
  }

  const pageToken = decryptToken(pageRow.page_access_token)

  let metaTemplateId: string
  try {
    const result = await createMessengerTemplate({
      fbPageId: pageRow.fb_page_id,
      pageAccessToken: pageToken,
      name: tpl.name,
      language: tpl.language,
      bodyText: tpl.body_text,
      sampleValues: tpl.sample_values,
      buttons: tpl.buttons,
      footer: tpl.footer,
    })
    metaTemplateId = result.id
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    // Persist the rejection reason so it shows up in the UI without the user
    // needing to re-trigger the submit just to read the error.
    await admin
      .from('messenger_message_templates')
      .update({
        meta_status: 'rejected',
        meta_rejection_reason: msg,
        submitted_at: new Date().toISOString(),
      })
      .eq('id', id)
    revalidatePath('/dashboard/templates')
    throw new Error(`Meta rejected the submission: ${msg}`)
  }

  await admin
    .from('messenger_message_templates')
    .update({
      meta_status: 'pending',
      meta_template_id: metaTemplateId,
      // Pin the page that was used so future webhook events can be matched
      // back even if the user later edits the template's page_id.
      page_id: pageRow.id,
      submitted_at: new Date().toISOString(),
      meta_rejection_reason: null,
    })
    .eq('id', id)
  revalidatePath('/dashboard/templates')
}

interface ResolvedPage {
  id: string
  fb_page_id: string
  page_access_token: string
}

async function resolveTargetPage(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  preferredPageId: string | null,
): Promise<ResolvedPage | null> {
  if (preferredPageId) {
    const { data } = await admin
      .from('facebook_pages')
      .select('id, fb_page_id, page_access_token, facebook_connections!inner(user_id)')
      .eq('id', preferredPageId)
      .eq('facebook_connections.user_id', userId)
      .maybeSingle<ResolvedPage & { facebook_connections: unknown }>()
    if (data) return { id: data.id, fb_page_id: data.fb_page_id, page_access_token: data.page_access_token }
  }
  const { data } = await admin
    .from('facebook_pages')
    .select('id, fb_page_id, page_access_token, facebook_connections!inner(user_id)')
    .eq('facebook_connections.user_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle<ResolvedPage & { facebook_connections: unknown }>()
  if (!data) return null
  return { id: data.id, fb_page_id: data.fb_page_id, page_access_token: data.page_access_token }
}
