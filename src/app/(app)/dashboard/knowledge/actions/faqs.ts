'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { enqueueEmbedJob } from '@/lib/rag'
import {
  CreateFaqInput,
  UpdateFaqInput,
  DeleteFaqInput,
  ReorderFaqsInput,
  ToggleFaqPublishedInput,
} from '../_lib/schemas'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

export async function createFaqForm(formData: FormData) {
  const question = String(formData.get('question') ?? '')
  const answer = String(formData.get('answer') ?? '')
  const rawCat = formData.get('categoryId')
  const categoryId =
    typeof rawCat === 'string' && rawCat !== '' && rawCat !== 'null'
      ? rawCat
      : null
  await createFaq({ question, answer, categoryId })
  redirect('/dashboard/knowledge/faqs')
}

export async function createFaq(raw: unknown): Promise<{ id: string }> {
  const input = CreateFaqInput.parse(raw ?? {})
  const { supabase, userId } = await requireUser()

  if (input.categoryId) {
    const { data: cat } = await supabase
      .from('knowledge_categories')
      .select('id')
      .eq('id', input.categoryId)
      .maybeSingle()
    if (!cat) throw new Error('Category not found')
  }

  const { data: maxRow } = await supabase
    .from('knowledge_faqs')
    .select('position')
    .eq('user_id', userId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextPosition = ((maxRow?.position as number | undefined) ?? -1) + 1

  const { data, error } = await supabase
    .from('knowledge_faqs')
    .insert({
      user_id: userId,
      question: input.question,
      answer: input.answer ?? '',
      category_id: input.categoryId ?? null,
      position: nextPosition,
    })
    .select('id, version')
    .single()
  if (error) throw error

  const newId = data.id as string
  await enqueueEmbedJob(supabase, {
    kind: 'faq',
    sourceId: newId,
    userId,
    sourceVersion: (data.version as number | null) ?? 0,
  })

  revalidatePath('/dashboard/knowledge/faqs')
  return { id: newId }
}

export async function updateFaqForm(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  const question = String(formData.get('question') ?? '')
  const answer = String(formData.get('answer') ?? '')
  const rawCat = formData.get('categoryId')
  const categoryId =
    typeof rawCat === 'string' && rawCat !== '' && rawCat !== 'null'
      ? rawCat
      : null
  const isPublished = formData.get('isPublished') === 'on'
  await updateFaq({ id, question, answer, categoryId, isPublished })
  redirect('/dashboard/knowledge/faqs')
}

export async function updateFaq(raw: unknown) {
  const input = UpdateFaqInput.parse(raw)
  const { supabase, userId } = await requireUser()

  const { data: existing, error: readErr } = await supabase
    .from('knowledge_faqs')
    .select('version')
    .eq('id', input.id)
    .single()
  if (readErr) throw readErr

  const nextVersion = ((existing?.version as number | undefined) ?? 0) + 1
  const { error } = await supabase
    .from('knowledge_faqs')
    .update({
      question: input.question,
      answer: input.answer,
      category_id: input.categoryId ?? null,
      is_published: input.isPublished ?? true,
      embedding_status: 'stale',
      version: nextVersion,
    })
    .eq('id', input.id)
  if (error) throw error

  await enqueueEmbedJob(supabase, {
    kind: 'faq',
    sourceId: input.id,
    userId,
    sourceVersion: nextVersion,
  })

  revalidatePath('/dashboard/knowledge/faqs')
}

export async function reindexFaq(raw: unknown): Promise<void> {
  const input = DeleteFaqInput.parse(raw)
  const { supabase, userId } = await requireUser()

  const { data: existing, error: readErr } = await supabase
    .from('knowledge_faqs')
    .select('version, answer')
    .eq('id', input.id)
    .single()
  if (readErr) throw readErr
  if (!existing) throw new Error('FAQ not found')
  if (!existing.answer || String(existing.answer).trim() === '') {
    throw new Error('Add an answer before indexing.')
  }

  await supabase
    .from('knowledge_embedding_jobs')
    .delete()
    .eq('faq_id', input.id)
    .eq('status', 'failed')

  await enqueueEmbedJob(supabase, {
    kind: 'faq',
    sourceId: input.id,
    userId,
    sourceVersion: (existing.version as number | null) ?? 0,
  })
  revalidatePath('/dashboard/knowledge/faqs')
}

export async function deleteFaq(raw: unknown) {
  const input = DeleteFaqInput.parse(raw)
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from('knowledge_faqs')
    .delete()
    .eq('id', input.id)
  if (error) throw error
  revalidatePath('/dashboard/knowledge/faqs')
}

export async function deleteFaqForm(formData: FormData) {
  const id = String(formData.get('id') ?? '')
  await deleteFaq({ id })
  redirect('/dashboard/knowledge/faqs')
}

export async function toggleFaqPublished(raw: unknown) {
  const input = ToggleFaqPublishedInput.parse(raw)
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from('knowledge_faqs')
    .update({ is_published: input.isPublished })
    .eq('id', input.id)
  if (error) throw error
  revalidatePath('/dashboard/knowledge/faqs')
}

export async function reorderFaqs(raw: unknown) {
  const input = ReorderFaqsInput.parse(raw)
  const { supabase, userId } = await requireUser()
  await Promise.all(
    input.ids.map((id, i) =>
      supabase
        .from('knowledge_faqs')
        .update({ position: i })
        .eq('id', id)
        .eq('user_id', userId),
    ),
  )
  revalidatePath('/dashboard/knowledge/faqs')
}
