import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

const DEBOUNCE_SECONDS = 60
const MIN_INTERVAL_SECONDS = 300 // 5-minute cost guardrail

export async function enqueueStageSuggestionJob(admin: Admin, userId: string): Promise<void> {
  const runAt = new Date(Date.now() + DEBOUNCE_SECONDS * 1000).toISOString()

  // Upsert: if a row exists with status='queued', push run_at forward.
  // If status='running' or 'idle', queue a new run respecting MIN_INTERVAL_SECONDS.
  const { data: existing } = await admin
    .from('stage_suggestion_jobs')
    .select('user_id, status, last_completed_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (!existing) {
    await admin.from('stage_suggestion_jobs').insert({
      user_id: userId,
      run_at: runAt,
      status: 'queued',
    })
    return
  }

  if (existing.status === 'queued') {
    await admin.from('stage_suggestion_jobs').update({ run_at: runAt }).eq('user_id', userId)
    return
  }

  // running or idle — check minimum interval before requeuing
  const last = existing.last_completed_at ? new Date(existing.last_completed_at).getTime() : 0
  if (Date.now() - last < MIN_INTERVAL_SECONDS * 1000) return

  await admin
    .from('stage_suggestion_jobs')
    .update({ status: 'queued', run_at: runAt })
    .eq('user_id', userId)
}
