import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export function computeStaleSuggestionIds(
  suggestions: { id: string; stage_id: string; created_at: string }[],
  stages: { id: string; updated_at: string | null }[],
): string[] {
  const stageMap = new Map(stages.map((s) => [s.id, s.updated_at]))
  const stale: string[] = []
  for (const s of suggestions) {
    const stageUpdated = stageMap.get(s.stage_id)
    if (!stageUpdated) continue
    if (new Date(stageUpdated).getTime() > new Date(s.created_at).getTime()) {
      stale.push(s.id)
    }
  }
  return stale
}

const SNAPSHOT_TTL_DAYS = 30

export async function runSuggestionHousekeeping(admin: Admin, now = new Date()): Promise<{ stale: number; snapshotsRemoved: number }> {
  // 1. Mark stale: pending suggestions whose stage was edited after the suggestion was created.
  const { data: pending } = await admin
    .from('pipeline_stage_suggestions')
    .select('id, stage_id, created_at')
    .eq('status', 'pending')

  const stageIds = [...new Set((pending ?? []).map((s) => s.stage_id))]
  let stale = 0
  if (stageIds.length > 0) {
    const { data: stages } = await admin
      .from('pipeline_stages')
      .select('id, updated_at')
      .in('id', stageIds)
    const staleIds = computeStaleSuggestionIds(
      (pending ?? []) as { id: string; stage_id: string; created_at: string }[],
      (stages ?? []) as { id: string; updated_at: string | null }[],
    )
    if (staleIds.length > 0) {
      await admin
        .from('pipeline_stage_suggestions')
        .update({ status: 'stale', resolved_at: now.toISOString() })
        .in('id', staleIds)
      stale = staleIds.length
    }
  }

  // 2. Drop upgrade snapshots older than 30 days.
  const cutoff = new Date(now.getTime() - SNAPSHOT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { count } = await admin
    .from('pipeline_stage_upgrade_snapshots')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff)

  return { stale, snapshotsRemoved: count ?? 0 }
}
