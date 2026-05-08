import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { RemindersClient, type ReminderRow } from './_components/RemindersClient'

export const dynamic = 'force-dynamic'

export default async function RemindersPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data } = await supabase
    .from('lead_reminders')
    .select(
      'id, lead_id, scheduled_at, topic, status, auto_send, fired_at, resolved_at, created_at, leads(name)',
    )
    .eq('user_id', user.id)
    .in('status', ['pending', 'snoozed', 'sent', 'resolved', 'failed'])
    .order('scheduled_at', { ascending: true })
    .limit(500)

  type Row = {
    id: string
    lead_id: string
    scheduled_at: string
    topic: string
    status: ReminderRow['status']
    auto_send: boolean
    fired_at: string | null
    resolved_at: string | null
    created_at: string
    leads: { name: string | null } | { name: string | null }[] | null
  }

  const rows: ReminderRow[] = ((data ?? []) as Row[]).map((r) => {
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
      <RemindersClient initial={rows} />
    </div>
  )
}
