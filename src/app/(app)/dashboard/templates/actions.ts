'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptToken } from '@/lib/facebook/crypto'
import {
  createMessengerTemplate,
  fetchAllMessengerTemplates,
  MetaTemplateError,
} from '@/lib/facebook/messenger-templates'
import { resolveTargetPage } from '@/lib/facebook/templates-page-resolver'
import { mapMetaStatus, buildStatusUpdate } from '@/lib/messenger-templates/statusFlip'
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

/** Per-template result of a bulk submit-to-Meta. Partial failure is first-class. */
export interface SubmitOutcome {
  id: string
  outcome: 'approved' | 'pending' | 'rejected' | 'permission_error' | 'error'
  error?: string
  row?: MessengerMessageTemplateWithCategories
}

/** Per-template result of a bulk status refresh; only changed rows carry a row. */
export interface RefreshOutcome {
  id: string
  changed: boolean
  row?: MessengerMessageTemplateWithCategories
}

function errResult(e: unknown): { ok: false; error: string } {
  return { ok: false, error: e instanceof Error ? e.message : String(e) }
}

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

// One projection for "template + its categories", reused by loadTemplates and
// by every mutation that re-reads a row so the client can merge it into state
// (instead of a full page reload).
const ROW_SELECT =
  '*, messenger_template_categories(category:template_categories(id, slug, label, is_system, sort_order))'

function catSort(a: TemplateCategory, b: TemplateCategory): number {
  return a.is_system === b.is_system
    ? (a.is_system ? a.sort_order - b.sort_order : a.label.localeCompare(b.label))
    : (a.is_system ? -1 : 1)
}

function mapRow(row: Record<string, unknown>): MessengerMessageTemplateWithCategories {
  const joins = (row.messenger_template_categories as Array<{ category: TemplateCategory }> | null) ?? []
  const { messenger_template_categories: _drop, ...rest } = row as Record<string, unknown>
  void _drop
  return {
    ...(rest as unknown as MessengerMessageTemplate),
    categories: joins.map((j) => j.category).filter(Boolean).sort(catSort),
  }
}

type UserClient = Awaited<ReturnType<typeof requireUser>>['supabase']

async function fetchRow(
  supabase: UserClient,
  userId: string,
  id: string,
): Promise<MessengerMessageTemplateWithCategories | null> {
  const { data } = await supabase
    .from('messenger_message_templates')
    .select(ROW_SELECT)
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle<Record<string, unknown>>()
  return data ? mapRow(data) : null
}

async function fetchRowsByIds(
  supabase: UserClient,
  userId: string,
  ids: string[],
): Promise<Map<string, MessengerMessageTemplateWithCategories>> {
  const out = new Map<string, MessengerMessageTemplateWithCategories>()
  if (ids.length === 0) return out
  const { data } = await supabase
    .from('messenger_message_templates')
    .select(ROW_SELECT)
    .in('id', ids)
    .eq('user_id', userId)
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const mapped = mapRow(row)
    out.set(mapped.id, mapped)
  }
  return out
}

export async function loadTemplates(): Promise<MessengerMessageTemplateWithCategories[]> {
  const { supabase, userId } = await requireUser()

  // Seed default templates exactly once per user, tracked by a marker on the
  // profile. (The old `count === 0` check re-seeded the defaults whenever a
  // user deleted all of their templates — deletions never stuck.)
  const { data: profile } = await supabase
    .from('profiles')
    .select('templates_seeded_at')
    .eq('id', userId)
    .maybeSingle<{ templates_seeded_at: string | null }>()
  if (profile && !profile.templates_seeded_at) {
    await supabase.rpc('seed_default_message_templates', { p_user_id: userId })
    await supabase
      .from('profiles')
      .update({ templates_seeded_at: new Date().toISOString() })
      .eq('id', userId)
  }

  const { data, error } = await supabase
    .from('messenger_message_templates')
    .select(ROW_SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`loadTemplates: ${error.message}`)

  return (data ?? []).map((row) => mapRow(row as Record<string, unknown>))
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
): Promise<ActionResult<MessengerMessageTemplateWithCategories>> {
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
    const created = await fetchRow(supabase, userId, data.id)
    if (!created) return { ok: false, error: 'createTemplate: row not found after insert.' }
    revalidatePath('/dashboard/templates')
    return { ok: true, data: created }
  } catch (e) {
    return errResult(e)
  }
}

