'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resetThreadCountersByLead } from '@/lib/messenger/reset-counters'

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

const LeadIdSchema = z.string().uuid()

const ToggleImportantSchema = z.object({
  leadId: LeadIdSchema,
  important: z.boolean(),
})

/**
 * Pin / unpin a lead's conversation as "important to check". Operator-controlled
 * and independent of unread state — a pinned thread stays in the Important tab
 * after it has been read. Scoped by both lead_id AND user_id (RLS also enforces
 * user_id) so one tenant can never flip another's pin.
 */
export async function toggleThreadImportant(input: { leadId: string; important: boolean }): Promise<void> {
  const { leadId, important } = ToggleImportantSchema.parse(input)
  const { supabase, userId } = await requireUser()
  const { error } = await supabase
    .from('messenger_threads')
    .update({ is_important: important })
    .eq('lead_id', leadId)
    .eq('user_id', userId)
  if (error) throw new Error(`toggleThreadImportant: ${error.message}`)
  revalidatePath('/dashboard/inbox')
}

/**
 * One-click "Mark read" from an inbox row: clears BOTH unread and missed for the
 * lead's thread without opening the conversation, so the row leaves the
 * "Needs reply" tab. Reuses the shared reset helper. Refreshes the nav badge.
 */
export async function markInboxThreadRead(leadId: string): Promise<void> {
  const parsed = LeadIdSchema.parse(leadId)
  const { supabase, userId } = await requireUser()
  await resetThreadCountersByLead(supabase, parsed, { resetMissed: true }, userId)
  revalidatePath('/dashboard/inbox')
  revalidatePath('/dashboard', 'layout')
}
