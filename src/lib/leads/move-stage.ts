import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export type MoveStageArgs = {
  leadId: string
  toStageId: string
  source: string
  reason: string
  matchedSignals: string[]
  confidence?: 'low' | 'medium' | 'high'
  idempotencyKey?: string
  threadId?: string
  expectedVersion?: number
}

export async function moveLeadToStage(admin: Admin, args: MoveStageArgs): Promise<boolean> {
  const reason =
    args.matchedSignals.length > 0
      ? `matched: ${args.matchedSignals.join(', ')} — ${args.reason}`
      : args.reason

  const { data, error } = await admin.rpc('set_lead_stage', {
    p_lead_id: args.leadId,
    p_to_stage_id: args.toStageId,
    p_source: args.source,
    p_reason: reason,
    p_confidence: args.confidence ?? null,
    p_idempotency_key: args.idempotencyKey ?? null,
    p_thread_id: args.threadId ?? null,
    p_expected_version: args.expectedVersion ?? null,
  })

  if (error) {
    console.warn('[leads.move-stage] set_lead_stage failed', { err: error.message, args })
    return false
  }
  return data === true
}
