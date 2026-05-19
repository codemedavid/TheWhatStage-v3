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
    console.error('[fb.webhook] status lookup failed', error.message)
    return false
  }
  return data?.status === 'active'
}
