// If a lead has an active reminder sequence, ask the LLM whether the new
// inbound resolves its single shared topic. On resolution, flip the sequence
// row to 'resolved'; the FK status check at fire time then skips remaining
// touchpoints with no further writes needed.

import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveTopics } from './resolve'

export interface ResolveArgs {
  leadId: string
  inboundText: string
}

export async function resolveActiveSequence(
  admin: SupabaseClient,
  args: ResolveArgs,
): Promise<boolean> {
  const { data: seq } = await admin
    .from('lead_reminder_sequences')
    .select('id, topic')
    .eq('lead_id', args.leadId)
    .eq('status', 'active')
    .maybeSingle<{ id: string; topic: string }>()
  if (!seq) return false

  const resolved = await resolveTopics(args.inboundText, [{ id: seq.id, topic: seq.topic }])
  if (resolved.length === 0) return false

  await admin
    .from('lead_reminder_sequences')
    .update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      resolved_reason: 'topic_addressed',
    })
    .eq('id', seq.id)
  return true
}
