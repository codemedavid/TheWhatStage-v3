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
  let stale = 0
  let snapshotsRemoved = 0

  try {
    const { data: pending, error: pendingErr } = await admin
      .from('pipeline_stage_suggestions')
      .select('id, stage_id, created_at')
      .eq('status', 'pending')
    if (pendingErr) {
      console.warn('[suggestion-housekeeping] load pending failed', { err: pendingErr.message })
    } else {
      const stageIds = [...new Set((pending ?? []).map((s) => s.stage_id))]
      if (stageIds.length > 0) {
        const { data: stages, error: stagesErr } = await admin
          .from('pipeline_stages')
          .select('id, updated_at')
          .in('id', stageIds)
        if (stagesErr) {
          console.warn('[suggestion-housekeeping] load stages failed', { err: stagesErr.message })
        } else {
          const staleIds = computeStaleSuggestionIds(
            (pending ?? []) as { id: string; stage_id: string; created_at: string }[],
            (stages ?? []) as { id: string; updated_at: string | null }[],
          )
          if (staleIds.length > 0) {
            const { error: updErr } = await admin
              .from('pipeline_stage_suggestions')
              .update({ status: 'stale', resolved_at: now.toISOString() })
              .in('id', staleIds)
            if (updErr) {
              console.warn('[suggestion-housekeeping] mark stale failed', { err: updErr.message })
            } else {
              stale = staleIds.length
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn('[suggestion-housekeeping] stale phase crashed', { err: (err as Error).message })
  }

  try {
    const cutoff = new Date(now.getTime() - SNAPSHOT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const { count, error: delErr } = await admin
      .from('pipeline_stage_upgrade_snapshots')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff)
    if (delErr) {
      console.warn('[suggestion-housekeeping] delete snapshots failed', { err: delErr.message })
    } else {
      snapshotsRemoved = count ?? 0
    }
  } catch (err) {
    console.warn('[suggestion-housekeeping] snapshot phase crashed', { err: (err as Error).message })
  }

  return { stale, snapshotsRemoved }
}
