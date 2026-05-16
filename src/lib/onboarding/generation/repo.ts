import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { GenerationJob, GenerationKind } from './types'

const TABLE = 'generation_jobs'

export async function getJob(
  profileId: string,
  kind: GenerationKind,
): Promise<GenerationJob | null> {
  const admin = createAdminClient()
  const result = await admin
    .from(TABLE)
    .select('*')
    .eq('profile_id', profileId)
    .eq('kind', kind)
    .maybeSingle()
  if (!result) return null
  const { data, error } = result as { data: unknown; error: unknown }
  if (error) {
    console.error('[generation.repo.getJob]', error)
    return null
  }
  return (data as GenerationJob | null) ?? null
}

export async function upsertRunning(
  profileId: string,
  kind: GenerationKind,
  inputHash: string,
): Promise<void> {
  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { error } = await admin.from(TABLE).upsert(
    {
      profile_id: profileId,
      kind,
      status: 'running',
      input_hash: inputHash,
      result: null,
      error: null,
      started_at: now,
      finished_at: null,
    },
    { onConflict: 'profile_id,kind' },
  )
  if (error) console.error('[generation.repo.upsertRunning]', error)
}

export async function markDone(
  profileId: string,
  kind: GenerationKind,
  inputHash: string,
  result: unknown,
): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin
    .from(TABLE)
    .update({
      status: 'done',
      result,
      error: null,
      finished_at: new Date().toISOString(),
    })
    .eq('profile_id', profileId)
    .eq('kind', kind)
    .eq('input_hash', inputHash)
  if (error) console.error('[generation.repo.markDone]', error)
}

export async function markFailed(
  profileId: string,
  kind: GenerationKind,
  inputHash: string,
  message: string,
): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin
    .from(TABLE)
    .update({
      status: 'failed',
      error: message,
      finished_at: new Date().toISOString(),
    })
    .eq('profile_id', profileId)
    .eq('kind', kind)
    .eq('input_hash', inputHash)
  if (error) console.error('[generation.repo.markFailed]', error)
}

/**
 * Sweep stuck rows: anything in 'running' for > 90s is converted to 'failed'.
 */
export async function sweepStaleForProfile(profileId: string): Promise<void> {
  const admin = createAdminClient()
  const cutoff = new Date(Date.now() - 90_000).toISOString()
  const { error } = await admin
    .from(TABLE)
    .update({
      status: 'failed',
      error: 'timed_out',
      finished_at: new Date().toISOString(),
    })
    .eq('profile_id', profileId)
    .eq('status', 'running')
    .lt('started_at', cutoff)
  if (error) console.error('[generation.repo.sweepStale]', error)
}
