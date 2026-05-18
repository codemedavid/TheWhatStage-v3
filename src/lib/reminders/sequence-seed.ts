// Seed a dedicated reminder follow-up sequence: cancel any prior active
// sequence for the lead, insert the sequence row, pre-generate all 7
// message bodies in parallel, and insert the 7 touchpoint rows with
// auto_send=true so the existing reminders cron picks them up.

import type { SupabaseClient } from '@supabase/supabase-js'
import { SEQUENCE_LENGTH, scheduledAtForPosition } from './sequence'
import { fallbackForPosition } from './sequence-fallbacks'
import { generateSequenceMessage } from './sequence-generate'

export interface SeedArgs {
  userId: string
  leadId: string
  threadId: string
  anchor: Date
  topic: string
  leadName: string | null
  personalityBlock: string
  sourceMessageId: string | null
  now?: Date
}

export interface SeedResult {
  ok: boolean
  sequenceId?: string
  reason?: string
}

export async function seedReminderSequence(
  admin: SupabaseClient,
  args: SeedArgs,
): Promise<SeedResult> {
  const now = args.now ?? new Date()

  // 1. Cancel any existing active sequence for this lead (replace on new request).
  const { data: existing } = await admin
    .from('lead_reminder_sequences')
    .select('id')
    .eq('lead_id', args.leadId)
    .eq('status', 'active')
    .maybeSingle<{ id: string }>()

  if (existing) {
    await admin
      .from('lead_reminder_sequences')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        resolved_reason: 'rescheduled',
      })
      .eq('id', existing.id)
  }

  // 2. Insert the new sequence row.
  const { data: seqRow, error: seqErr } = await admin
    .from('lead_reminder_sequences')
    .insert({
      user_id: args.userId,
      lead_id: args.leadId,
      thread_id: args.threadId,
      anchor_at: args.anchor.toISOString(),
      topic: args.topic,
      source_message_id: args.sourceMessageId,
      status: 'active',
    })
    .select('id')
    .single<{ id: string }>()

  if (seqErr || !seqRow) {
    return { ok: false, reason: seqErr?.message ?? 'sequence insert failed' }
  }
  const sequenceId = seqRow.id

  // 3. Pre-generate all 7 message bodies in parallel. Failures leave the row's
  //    pre_generated_text NULL; fallback_text is always populated.
  const positions = Array.from({ length: SEQUENCE_LENGTH }, (_, i) => i)
  const generated = await Promise.allSettled(
    positions.map((pos) =>
      generateSequenceMessage({
        now,
        anchor: args.anchor,
        position: pos,
        topic: args.topic,
        leadName: args.leadName,
        personalityBlock: args.personalityBlock,
        recentMessages: [],
      }),
    ),
  )

  // 4. Insert the 7 touchpoint rows.
  for (let pos = 0; pos < SEQUENCE_LENGTH; pos++) {
    const settled = generated[pos]
    const preGen =
      settled.status === 'fulfilled' && settled.value ? settled.value : null
    const fallback = fallbackForPosition(pos, args.leadName)
    const scheduledAt = scheduledAtForPosition(args.anchor, pos).toISOString()

    await admin.from('lead_reminders').insert({
      user_id: args.userId,
      lead_id: args.leadId,
      thread_id: args.threadId,
      scheduled_at: scheduledAt,
      topic: args.topic,
      source_message_id: pos === 0 ? args.sourceMessageId : null,
      auto_send: true,
      status: 'pending',
      sequence_id: sequenceId,
      sequence_position: pos,
      pre_generated_text: preGen,
      fallback_text: fallback,
    })
  }

  return { ok: true, sequenceId }
}
