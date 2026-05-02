'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  CreateCategoryInput,
  RenameCategoryInput,
  UpdateCategoryColorInput,
  DeleteCategoryInput,
  ReorderCategoriesInput,
} from '../_lib/schemas'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

export async function createCategory(raw: unknown) {
  const input = CreateCategoryInput.parse(raw)
  const { supabase, userId } = await requireUser()

  const { data: maxRow } = await supabase
    .from('knowledge_categories')
    .select('position')
    .eq('user_id', userId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextPos = (maxRow?.position ?? -1) + 1
  const { data, error } = await supabase
    .from('knowledge_categories')
    .insert({
      user_id: userId,
      name: input.name,
      color: input.color ?? null,
      position: nextPos,
    })
    .select('id')
    .single()
  if (error) throw error
  revalidatePath('/dashboard/knowledge', 'layout')
  return { id: data.id as string }
}

export async function renameCategory(raw: unknown) {
  const input = RenameCategoryInput.parse(raw)
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from('knowledge_categories')
    .update({ name: input.name })
    .eq('id', input.id)
  if (error) throw error
  revalidatePath('/dashboard/knowledge', 'layout')
}

export async function updateCategoryColor(raw: unknown) {
  const input = UpdateCategoryColorInput.parse(raw)
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from('knowledge_categories')
    .update({ color: input.color ?? null })
    .eq('id', input.id)
  if (error) throw error
  revalidatePath('/dashboard/knowledge', 'layout')
}

export async function deleteCategory(raw: unknown) {
  const input = DeleteCategoryInput.parse(raw)
  const { supabase } = await requireUser()
  // FK is on delete set null — documents survive uncategorized.
  const { error } = await supabase
    .from('knowledge_categories')
    .delete()
    .eq('id', input.id)
  if (error) throw error
  revalidatePath('/dashboard/knowledge', 'layout')
}

export async function reorderCategories(raw: unknown) {
  const input = ReorderCategoriesInput.parse(raw)
  const { supabase, userId } = await requireUser()
  const updates = input.ids.map((id, position) =>
    supabase
      .from('knowledge_categories')
      .update({ position })
      .eq('id', id)
      .eq('user_id', userId),
  )
  const results = await Promise.all(updates)
  for (const r of results) if (r.error) throw r.error
  revalidatePath('/dashboard/knowledge', 'layout')
}