export async function updateTemplate(
  id: string,
  input: TemplateFormInput,
): Promise<ActionResult<MessengerMessageTemplateWithCategories>> {
  try {
    const { supabase, userId } = await requireUser()
    const row = normalizeInput(input)

    // Once submitted/approved, changes to anything Meta reviewed require
    // re-submission, so we reset to draft. The reviewable surface includes the
    // NAME (a renamed template orphans the already-registered Meta template
    // under the old name) and the FOOTER, in addition to body/language/buttons.
    const { data: existing } = await supabase
      .from('messenger_message_templates')
      .select('meta_status, name, body_text, buttons, language, footer')
      .eq('id', id)
      .eq('user_id', userId)
      .maybeSingle<{
        meta_status: string
        name: string
        body_text: string
        buttons: TemplateButton[]
        language: string
        footer: string | null
      }>()
    if (!existing) return { ok: false, error: 'Template not found.' }

    const reviewable =
      existing.name !== row.name ||
      existing.body_text !== row.body_text ||
      existing.language !== row.language ||
      (existing.footer ?? null) !== (row.footer ?? null) ||
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
    const updated = await fetchRow(supabase, userId, id)
    if (!updated) return { ok: false, error: 'updateTemplate: row not found after update.' }
    revalidatePath('/dashboard/templates')
    return { ok: true, data: updated }
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
): Promise<ActionResult<MessengerMessageTemplateWithCategories>> {
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
    const copy = await fetchRow(supabase, userId, inserted.id)
    if (!copy) return { ok: false, error: 'duplicateTemplate: row not found after insert.' }
    revalidatePath('/dashboard/templates')
    return { ok: true, data: copy }
  } catch (e) {
    return errResult(e)
  }
}

/**
 * Submit one or more templates to Meta's Message Templates API in a single
 * call. Partial success is first-class: the result is ok:true with a per-id
 * outcome array even when some rows fail. The target page (+ token) is resolved
 * ONCE per distinct page so a bulk submit doesn't re-query per row.
 *
 * Meta returns the approval state synchronously in the create response — utility
 * templates with simple bodies often come back APPROVED immediately, so we honor
 * it rather than sitting in a fake 'pending' state (the page-level
 * message_template_status_update webhook is unreliable for Messenger pages; the
 * status-poll cron + live poll are the backstop).
 *
 * A permission error (Meta code 200 — missing pages_utility_messaging) is
 * detected via the structured MetaTemplateError, NOT a regex on the message, and
 * leaves the row as 'draft' (re-submittable) rather than bucketing it into
 * 'rejected' alongside real content rejections.
 */
