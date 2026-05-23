'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptToken } from '@/lib/facebook/crypto'
import {
  createMessengerTemplate,
  fetchMessengerTemplateStatus,
} from '@/lib/facebook/messenger-templates'
import {
  countVariables,
  isValidTemplateName,
  validateButtons,
  type MessengerMessageTemplate,
  type TemplateFormInput,
  type TemplateButton,
} from '@/lib/messenger-templates/types'
import type { TemplateCategory, MessengerMessageTemplateWithCategories } from '@/lib/messenger-templates/types'

// All mutating actions return a Result instead of throwing. Next.js redacts
// thrown server-action errors in production builds ("An error occurred in the
// Server Components render…"), which swallows the actual reason (e.g. the
// Meta rejection text). Returning a discriminated union keeps the message
// intact across the RSC boundary.
export type ActionResult<T = null> =
  | { ok: true; data: T }
  | { ok: false; error: string }

function errResult(e: unknown): { ok: false; error: string } {
  return { ok: false, error: e instanceof Error ? e.message : String(e) }
}

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

export async function loadTemplates(): Promise<MessengerMessageTemplateWithCategories[]> {
  const { supabase, userId } = await requireUser()

  const { count } = await supabase
    .from('messenger_message_templates')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  if ((count ?? 0) === 0) {
    await supabase.rpc('seed_default_message_templates', { p_user_id: userId })
  }

  const { data, error } = await supabase
    .from('messenger_message_templates')
    .select('*, messenger_template_categories(category:template_categories(id, slug, label, is_system, sort_order))')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`loadTemplates: ${error.message}`)

  return (data ?? []).map((row: Record<string, unknown>) => {
    const joins = (row.messenger_template_categories as Array<{ category: TemplateCategory }> | null) ?? []
    const { messenger_template_categories: _drop, ...rest } = row as Record<string, unknown>
    void _drop
    return {
      ...(rest as unknown as MessengerMessageTemplate),
      categories: joins
        .map((j) => j.category)
        .filter(Boolean)
        .sort((a, b) =>
          a.is_system === b.is_system
            ? (a.is_system ? a.sort_order - b.sort_order : a.label.localeCompare(b.label))
            : (a.is_system ? -1 : 1),
        ),
    }
  })
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

export async function createTemplate(
  input: TemplateFormInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, userId } = await requireUser()
    const row = normalizeInput(input)
    const { data, error } = await supabase
      .from('messenger_message_templates')
      .insert({ ...row, user_id: userId })
      .select('id')
      .single<{ id: string }>()
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        return { ok: false, error: `A template named "${row.name}" already exists.` }
      }
      return { ok: false, error: `createTemplate: ${error.message}` }
    }
    revalidatePath('/dashboard/templates')
    return { ok: true, data: { id: data.id } }
  } catch (e) {
    return errResult(e)
  }
}

export async function updateTemplate(
  id: string,
  input: TemplateFormInput,
): Promise<ActionResult<null>> {
  try {
    const { supabase, userId } = await requireUser()
    const row = normalizeInput(input)

    // Once submitted/approved, body changes require re-submission. We reset
    // the meta status back to draft so the user can re-submit explicitly.
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
    if (!existing) return { ok: false, error: 'Template not found.' }

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
        return { ok: false, error: `A template named "${row.name}" already exists.` }
      }
      return { ok: false, error: `updateTemplate: ${error.message}` }
    }
    revalidatePath('/dashboard/templates')
    return { ok: true, data: null }
  } catch (e) {
    return errResult(e)
  }
}

export async function deleteTemplate(id: string): Promise<ActionResult<null>> {
  try {
    const { supabase, userId } = await requireUser()
    const { error } = await supabase
      .from('messenger_message_templates')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
    if (error) return { ok: false, error: `deleteTemplate: ${error.message}` }
    revalidatePath('/dashboard/templates')
    return { ok: true, data: null }
  } catch (e) {
    return errResult(e)
  }
}

