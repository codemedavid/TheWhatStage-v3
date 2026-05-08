'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

export interface ReminderRow {
  id: string
  lead_id: string
  lead_name: string | null
  scheduled_at: string
  topic: string
  status: 'pending' | 'snoozed' | 'sent' | 'resolved' | 'cancelled' | 'failed'
  auto_send: boolean
  fired_at: string | null
  resolved_at: string | null
  created_at: string
}

const TZ = 'Asia/Manila'

function fmtLocal(iso: string): string {
  return new Date(iso).toLocaleString('en-PH', {
    timeZone: TZ,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function bucketize(rows: ReminderRow[]) {
  const now = Date.now()
  const startOfTomorrow = (() => {
    const d = new Date()
    d.setHours(24, 0, 0, 0)
    return d.getTime()
  })()
  const overdue: ReminderRow[] = []
  const today: ReminderRow[] = []
  const upcoming: ReminderRow[] = []
  const done: ReminderRow[] = []
  for (const r of rows) {
    if (r.status === 'sent' || r.status === 'resolved' || r.status === 'cancelled' || r.status === 'failed') {
      done.push(r)
      continue
    }
    const t = new Date(r.scheduled_at).getTime()
    if (t < now) overdue.push(r)
    else if (t < startOfTomorrow) today.push(r)
    else upcoming.push(r)
  }
  return { overdue, today, upcoming, done }
}

export function RemindersClient({ initial }: { initial: ReminderRow[] }) {
  const [rows, setRows] = useState<ReminderRow[]>(initial)
  const [tab, setTab] = useState<'active' | 'done'>('active')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const router = useRouter()

  const { overdue, today, upcoming, done } = useMemo(() => bucketize(rows), [rows])

  async function patch(id: string, body: Record<string, unknown>) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/reminders/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(await res.text())
      const updated = (await res.json()) as ReminderRow
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...updated } : r)))
    } catch (e) {
      console.error(e)
      alert('Action failed')
    } finally {
      setBusyId(null)
    }
  }

  async function sendNow(id: string) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/reminders/${id}/send`, { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      startTransition(() => router.refresh())
      const j = (await res.json()) as { ok: boolean; status?: ReminderRow['status'] }
      if (j.ok) {
        setRows((rs) =>
          rs.map((r) => (r.id === id ? { ...r, status: 'sent', fired_at: new Date().toISOString() } : r)),
        )
      }
    } catch (e) {
      console.error(e)
      alert('Send failed')
    } finally {
      setBusyId(null)
    }
  }

  function snooze(id: string, hours: number) {
    const next = new Date(Date.now() + hours * 3600_000).toISOString()
    void patch(id, { scheduled_at: next, status: 'pending' })
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-3 text-sm">
        <button
          onClick={() => setTab('active')}
          className={`px-3 py-1.5 rounded-md ${tab === 'active' ? 'bg-neutral-900 text-white' : 'bg-neutral-100'}`}
        >
          Active ({overdue.length + today.length + upcoming.length})
        </button>
        <button
          onClick={() => setTab('done')}
          className={`px-3 py-1.5 rounded-md ${tab === 'done' ? 'bg-neutral-900 text-white' : 'bg-neutral-100'}`}
        >
          History ({done.length})
        </button>
      </div>

      {tab === 'active' && (
        <div className="space-y-6">
          <Section title="Overdue" rows={overdue} accent="red" empty="Nothing overdue.">
            {(r) => (
              <ActiveActions
                row={r}
                busy={busyId === r.id}
                onSend={() => sendNow(r.id)}
                onSnooze={(h) => snooze(r.id, h)}
                onResolve={() =>
                  patch(r.id, { status: 'resolved', resolved_reason: 'manual' })
                }
                onCancel={() => patch(r.id, { status: 'cancelled' })}
                onAutoToggle={() => patch(r.id, { auto_send: !r.auto_send })}
              />
            )}
          </Section>
          <Section title="Today" rows={today} accent="amber" empty="Nothing scheduled for today.">
            {(r) => (
              <ActiveActions
                row={r}
                busy={busyId === r.id}
                onSend={() => sendNow(r.id)}
                onSnooze={(h) => snooze(r.id, h)}
                onResolve={() =>
                  patch(r.id, { status: 'resolved', resolved_reason: 'manual' })
                }
                onCancel={() => patch(r.id, { status: 'cancelled' })}
                onAutoToggle={() => patch(r.id, { auto_send: !r.auto_send })}
              />
            )}
          </Section>
          <Section title="Upcoming" rows={upcoming} accent="neutral" empty="No upcoming reminders.">
            {(r) => (
              <ActiveActions
                row={r}
                busy={busyId === r.id}
                onSend={() => sendNow(r.id)}
                onSnooze={(h) => snooze(r.id, h)}
                onResolve={() =>
                  patch(r.id, { status: 'resolved', resolved_reason: 'manual' })
                }
                onCancel={() => patch(r.id, { status: 'cancelled' })}
                onAutoToggle={() => patch(r.id, { auto_send: !r.auto_send })}
              />
            )}
          </Section>
        </div>
      )}

      {tab === 'done' && (
        <Section title="Recent" rows={done.slice(0, 200)} accent="neutral" empty="No history yet.">
          {(r) => <DoneActions row={r} />}
        </Section>
      )}
    </div>
  )
}

function Section({
  title,
  rows,
  empty,
  accent,
  children,
}: {
  title: string
  rows: ReminderRow[]
  empty: string
  accent: 'red' | 'amber' | 'neutral'
  children: (r: ReminderRow) => React.ReactNode
}) {
  const dot =
    accent === 'red'
      ? 'bg-red-500'
      : accent === 'amber'
        ? 'bg-amber-500'
        : 'bg-neutral-400'
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />
        <h2 className="text-sm font-medium text-neutral-700">
          {title} <span className="text-neutral-400 font-normal">· {rows.length}</span>
        </h2>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-400 px-3 py-2">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg border border-neutral-200 bg-white"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link
                    href={`/dashboard/leads?lead=${r.lead_id}`}
                    className="text-sm font-medium text-neutral-900 hover:underline truncate"
                  >
                    {r.lead_name ?? 'Unknown lead'}
                  </Link>
                  <span className="text-xs text-neutral-500">{fmtLocal(r.scheduled_at)}</span>
                  {r.auto_send && r.status === 'pending' && (
                    <span className="text-[10px] uppercase tracking-wide text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                      auto
                    </span>
                  )}
                </div>
                <div className="text-sm text-neutral-700 mt-0.5">{r.topic}</div>
              </div>
              <div className="flex flex-wrap gap-1.5">{children(r)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ActiveActions({
  row,
  busy,
  onSend,
  onSnooze,
  onResolve,
  onCancel,
  onAutoToggle,
}: {
  row: ReminderRow
  busy: boolean
  onSend: () => void
  onSnooze: (hours: number) => void
  onResolve: () => void
  onCancel: () => void
  onAutoToggle: () => void
}) {
  return (
    <>
      <button
        onClick={onSend}
        disabled={busy}
        className="text-xs px-2.5 py-1.5 rounded bg-neutral-900 text-white disabled:opacity-50"
      >
        Send now
      </button>
      <button
        onClick={() => onSnooze(1)}
        disabled={busy}
        className="text-xs px-2.5 py-1.5 rounded bg-neutral-100 disabled:opacity-50"
      >
        +1h
      </button>
      <button
        onClick={() => onSnooze(24)}
        disabled={busy}
        className="text-xs px-2.5 py-1.5 rounded bg-neutral-100 disabled:opacity-50"
      >
        +1d
      </button>
      <button
        onClick={onAutoToggle}
        disabled={busy}
        className="text-xs px-2.5 py-1.5 rounded bg-neutral-100 disabled:opacity-50"
        title="Toggle auto-send when due"
      >
        {row.auto_send ? 'Auto: on' : 'Auto: off'}
      </button>
      <button
        onClick={onResolve}
        disabled={busy}
        className="text-xs px-2.5 py-1.5 rounded bg-neutral-100 text-emerald-700 disabled:opacity-50"
      >
        Resolve
      </button>
      <button
        onClick={onCancel}
        disabled={busy}
        className="text-xs px-2.5 py-1.5 rounded bg-neutral-100 text-neutral-500 disabled:opacity-50"
      >
        Cancel
      </button>
    </>
  )
}

function DoneActions({ row }: { row: ReminderRow }) {
  const label =
    row.status === 'sent'
      ? `Sent ${row.fired_at ? fmtLocal(row.fired_at) : ''}`
      : row.status === 'resolved'
        ? `Resolved ${row.resolved_at ? fmtLocal(row.resolved_at) : ''}`
        : row.status === 'cancelled'
          ? 'Cancelled'
          : row.status === 'failed'
            ? 'Failed'
            : row.status
  const tone =
    row.status === 'sent' || row.status === 'resolved'
      ? 'text-emerald-700 bg-emerald-50'
      : row.status === 'failed'
        ? 'text-red-700 bg-red-50'
        : 'text-neutral-500 bg-neutral-100'
  return <span className={`text-[11px] px-2 py-1 rounded ${tone}`}>{label}</span>
}
