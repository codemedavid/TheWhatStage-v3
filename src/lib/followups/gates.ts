// src/lib/followups/gates.ts
//
// Gates G1 (lifetime lead inbound count < 15) and G2 (no completed action
// page submission). Both evaluated at seed time and again before each fire.
//
// "Completed page action" = any row in action_page_submissions for the lead.
// The submissions table is only written when a real form submit / booking /
// order goes through; row presence is the terminal signal.

import type { SupabaseClient } from '@supabase/supabase-js'
import { MAX_LIFETIME_LEAD_INBOUND } from './config'

export type ShouldSeedResult =
  | { ok: true; inboundCount: number }
  | { ok: false; reason: 'inbound_count_15' | 'page_action_completed' }

export async function countLeadInbound(
  admin: SupabaseClient,
  threadId: string,
): Promise<number> {
  const { count } = await admin
    .from('messenger_messages')
    .select('id', { head: true, count: 'exact' })
    .eq('thread_id', threadId)
    .eq('direction', 'inbound')
  return count ?? 0
}

export async function hasCompletedPageAction(
  admin: SupabaseClient,
  leadId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('action_page_submissions')
    .select('id')
    .eq('lead_id', leadId)
    .limit(1)
  return (data ?? []).length > 0
}

export async function shouldSeed(
  admin: SupabaseClient,
  args: { threadId: string; leadId: string },
): Promise<ShouldSeedResult> {
  const inboundCount = await countLeadInbound(admin, args.threadId)
  if (inboundCount >= MAX_LIFETIME_LEAD_INBOUND) {
    return { ok: false, reason: 'inbound_count_15' }
  }
  const hasAction = await hasCompletedPageAction(admin, args.leadId)
  if (hasAction) {
    return { ok: false, reason: 'page_action_completed' }
  }
  return { ok: true, inboundCount }
}
