'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { LeadInput, BulkUpdateInput } from '../_lib/schemas'
import { appendLeadContacts } from '@/lib/leads/contact-append'
import { createAdminClient } from '@/lib/supabase/admin'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

function normalize(input: z.infer<typeof LeadInput>) {
  return { ...input, email: input.email || null }
}

// Weighted-random pick from the user's enabled+active campaigns. Returns null
// if none exist, in which case the lead falls back to the main bot (no
// campaign assigned). Weight is clamped to 1 so a campaign with weight 0
// still has a non-zero chance — matches the schema's "0..100" intent of
// relative weight, not exclusion.
async function pickRandomCampaignId(
  supabase: Awaited<ReturnType<typeof requireUser>>['supabase'],
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, weight')
    .eq('user_id', userId)
    .eq('enabled', true)
    .eq('status', 'active')
  if (error) throw error
  const rows = (data ?? []) as { id: string; weight: number }[]
  if (rows.length === 0) return null
  const weights = rows.map((r) => Math.max(1, r.weight ?? 1))
  const total = weights.reduce((a, b) => a + b, 0)
  let roll = Math.random() * total
  for (let i = 0; i < rows.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return rows[i].id
  }
  return rows[rows.length - 1].id
}

export async function createLead(raw: unknown) {
  const input = normalize(LeadInput.parse(raw))
  const { supabase, userId } = await requireUser()

  const { data: maxRow } = await supabase
    .from('leads').select('position')
    .eq('user_id', userId).eq('stage_id', input.stage_id)
    .order('position', { ascending: false }).limit(1).maybeSingle()

  const campaign_id =
    input.campaign_id !== undefined
      ? input.campaign_id
      : await pickRandomCampaignId(supabase, userId)

  const nextPos = (maxRow?.position ?? -1) + 1
  const { error } = await supabase.from('leads').insert({
    user_id: userId, ...input, campaign_id, position: nextPos,
  })
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function updateLead(id: string, raw: unknown) {
  const input = normalize(LeadInput.parse(raw))
  const { supabase } = await requireUser()

  // Read prior phone/email so we only write a per-value row when something actually changed.
  const { data: prior } = await supabase
    .from('leads').select('phone, email').eq('id', id).maybeSingle()

  const { error } = await supabase.from('leads').update(input).eq('id', id)
  if (error) throw error

  const phoneChanged =
    typeof input.phone === 'string' && input.phone.trim() !== '' && input.phone !== prior?.phone
  const emailChanged =
    typeof input.email === 'string' && input.email.trim() !== '' && input.email !== prior?.email

  if (phoneChanged || emailChanged) {
    const admin = createAdminClient()
    await appendLeadContacts(admin, id, {
      phones: phoneChanged ? [input.phone as string] : [],
      emails: emailChanged ? [input.email as string] : [],
      source: 'manual',
    })
  }

  revalidatePath('/dashboard/leads', 'layout')
}

export async function deleteLead(id: string) {
  const { supabase } = await requireUser()
  const { error } = await supabase.from('leads').delete().eq('id', id)
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function bulkDeleteLeads(ids: string[]) {
  if (ids.length === 0) return
  const { supabase } = await requireUser()
  const { error } = await supabase.from('leads').delete().in('id', ids)
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function bulkUpdateLeads(ids: string[], raw: unknown) {
  if (ids.length === 0) return
  const partial = BulkUpdateInput.parse(raw)
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(partial)) {
    if (v !== undefined) patch[k] = v
  }
  if (Object.keys(patch).length === 0) return
  const { supabase } = await requireUser()
  const { error } = await supabase.from('leads').update(patch).in('id', ids)
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function moveLead(id: string, toStageId: string, toPosition: number) {
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from('leads')
    .update({ stage_id: toStageId, position: toPosition })
    .eq('id', id)
  if (error) throw error
  revalidatePath('/dashboard/leads', 'layout')
}

export async function bulkMoveLeads(ids: string[], toStageId: string) {
  if (ids.length === 0) return
  const { supabase, userId } = await requireUser()

  const { data: maxRow } = await supabase
    .from('leads').select('position')
    .eq('user_id', userId).eq('stage_id', toStageId)
    .order('position', { ascending: false }).limit(1).maybeSingle()

  let pos = (maxRow?.position ?? -1) + 1
  const updates = ids.map((id) => {
    const p = pos++
    return supabase.from('leads')
      .update({ stage_id: toStageId, position: p })
      .eq('id', id)
  })
  const results = await Promise.all(updates)
  for (const r of results) if (r.error) throw r.error
  revalidatePath('/dashboard/leads', 'layout')
}
