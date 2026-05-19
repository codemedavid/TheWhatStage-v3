// src/lib/followups/seed.ts
//
// Seed and cancel logic for the auto-followup schedule. Called from the
// messenger inbound worker after the inbound message row is committed.
//
// Idempotency: the `uniq_active_followup_per_thread` partial unique index
// guarantees no two pending/running rows for the same thread. Two concurrent
// inbound deliveries can both arrive here; the loser's insert errors with
// 23505 and we swallow it.

import type { SupabaseClient } from '@supabase/supabase-js'
import { shouldSeed } from './gates'
import { REAL_CONVERSATION_LEAD_MSG_THRESHOLD } from './config'
import { loadFollowupSettings, resolveEnabledOffsets } from './settings'

export interface SeedArgs {
  threadId: string
  leadId: string
  userId: string
  pageId: string
  lastInboundAt: string
}

export async function cancelActiveFollowup(
  admin: SupabaseClient,
  threadId: string,
): Promise<void> {
  await admin
    .from('lead_followup_schedules')
    .update({ status: 'cancelled' })
    .eq('thread_id', threadId)
    .in('status', ['pending', 'running'])
}

export async function maybeScheduleFollowup(
  admin: SupabaseClient,
  args: SeedArgs,
): Promise<void> {
  // 1. Cancel any active schedule for this thread. Always runs — even when
  //    gates or settings will block re-seeding — so a lead crossing the
  //    15-message line (or one whose user just turned off the engine) cleans up.
  await cancelActiveFollowup(admin, args.threadId)

  // 2. Re-evaluate gates after cancel.
  const gate = await shouldSeed(admin, {
    threadId: args.threadId,
    leadId: args.leadId,
  })
  if (!gate.ok) return

  // 3. Resolve the user's per-account schedule. Empty snapshot means
  //    master OFF, all rows disabled, or a bad config — never seed.
  const settings = await loadFollowupSettings(admin, args.userId)
  const snapshot = resolveEnabledOffsets(settings)
  if (snapshot.length === 0) return

  const conversation_kind =
    gate.inboundCount >= REAL_CONVERSATION_LEAD_MSG_THRESHOLD ? 'real' : 'generic'
  const next_run_at = new Date(
    Date.parse(args.lastInboundAt) + snapshot[0].offset_ms,
  ).toISOString()

  const { error } = await admin
    .from('lead_followup_schedules')
    .insert({
      user_id: args.userId,
      lead_id: args.leadId,
      thread_id: args.threadId,
      page_id: args.pageId,
      started_at: args.lastInboundAt,
      next_offset_idx: 0,
      next_run_at,
      status: 'pending',
      conversation_kind,
      lead_inbound_count_at_seed: gate.inboundCount,
      offsets_snapshot: snapshot,
    })

  // 23505 = unique_violation. A concurrent inbound already seeded — fine.
  if (error && (error as { code?: string }).code !== '23505') {
    console.warn('[followups.seed] insert failed', error.message)
  }
}