export async function submitTemplatesForReview(
  ids: string[],
): Promise<ActionResult<SubmitOutcome[]>> {
  try {
    const { supabase, userId } = await requireUser()
    const uniqueIds = Array.from(new Set(ids)).filter(Boolean)
    if (uniqueIds.length === 0) return { ok: true, data: [] }

    const { data: rows } = await supabase
      .from('messenger_message_templates')
      .select('id, name, page_id, language, body_text, variable_count, sample_values, buttons, footer, meta_status')
      .in('id', uniqueIds)
      .eq('user_id', userId)
    const rowsById = new Map<string, MessengerMessageTemplate>(
      (rows ?? []).map((r) => [(r as MessengerMessageTemplate).id, r as MessengerMessageTemplate]),
    )

    const admin = createAdminClient()
    const pageCache = new Map<string | null, Awaited<ReturnType<typeof resolveTargetPage>>>()
    async function getPage(pageId: string | null) {
      const key = pageId ?? null
      if (!pageCache.has(key)) pageCache.set(key, await resolveTargetPage(admin, userId, key))
      return pageCache.get(key)!
    }

    const outcomes: SubmitOutcome[] = []
    for (const id of uniqueIds) {
      const tpl = rowsById.get(id)
      if (!tpl) {
        outcomes.push({ id, outcome: 'error', error: 'Template not found.' })
        continue
      }
      if (tpl.meta_status !== 'draft' && tpl.meta_status !== 'rejected') {
        outcomes.push({ id, outcome: 'error', error: `Cannot submit a template in "${tpl.meta_status}" state.` })
        continue
      }
      if (tpl.variable_count > 0 && tpl.sample_values.length < tpl.variable_count) {
        outcomes.push({ id, outcome: 'error', error: 'Add a sample value for every variable before submitting.' })
        continue
      }

      const pageRow = await getPage(tpl.page_id)
      if (!pageRow) {
        outcomes.push({
          id,
          outcome: 'error',
          error: 'No connected Facebook page found. Connect a page in Settings → Facebook before submitting templates.',
        })
        continue
      }

      try {
        const result = await createMessengerTemplate({
          fbPageId: pageRow.fb_page_id,
          pageAccessToken: decryptToken(pageRow.page_access_token),
          name: tpl.name,
          language: tpl.language,
          bodyText: tpl.body_text,
          sampleValues: tpl.sample_values,
          buttons: tpl.buttons,
          footer: tpl.footer,
        })
        const localStatus = mapMetaStatus(result.status)
        const now = new Date().toISOString()
        await admin
          .from('messenger_message_templates')
          .update({
            ...buildStatusUpdate(localStatus, { metaTemplateId: result.id, hadMetaTemplateId: false, now }),
            page_id: pageRow.id,
            submitted_at: now,
          })
          .eq('id', id)
        outcomes.push({ id, outcome: localStatus === 'approved' ? 'approved' : localStatus === 'rejected' ? 'rejected' : 'pending' })
      } catch (e) {
        if (e instanceof MetaTemplateError && e.isPermissionError) {
          // Keep the row as draft — Meta never reviewed the content.
          outcomes.push({
            id,
            outcome: 'permission_error',
            error: 'Your Facebook app is missing the pages_utility_messaging permission. Request it in App Review, then re-submit.',
          })
          continue
        }
        const msg = e instanceof Error ? e.message : String(e)
        const now = new Date().toISOString()
        await admin
          .from('messenger_message_templates')
          .update({ meta_status: 'rejected', meta_rejection_reason: msg, submitted_at: now })
          .eq('id', id)
        outcomes.push({ id, outcome: 'rejected', error: msg })
      }
    }

    // Re-read every row that still exists (everything except not-found) with its
    // category joins so the client can merge updated rows into local state.
    const rereadIds = outcomes.filter((o) => o.outcome !== 'error').map((o) => o.id)
    const rowMap = await fetchRowsByIds(supabase, userId, rereadIds)
    for (const o of outcomes) {
      const r = rowMap.get(o.id)
      if (r) o.row = r
    }

    revalidatePath('/dashboard/templates')
    revalidatePath('/dashboard/agent')
    return { ok: true, data: outcomes }
  } catch (e) {
    return errResult(e)
  }
}

/**
 * Convenience single-template submit — delegates to the bulk path so there is
 * exactly one submit code path. Unwraps the single outcome into the discrete
 * success/error contract the editor expects.
 */
export async function submitTemplateForReview(
  id: string,
): Promise<ActionResult<SubmitOutcome>> {
  const r = await submitTemplatesForReview([id])
  if (!r.ok) return r
  const o = r.data[0]
  if (!o) return { ok: false, error: 'Template not found.' }
  if (o.outcome === 'permission_error' || o.outcome === 'error') {
    return { ok: false, error: o.error ?? 'Submission failed.' }
  }
  if (o.outcome === 'rejected') {
    return { ok: false, error: `Meta rejected the submission: ${o.error ?? ''}` }
  }
  return { ok: true, data: o }
}

/**
 * Re-poll Meta for the status of the given PENDING templates (others are
 * silently skipped). Used by both the live poll loop and the bulk "Refresh
 * pending" button. Groups by resolved page and issues ONE paginated
 * fetchAllMessengerTemplates per page (not per template), matching locally by
 * (name, language). Returns ONLY rows that actually changed.
 */
