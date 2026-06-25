import type { SupabaseClient } from '@supabase/supabase-js'

export interface ResetOptions {
  // true  -> explicit "Mark as read" (or project creation): zero both counters.
  // false -> passive view of the conversation: clear unread only, leave the
  //          missed tally so the team can still see what they never attended to.
  resetMissed: boolean
}

type CounterResetPatch = {
  unread_count: 0
  last_read_at: string
  missed_count?: 0
}

export function buildCounterResetPatch(opts: ResetOptions, nowIso: string): CounterResetPatch {
  const patch: CounterResetPatch = { unread_count: 0, last_read_at: nowIso }
  return opts.resetMissed ? { ...patch, missed_count: 0 } : patch
}

// Reset the unread (and optionally missed) counters on a lead's Messenger
// thread. Must be called with the owner's client so RLS scopes the update to
// the caller's own thread. When the caller already knows the owner, pass
// `userId` to scope the write by user_id too — defense-in-depth that matches the
// rest of the dashboard write paths (RLS still enforces this regardless).
export async function resetThreadCountersByLead(
  supabase: SupabaseClient,
  leadId: string,
  opts: ResetOptions,
  userId?: string,
): Promise<void> {
  let query = supabase
    .from('messenger_threads')
    .update(buildCounterResetPatch(opts, new Date().toISOString()))
    .eq('lead_id', leadId)
  if (userId) query = query.eq('user_id', userId)
  const { error } = await query
  if (error) throw new Error(`resetThreadCountersByLead: ${error.message}`)
}
