'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  loadLeadSubmissions,
  type LeadSubmission,
} from '../actions/submissions'
import { SubmissionView } from '../../_components/SubmissionView'
import { createProjectFromSubmission } from '../../projects/actions/projects'

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; rows: LeadSubmission[] }

export function SubmissionsPanel({
  leadId,
  kinds,
  emptyMessage,
}: {
  leadId: string
  kinds?: string[]
  emptyMessage?: string
}) {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [, startTransition] = useTransition()
  const kindsKey = kinds?.join(',') ?? ''

  useEffect(() => {
    let cancelled = false
    startTransition(() => setState({ kind: 'loading' }))
    loadLeadSubmissions(leadId, kinds ? { kinds } : undefined)
      .then((rows) => {
        if (!cancelled) startTransition(() => setState({ kind: 'ready', rows }))
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          startTransition(() => setState({
            kind: 'error',
            message: e instanceof Error ? e.message : 'Failed to load',
          }))
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, kindsKey, startTransition])

  if (state.kind === 'loading') {
    return (
      <div className="text-[12.5px]" style={{ color: 'var(--lead-muted)' }}>
        Loading submissions…
      </div>
    )
  }
  if (state.kind === 'error') {
    return (
      <div className="text-[12.5px]" style={{ color: 'var(--lead-danger)' }}>
        {state.message}
      </div>
    )
  }
  if (state.rows.length === 0) {
    return (
      <div
        className="rounded-lg p-4 text-[12.5px]"
        style={{
          background: 'var(--lead-surface-2)',
          border: '1px solid var(--lead-line)',
          color: 'var(--lead-muted)',
        }}
      >
        {emptyMessage ?? 'This lead hasn’t submitted any action pages yet.'}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {state.rows.map((s) => (
        <SubmissionCard key={s.id} submission={s} />
      ))}
    </div>
  )
}

function SubmissionCard({ submission }: { submission: LeadSubmission }) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const [marking, startMark] = useTransition()
  const [markError, setMarkError] = useState<string | null>(null)
  const when = new Date(submission.created_at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  const markAsProject = () => {
    setMarkError(null)
    startMark(async () => {
      try {
        const id = await createProjectFromSubmission(submission.id)
        router.push(`/dashboard/projects?project=${id}`)
      } catch (e) {
        setMarkError(e instanceof Error ? e.message : 'Failed to create project')
      }
    })
  }
  return (
    <div
      className="rounded-lg"
      style={{
        background: 'var(--lead-surface)',
        border: '1px solid var(--lead-line)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="lead-focus flex w-full items-center gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{
            background: 'var(--lead-surface-2)',
            color: 'var(--lead-muted)',
          }}
        >
          {submission.action_page_kind}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-[13px] font-medium"
          style={{ color: 'var(--lead-ink)' }}
        >
          {submission.action_page_title}
        </span>
        {submission.outcome && (
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
            style={{
              background: outcomeBg(submission.outcome),
              color: outcomeFg(submission.outcome),
            }}
          >
            {submission.outcome}
          </span>
        )}
        <span
          className="shrink-0 text-[11px] tabular-nums"
          style={{ color: 'var(--lead-faint)' }}
        >
          {when}
        </span>
      </button>
      {open && (
        <div
          className="border-t px-3 py-2.5"
          style={{ borderColor: 'var(--lead-line)' }}
        >
          <SubmissionView
            kind={submission.action_page_kind}
            data={submission.data}
            theme="panel"
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            {markError && (
              <span className="text-[11.5px]" style={{ color: 'var(--lead-danger)' }}>{markError}</span>
            )}
            <button
              type="button"
              onClick={markAsProject}
              disabled={marking}
              className="ml-auto rounded-md px-2.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--lead-accent)' }}
            >
              {marking ? 'Creating…' : 'Mark as project'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function outcomeBg(outcome: string): string {
  if (/qualified|won|booked|completed|submitted/i.test(outcome)) {
    return 'rgba(5,150,105,0.12)'
  }
  if (/disqualified|lost|cancelled/i.test(outcome)) {
    return 'rgba(220,38,38,0.10)'
  }
  return 'var(--lead-surface-2)'
}

function outcomeFg(outcome: string): string {
  if (/qualified|won|booked|completed|submitted/i.test(outcome)) return '#047857'
  if (/disqualified|lost|cancelled/i.test(outcome)) return '#B91C1C'
  return 'var(--lead-body)'
}