export async function refreshTemplateStatuses(
  ids: string[],
): Promise<ActionResult<RefreshOutcome[]>> {
  try {
    const { supabase, userId } = await requireUser()
    const uniqueIds = Array.from(new Set(ids)).filter(Boolean)
    if (uniqueIds.length === 0) return { ok: true, data: [] }

    const { data: rows } = await supabase
      .from('messenger_message_templates')
      .select('id, name, language, page_id, meta_status, meta_template_id')
      .in('id', uniqueIds)
      .eq('user_id', userId)
    const pending = (rows ?? []).filter(
      (r) => (r as { meta_status: string }).meta_status === 'pending',
    ) as Array<{ id: string; name: string; language: string; page_id: string | null; meta_status: string; meta_template_id: string | null }>
    if (pending.length === 0) return { ok: true, data: [] }

    const admin = createAdminClient()
    const listCache = new Map<string | null, Awaited<ReturnType<typeof fetchAllMessengerTemplates>> | null>()
    async function getPageTemplates(pageId: string | null) {
      const key = pageId ?? null
      if (listCache.has(key)) return listCache.get(key)!
      const pageRow = await resolveTargetPage(admin, userId, key)
      if (!pageRow) {
        listCache.set(key, null)
        return null
      }
      try {
        const all = await fetchAllMessengerTemplates({
          fbPageId: pageRow.fb_page_id,
          pageAccessToken: decryptToken(pageRow.page_access_token),
        })
        listCache.set(key, all)
        return all
      } catch (e) {
        console.warn('[refreshTemplateStatuses] page fetch failed', (e as Error).message)
        listCache.set(key, null)
        return null
      }
    }

    const changedIds: string[] = []
    let anyApproved = false
    for (const tpl of pending) {
      const all = await getPageTemplates(tpl.page_id)
      if (!all) continue
      const match = all.find((t) => t.name === tpl.name && t.language === tpl.language)
      if (!match) continue
      const localStatus = mapMetaStatus(match.status)
      const statusChanged = localStatus !== tpl.meta_status
      const backfill = !tpl.meta_template_id && !!match.id
      if (!statusChanged && !backfill) continue
      await admin
        .from('messenger_message_templates')
        .update(
          buildStatusUpdate(localStatus, {
            rejectedReason: match.rejected_reason,
            metaTemplateId: match.id,
            hadMetaTemplateId: !!tpl.meta_template_id,
          }),
        )
        .eq('id', tpl.id)
      changedIds.push(tpl.id)
      if (localStatus === 'approved') anyApproved = true
    }

    const rowMap = await fetchRowsByIds(supabase, userId, changedIds)
    const data: RefreshOutcome[] = changedIds.map((id) => ({ id, changed: true, row: rowMap.get(id) }))
    if (changedIds.length > 0) revalidatePath('/dashboard/templates')
    if (anyApproved) revalidatePath('/dashboard/agent')
    return { ok: true, data }
  } catch (e) {
    return errResult(e)
  }
}

/** Convenience single-template refresh — delegates to the bulk path. */
export async function refreshTemplateStatus(
  id: string,
): Promise<ActionResult<RefreshOutcome | null>> {
  const r = await refreshTemplateStatuses([id])
  if (!r.ok) return r
  return { ok: true, data: r.data[0] ?? null }
}

/**
 * Move every 'rejected' template owned by the calling user back to 'draft',
 * clearing the rejection reason and submission timestamps. Useful after the
 * underlying cause (e.g. a missing `pages_utility_messaging` permission)
 * is resolved on the Meta side, so the user can re-submit cleanly without
 * touching each row individually. Returns the reset rows so the client merges.
 */
export async function resetRejectedTemplates(): Promise<
  ActionResult<{ reset: number; rows: MessengerMessageTemplateWithCategories[] }>
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
    const ids = (data ?? []).map((r) => (r as { id: string }).id)
    const rowMap = await fetchRowsByIds(supabase, userId, ids)
    revalidatePath('/dashboard/templates')
    return { ok: true, data: { reset: ids.length, rows: ids.map((id) => rowMap.get(id)!).filter(Boolean) } }
  } catch (e) {
    return errResult(e)
  }
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
): Promise<ActionResult<MessengerMessageTemplateWithCategories>> {
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
    if (unique.length > 0) {
      const rows = unique.map((category_id) => ({ template_id: templateId, category_id }))
      const { error: insErr } = await supabase
        .from('messenger_template_categories')
        .insert(rows)
      if (insErr) {
        return { ok: false, error: `setTemplateCategories (insert): ${insErr.message}` }
      }
    }

    const updated = await fetchRow(supabase, userId, templateId)
    if (!updated) return { ok: false, error: 'setTemplateCategories: row not found.' }
    revalidatePath('/dashboard/templates')
    return { ok: true, data: updated }
  } catch (e) {
    return errResult(e)
  }
}
