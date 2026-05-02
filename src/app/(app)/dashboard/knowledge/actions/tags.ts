'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  CreateTagInput,
  RenameTagInput,
  DeleteTagInput,
  SetDocumentTagsInput,
  TogglePinInput,
} from '../_lib/schemas'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

export async function createTag(raw: unknown) {
  const input = CreateTagInput.parse(raw)
  const { supabase, userId } = await requireUser()
  const { data, error } = await supabase
    .from('knowledge_tags')
    .insert({ user_id: userId, name: input.name, color: input.color ?? null })
    .select('id')
    .single()
  if (error) throw error
  revalidatePath('/dashboard/knowledge', 'layout')
  return { id: data.id as string }
}

export async function renameTag(raw: unknown) {
  const input = RenameTagInput.parse(raw)
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from('knowledge_tags')
    .update({ name: input.name })
    .eq('id', input.id)
  if (error) throw error
  revalidatePath('/dashboard/knowledge', 'layout')
}

export async function deleteTag(raw: unknown) {
  const input = DeleteTagInput.parse(raw)
  const { supabase } = await requireUser()
  // join rows cascade automatically (FK on delete cascade).
  const { error } = await supabase
    .from('knowledge_tags')
    .delete()
    .eq('id', input.id)
  if (error) throw error
  revalidatePath('/dashboard/knowledge', 'layout')
}

// Replace the document's tags with exactly the supplied set.
export async function setDocumentTags(raw: unknown) {
  const input = SetDocumentTagsInput.parse(raw)
  const { supabase, userId } = await requireUser()

  const { error: delErr } = await supabase
    .from('knowledge_document_tags')
    .delete()
    .eq('document_id', input.id)
  if (delErr) throw delErr

  if (input.tagIds.length > 0) {
    const rows = input.tagIds.map((tag_id) => ({
      document_id: input.id,
      tag_id,
      user_id: userId,
    }))
    const { error: insErr } = await supabase
      .from('knowledge_document_tags')
      .insert(rows)
    if (insErr) throw insErr
  }

  revalidatePath('/dashboard/knowledge', 'layout')
}

export async function togglePinDocument(raw: unknown) {
  const input = TogglePinInput.parse(raw)
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from('knowledge_documents')
    .update({
      is_pinned: input.pinned,
      pinned_at: input.pinned ? new Date().toISOString() : null,
    })
    .eq('id', input.id)
  if (error) throw error
  revalidatePath('/dashboard/knowledge', 'layout')
}