export async function duplicateTemplate(
  id: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, userId } = await requireUser()
    const { data: src, error: readErr } = await supabase
      .from('messenger_message_templates')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single<MessengerMessageTemplate>()
    if (readErr || !src) return { ok: false, error: 'Template not found.' }

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
        meta_status: 'draft',
      })
      .select('id')
      .single<{ id: string }>()
    if (insErr) return { ok: false, error: `duplicateTemplate: ${insErr.message}` }
    revalidatePath('/dashboard/templates')
    return { ok: true, data: { id: inserted.id } }
  } catch (e) {
    return errResult(e)
  }
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
export async function submitTemplateForReview(
  id: string,
): Promise<ActionResult<null>> {
  try {
    const { supabase, userId } = await requireUser()
    const { data: tpl } = await supabase
      .from('messenger_message_templates')
      .select('id, name, page_id, language, body_text, variable_count, sample_values, buttons, footer, meta_status')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle<MessengerMessageTemplate>()
    if (!tpl) return { ok: false, error: 'Template not found.' }
    if (tpl.meta_status !== 'draft' && tpl.meta_status !== 'rejected') {
      return { ok: false, error: `Cannot submit a template in "${tpl.meta_status}" state.` }
    }
    if (tpl.variable_count > 0 && tpl.sample_values.length < tpl.variable_count) {
      return { ok: false, error: 'Please add a sample value for every variable before submitting.' }
    }

    // Resolve target page via the admin client so we can read the encrypted
    // page_access_token. RLS on facebook_pages joins through facebook_connections
    // and would block the user-scoped client from reading the token directly.
    const admin = createAdminClient()
    const pageRow = await resolveTargetPage(admin, userId, tpl.page_id)
    if (!pageRow) {
      return {
        ok: false,
        error: 'No connected Facebook page found. Connect a page in Settings → Facebook before submitting templates.',
      }
    }
    const pageToken = decryptToken(pageRow.page_access_token)

    let metaTemplateId: string
    let metaStatusRaw: string | undefined
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
      metaStatusRaw = result.status
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // A 403 with code (#200) means the FB App is missing the
      // `pages_utility_messaging` permission — Meta never actually reviewed
      // the content. Keep the row as draft so it isn't lumped in with real
      // content rejections, and surface an actionable hint.
      const isPermissionError =
        /\b403\b/.test(msg) && /\(#200\)/.test(msg) && /pages_utility_messaging/i.test(msg)
      if (isPermissionError) {
        return {
          ok: false,
          error:
            'Your Facebook app is missing the pages_utility_messaging permission. Request it in App Review on the Meta App Dashboard, then re-submit.',
        }
      }
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
      return { ok: false, error: `Meta rejected the submission: ${msg}` }
    }

    // Meta returns the approval state synchronously in the create response. For
    // utility templates with simple bodies and no risky buttons, the status is
    // commonly 'APPROVED' immediately. Honor it so we don't sit in a fake
    // pending state — the page-level webhook for `message_template_status_update`
    // is unreliable on Messenger and may never arrive.
    const localStatus = mapMetaStatus(metaStatusRaw)
    const now = new Date().toISOString()
    await admin
      .from('messenger_message_templates')
      .update({
        meta_status: localStatus,
        meta_template_id: metaTemplateId,
        page_id: pageRow.id,
        submitted_at: now,
        approved_at: localStatus === 'approved' ? now : null,
        meta_rejection_reason: null,
      })
      .eq('id', id)
    revalidatePath('/dashboard/templates')
    return { ok: true, data: null }
  } catch (e) {
    return errResult(e)
  }
}

function mapMetaStatus(raw: string | undefined): 'approved' | 'pending' | 'rejected' | 'disabled' {
  switch ((raw ?? '').toUpperCase()) {
    case 'APPROVED': return 'approved'
    case 'REJECTED': return 'rejected'
    case 'DISABLED': return 'disabled'
    default: return 'pending'
  }
}

/**
 * Manually re-poll Meta for the current status of a submitted template.
 * The `message_template_status_update` webhook isn't reliably delivered to
 * Messenger pages, so the user can use this to flip pending → approved
 * without waiting on Meta to push us anything.
 */
export async function refreshTemplateStatus(
  id: string,
): Promise<ActionResult<null>> {
  try {
    const { supabase, userId } = await requireUser()
    const { data: tpl } = await supabase
      .from('messenger_message_templates')
      .select('id, name, language, page_id, meta_status, meta_template_id')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle<MessengerMessageTemplate>()
    if (!tpl) return { ok: false, error: 'Template not found.' }
    if (tpl.meta_status === 'draft') {
      return { ok: false, error: 'This template has not been submitted yet.' }
    }

    const admin = createAdminClient()
    const pageRow = await resolveTargetPage(admin, userId, tpl.page_id)
    if (!pageRow) return { ok: false, error: 'No connected Facebook page found.' }

    const pageToken = decryptToken(pageRow.page_access_token)
    const result = await fetchMessengerTemplateStatus({
      fbPageId: pageRow.fb_page_id,
      pageAccessToken: pageToken,
      name: tpl.name,
      language: tpl.language,
    })
    if (!result) {
      return { ok: false, error: 'Meta has no record of this template under that name + language.' }
    }

    const localStatus = mapMetaStatus(result.status)
    const update: Record<string, unknown> = {
      meta_status: localStatus,
      meta_rejection_reason: localStatus === 'rejected' ? result.rejected_reason : null,
    }
    if (!tpl.meta_template_id) update.meta_template_id = result.id
    if (localStatus === 'approved') update.approved_at = new Date().toISOString()

    await admin.from('messenger_message_templates').update(update).eq('id', id)
    revalidatePath('/dashboard/templates')
    return { ok: true, data: null }
  } catch (e) {
    return errResult(e)
  }
}

