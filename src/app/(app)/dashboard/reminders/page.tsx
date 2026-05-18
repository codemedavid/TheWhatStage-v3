import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  RemindersClient,
  type ReminderRow,
  type SequenceRow,
} from './_components/RemindersClient'

export const dynamic = 'force-dynamic'

export default async function RemindersPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: reminderRows }, { data: sequenceRows }] = await Promise.all([
    supabase
      .from('lead_reminders')
      .select(
        'id, lead_id, scheduled_at, topic, status, auto_send, fired_at, resolved_at, created_at, sequence_id, sequence_position, leads(name)',
      )
      .eq('user_id', user.id)
      .in('status', ['pending', 'snoozed', 'sent', 'resolved', 'failed', 'cancelled'])
      .order('scheduled_at', { ascending: true })
      .limit(500),
    supabase
      .from('lead_reminder_sequences')
      .select('id, lead_id, anchor_at, topic, status, resolved_at, cancelled_at, created_at, leads(name)')
      .eq('user_id', user.id)
      .order('anchor_at', { ascending: true })
      .limit(200),
  ])

  type ReminderRaw = {
    id: string
    lead_id: string
    scheduled_at: string
    topic: string
    status: ReminderRow['status']
    auto_send: boolean
    fired_at: string | null
    resolved_at: string | null
    created_at: string
    sequence_id: string | null
    sequence_position: number | null
    leads: { name: string | null } | { name: string | null }[] | null
  }

  type SequenceRaw = {
    id: string
    lead_id: string
    anchor_at: string
    topic: string
    status: SequenceRow['status']
    resolved_at: string | null
    cancelled_at: string | null
    created_at: string
    leads: { name: string | null } | { name: string | null }[] | null
  }

  const rows: ReminderRow[] = ((reminderRows ?? []) as ReminderRaw[]).map((r) => {
    const leadObj = Array.isArray(r.leads) ? r.leads[0] : r.leads
    return {
      id: r.id,
      lead_id: r.lead_id,
      lead_name: leadObj?.name ?? null,
      scheduled_at: r.scheduled_at,
      topic: r.topic,
      status: r.status,
      auto_send: r.auto_send,
      fired_at: r.fired_at,
      resolved_at: r.resolved_at,
      created_at: r.created_at,
      sequence_id: r.sequence_id,
      sequence_position: r.sequence_position,
    }
  })

  const sequences: SequenceRow[] = ((sequenceRows ?? []) as SequenceRaw[]).map((s) => {
    const leadObj = Array.isArray(s.leads) ? s.leads[0] : s.leads
    return {
      id: s.id,
      lead_id: s.lead_id,
      lead_name: leadObj?.name ?? null,
      anchor_at: s.anchor_at,
      topic: s.topic,
      status: s.status,
      resolved_at: s.resolved_at,
      cancelled_at: s.cancelled_at,
      created_at: s.created_at,
    }
  })

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Reminders</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Follow-ups customers asked you for. Resolved automatically once they bring it back up.
        </p>
      </div>
      <RemindersClient initial={rows} sequences={sequences} />
    </div>
  )
}
