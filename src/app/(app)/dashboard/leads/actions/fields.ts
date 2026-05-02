'use server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { fieldDefsTag } from '../_lib/queries'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FieldDefInput } from '../_lib/schemas'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

export async function createFieldDef(raw: unknown) {
  const input = FieldDefInput.parse(raw)
  const { supabase, userId } = await requireUser()

  const { data: maxRow } = await supabase
    .from('lead_field_defs').select('position')
    .eq('user_id', userId).order('position', { ascending: false })
    .limit(1).maybeSingle()

  const nextPos = (maxRow?.position ?? -1) + 1
  const { error } = await supabase.from('lead_field_defs').insert({
    user_id: userId, ...input, position: nextPos,
  })
  if (error) throw error
  revalidateTag(fieldDefsTag(userId), 'max')
  revalidatePath('/dashboard/leads', 'layout')
}

export async function updateFieldDef(id: string, raw: unknown) {
  const input = FieldDefInput.parse(raw)
  const { supabase, userId } = await requireUser()
  const { error } = await supabase.from('lead_field_defs').update(input).eq('id', id)
  if (error) throw error
  revalidateTag(fieldDefsTag(userId), 'max')
  revalidatePath('/dashboard/leads', 'layout')
}

export async function deleteFieldDef(id: string) {
  const { supabase, userId } = await requireUser()

  const { data: def } = await supabase
    .from('lead_field_defs').select('key').eq('id', id).single()
  if (!def) throw new Error('Field not found')

  // Strip key from existing leads.custom_fields (JS fallback — no RPC required)
  const { data: rows } = await supabase
    .from('leads').select('id, custom_fields').eq('user_id', userId)
  for (const row of rows ?? []) {
    const cf = { ...(row.custom_fields as Record<string, unknown>) }
    if (def.key in cf) {
      delete cf[def.key]
      await supabase.from('leads').update({ custom_fields: cf }).eq('id', row.id)
    }
  }

  const { error } = await supabase.from('lead_field_defs').delete().eq('id', id)
  if (error) throw error
  revalidateTag(fieldDefsTag(userId), 'max')
  revalidatePath('/dashboard/leads', 'layout')
}