/**
 * Move every 'rejected' template owned by the calling user back to 'draft',
 * clearing the rejection reason and submission timestamps. Useful after the
 * underlying cause (e.g. a missing `pages_utility_messaging` permission)
 * is resolved on the Meta side, so the user can re-submit cleanly without
 * touching each row individually.
 */
export async function resetRejectedTemplates(): Promise<
  ActionResult<{ reset: number }>
> {
  try {
    const { supabase, userId } = await requireUser()
    const { data, error } = await supabase
      .from('messenger_message_templates')
      .update({
        meta_status: 'draft',
        meta_rejection_reason: null,
        submitted_at: null,
        approved_at: null,
        meta_template_id: null,
      })
      .eq('user_id', userId)
      .eq('meta_status', 'rejected')
      .select('id')
    if (error) return { ok: false, error: `resetRejectedTemplates: ${error.message}` }
    revalidatePath('/dashboard/templates')
    return { ok: true, data: { reset: data?.length ?? 0 } }
  } catch (e) {
    return errResult(e)
  }
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

/* ── categories ── */

export async function listCategories(): Promise<TemplateCategory[]> {
  const { supabase } = await requireUser()
  const { data, error } = await supabase
    .from('template_categories')
    .select('id, slug, label, is_system, sort_order')
    .order('is_system', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })
  if (error) throw new Error(`listCategories: ${error.message}`)
  return (data ?? []) as TemplateCategory[]
}

function slugify(label: string): string {
  return label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48)
}

export async function createCategory(
  label: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { supabase, userId } = await requireUser()
    const trimmed = label.trim()
    if (!trimmed) return { ok: false, error: 'Category label is required.' }
    const slug = slugify(trimmed)
    if (!slug) {
      return { ok: false, error: 'Category label must contain at least one letter or digit.' }
    }
    const { data, error } = await supabase
      .from('template_categories')
      .insert({ user_id: userId, slug, label: trimmed, is_system: false })
      .select('id')
      .single<{ id: string }>()
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        return { ok: false, error: `A category named "${trimmed}" already exists.` }
      }
      return { ok: false, error: `createCategory: ${error.message}` }
    }
    revalidatePath('/dashboard/templates')
    return { ok: true, data: { id: data.id } }
  } catch (e) {
    return errResult(e)
  }
}

export async function deleteCategory(id: string): Promise<ActionResult<null>> {
  try {
    const { supabase } = await requireUser()
    const { data: row } = await supabase
      .from('template_categories')
      .select('is_system')
      .eq('id', id)
      .maybeSingle<{ is_system: boolean }>()
    if (!row) return { ok: false, error: 'Category not found.' }
    if (row.is_system) return { ok: false, error: 'System categories cannot be deleted.' }
    const { error } = await supabase.from('template_categories').delete().eq('id', id)
    if (error) return { ok: false, error: `deleteCategory: ${error.message}` }
    revalidatePath('/dashboard/templates')
    return { ok: true, data: null }
  } catch (e) {
    return errResult(e)
  }
}

export async function setTemplateCategories(
  templateId: string,
  categoryIds: string[],
): Promise<ActionResult<null>> {
  try {
    const { supabase, userId } = await requireUser()
    const { data: tpl } = await supabase
      .from('messenger_message_templates')
      .select('id')
      .eq('id', templateId)
      .eq('user_id', userId)
      .maybeSingle()
    if (!tpl) return { ok: false, error: 'Template not found.' }

    const { error: delErr } = await supabase
      .from('messenger_template_categories')
      .delete()
      .eq('template_id', templateId)
    if (delErr) {
      return { ok: false, error: `setTemplateCategories (clear): ${delErr.message}` }
    }

    const unique = Array.from(new Set(categoryIds))
    if (unique.length === 0) {
      revalidatePath('/dashboard/templates')
      return { ok: true, data: null }
    }

    const rows = unique.map((category_id) => ({ template_id: templateId, category_id }))
    const { error: insErr } = await supabase
      .from('messenger_template_categories')
      .insert(rows)
    if (insErr) {
      return { ok: false, error: `setTemplateCategories (insert): ${insErr.message}` }
    }
    revalidatePath('/dashboard/templates')
    return { ok: true, data: null }
  } catch (e) {
    return errResult(e)
  }
}
