'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { enqueueEmbedJob } from '@/lib/rag'
import {
  CreateDocumentInput,
  AutosaveDocumentInput,
  SaveDocumentInput,
  RenameDocumentInput,
  SetDocumentCategoryInput,
  DeleteDocumentInput,
} from '../_lib/schemas'

// Form-action wrapper: works even if client JS / hydration fails.
// Bound directly to <form action={createDocumentForm}>.
export async function createDocumentForm(formData: FormData) {
  console.log('[createDocumentForm] invoked')
  const raw = formData.get('categoryId')
  const categoryId =
    typeof raw === 'string' && raw !== '' && raw !== 'null' ? raw : null
  const { id } = await createDocument({ categoryId })
  redirect(`/dashboard/knowledge/${id}`)
}

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

// Returns the new document id. Caller (client) handles navigation —
// keeps redirect() out of server actions invoked via useTransition,
// which is unreliable in Next 16 / React 19.
export async function createDocument(raw: unknown): Promise<{ id: string }> {
  console.log('[createDocument] invoked')
  const input = CreateDocumentInput.parse(raw ?? {})
  const { supabase, userId } = await requireUser()
  console.log('[createDocument] userId=', userId, 'input=', input)

  // If a categoryId is supplied, verify it belongs to this user before insert.
  // RLS would catch a mismatch on insert, but this gives a clearer error.
  if (input.categoryId) {
    const { data: cat } = await supabase
      .from('knowledge_categories')
      .select('id')
      .eq('id', input.categoryId)
      .maybeSingle()
    if (!cat) throw new Error('Category not found')
  }

  const { data, error } = await supabase
    .from('knowledge_documents')
    .insert({
      user_id: userId,
      title: input.title ?? 'Untitled',
      category_id: input.categoryId ?? null,
    })
    .select('id')
    .single()
  if (error) throw error

  revalidatePath('/dashboard/knowledge', 'layout')
  return { id: data.id as string }
}

// Autosave updates draft_* columns on the SAME row by id.
// Never inserts a new row — guarantees no duplicates on edit.
export async function autosaveDocument(raw: unknown) {
  const input = AutosaveDocumentInput.parse(raw)
  const { supabase } = await requireUser()

  const { error } = await supabase
    .from('knowledge_documents')
    .update({
      title: input.title,
      draft_json: input.draftJson ?? null,
      draft_html: input.draftHtml,
      draft_text: input.draftText,
      has_unsaved_changes: true,
    })
    .eq('id', input.id)
  if (error) throw error
  // No revalidatePath: autosave fires often. Editor manages its own state.
}

// Save promotes draft_* into content_*, bumps version, marks for re-embedding.
// Updates the SAME row by id — no duplicates.
export async function saveDocument(raw: unknown) {
  const input = SaveDocumentInput.parse(raw)
  const { supabase, userId } = await requireUser()

  const { data: existing, error: readErr } = await supabase
    .from('knowledge_documents')
    .select('draft_json, draft_html, draft_text, version')
    .eq('id', input.id)
    .single()
  if (readErr) throw readErr
  if (!existing) throw new Error('Document not found')

  const { data, error } = await supabase
    .from('knowledge_documents')
    .update({
      content_json: existing.draft_json,
      content_html: existing.draft_html,
      content_text: existing.draft_text,
      version: (existing.version ?? 0) + 1,
      published_at: new Date().toISOString(),
      has_unsaved_changes: false,
      embedding_status: 'stale',
    })
    .eq('id', input.id)
    .select('version, published_at')
    .single()
  if (error) throw error

  await enqueueEmbedJob(supabase, {
    kind: 'document',
    sourceId: input.id,
    userId,
    sourceVersion: data.version as number,
  })

  revalidatePath('/dashboard/knowledge', 'layout')
  return {
    version: data.version as number,
    publishedAt: data.published_at as string,
  }
}

export async function renameDocument(raw: unknown) {
  const input = RenameDocumentInput.parse(raw)
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from('knowledge_documents')
    .update({ title: input.title })
    .eq('id', input.id)
  if (error) throw error
  revalidatePath('/dashboard/knowledge', 'layout')
}

export async function setDocumentCategory(raw: unknown) {
  const input = SetDocumentCategoryInput.parse(raw)
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from('knowledge_documents')
    .update({ category_id: input.categoryId })
    .eq('id', input.id)
  if (error) throw error
  revalidatePath('/dashboard/knowledge', 'layout')
}

// Force a re-embed: marks the source stale and (re-)arms a job. Useful when
// the cron has been quiet, a previous job hit MAX_ATTEMPTS, or the user wants
// to recompute after editing knowledge externally.
export async function reindexDocument(raw: unknown): Promise<void> {
  const input = DeleteDocumentInput.parse(raw)
  const { supabase, userId } = await requireUser()

  const { data: existing, error: readErr } = await supabase
    .from('knowledge_documents')
    .select('version, content_json')
    .eq('id', input.id)
    .single()
  if (readErr) throw readErr
  if (!existing) throw new Error('Document not found')
  if (!existing.content_json) {
    throw new Error('Save the document at least once before indexing.')
  }

  // Wipe any prior failed job so enqueue can insert a fresh one. The unique
  // partial index only blocks queued/running rows so this is safe.
  await supabase
    .from('knowledge_embedding_jobs')
    .delete()
    .eq('document_id', input.id)
    .eq('status', 'failed')

  await enqueueEmbedJob(supabase, {
    kind: 'document',
    sourceId: input.id,
    userId,
    sourceVersion: (existing.version as number | null) ?? 0,
  })
  revalidatePath('/dashboard/knowledge', 'layout')
}

// Caller (client) navigates after delete — no redirect in the action.
export async function deleteDocument(raw: unknown): Promise<void> {
  const input = DeleteDocumentInput.parse(raw)
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from('knowledge_documents')
    .delete()
    .eq('id', input.id)
  if (error) throw error
  revalidatePath('/dashboard/knowledge', 'layout')
}
