import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Single switch behind "pause this user." Returns true only when the user is
 * `active`. Shared by handleEvent, handleFeedChange, and handlePostback so
 * "pause account" = "pause bot" everywhere the bot can speak.
 */
export async function isUserActive(admin: AdminClient, userId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('profiles')
    .select('status')
    .eq('id', userId)
    .maybeSingle<{ status: string }>()
  if (error) {
    // A query failure is an INFRA error, not "user is paused". Returning false
    // here would silently drop the inbound message (the caller treats false as
    // "bot off" → returns 200 to Meta → no redelivery). Throw so the webhook
    // returns 5xx and Meta redelivers the batch once the DB recovers.
    throw new Error(`[fb.webhook] status lookup failed: ${error.message}`)
  }
  return data?.status === 'active'
}
