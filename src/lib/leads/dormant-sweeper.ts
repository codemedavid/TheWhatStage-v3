import type { createAdminClient } from '@/lib/supabase/admin'
import { moveLeadToStage } from './move-stage'

type Admin = ReturnType<typeof createAdminClient>

const DORMANT_DAYS = 14

export type SweepStage = { id: string; kind: string; name: string; position: number }
export type SweepLead = { id: string; stage_id: string; last_inbound_at: string | null }
export type SweepMove = { leadId: string; toStageId: string; fromStageId: string }

export function computeDormantMoves(
  leads: SweepLead[],
  stages: SweepStage[],
  now: Date,
): SweepMove[] {
  const dormant = stages.find((s) => s.kind === 'dormant')
  if (!dormant) return []

  const byId = new Map(stages.map((s) => [s.id, s]))
  const threshold = now.getTime() - DORMANT_DAYS * 24 * 60 * 60 * 1000

  const moves: SweepMove[] = []
  for (const l of leads) {
    const stage = byId.get(l.stage_id)
    if (!stage) continue
    if (stage.kind === 'won' || stage.kind === 'lost' || stage.kind === 'dormant') continue
    if (stage.kind === 'entry') continue // New Lead doesn't go Dormant
    if (!l.last_inbound_at) continue
    if (new Date(l.last_inbound_at).getTime() > threshold) continue
    moves.push({ leadId: l.id, toStageId: dormant.id, fromStageId: l.stage_id })
  }
  return moves
}

export async function runDormantSweepForUser(admin: Admin, userId: string, now = new Date()): Promise<number> {
  const { data: stages, error: stagesErr } = await admin
    .from('pipeline_stages')
    .select('id, kind, name, position')
    .eq('user_id', userId)
  if (stagesErr || !stages) return 0

  const { data: leads, error: leadsErr } = await admin
    .from('leads')
    .select('id, stage_id, last_inbound_at')
    .eq('user_id', userId)
  if (leadsErr || !leads) return 0

  const moves = computeDormantMoves(leads as SweepLead[], stages as SweepStage[], now)
  let moved = 0
  for (const m of moves) {
    const ok = await moveLeadToStage(admin, {
      leadId: m.leadId,
      toStageId: m.toStageId,
      source: 'system-dormant',
      reason: `no inbound for ${DORMANT_DAYS}+ days`,
      matchedSignals: [],
    })
    if (ok) moved++
  }
  return moved
}

export async function runDormantSweepForAllUsers(admin: Admin, now = new Date()): Promise<number> {
  const { data: users } = await admin.from('profiles').select('id')
  let total = 0
  for (const u of (users ?? []) as { id: string }[]) {
    total += await runDormantSweepForUser(admin, u.id, now)
  }
  return total
}
