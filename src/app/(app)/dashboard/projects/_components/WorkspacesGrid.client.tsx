'use client'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { duplicateWorkspace } from '../actions/workspaces'
import { WorkspaceSettingsDrawer } from './WorkspaceSettingsDrawer'
import { formatMoney } from '../_lib/format'
import type { WorkspaceSummary } from '../_lib/workspaces'
import type { ProjectWorkspaceRow } from '@/lib/projects/types'

export function WorkspacesGrid({ summaries }: { summaries: WorkspaceSummary[] }) {
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<ProjectWorkspaceRow | null>(null)

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {summaries.map((s) => (
          <WorkspaceCard key={s.id} summary={s} onEdit={() => setEditing(s)} />
        ))}
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="lead-focus flex min-h-[132px] flex-col items-center justify-center rounded-2xl text-[13px] font-medium"
          style={{ color: 'var(--lead-muted)', border: '1px dashed var(--lead-line-strong)' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="mt-1.5">New workspace</span>
        </button>
      </div>

      {creating && <WorkspaceSettingsDrawer mode="create" onClose={() => setCreating(false)} />}
      {editing && (
        <WorkspaceSettingsDrawer key={editing.id} mode="edit" workspace={editing} onClose={() => setEditing(null)} />
      )}
    </>
  )
}

function WorkspaceCard({ summary, onEdit }: { summary: WorkspaceSummary; onEdit: () => void }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const duplicate = () => {
    setError(null)
    start(async () => {
      const res = await duplicateWorkspace(summary.id)
      if (res.ok) router.push(`/dashboard/projects/${res.id}`)
      else setError(res.error)
    })
  }

  const href = `/dashboard/projects/${summary.id}`

  return (
    <div
      className="flex flex-col rounded-2xl p-4"
      style={{ background: 'var(--lead-surface-2)', border: '1px solid var(--lead-line)' }}
    >
      <div className="flex items-center gap-1.5">
        {summary.color && <span className="h-2.5 w-2.5 rounded-full" style={{ background: summary.color }} />}
        <Link href={href} className="lead-focus text-[14px] font-semibold hover:underline" style={{ color: 'var(--lead-ink)' }}>
          {summary.name}
        </Link>
        {summary.is_default && (
          <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'var(--lead-accent-soft)', color: 'var(--lead-accent)' }}>
            Default
          </span>
        )}
      </div>

      <div className="mt-2 text-[12.5px]" style={{ color: 'var(--lead-muted)' }}>
        {summary.activeProjectCount} {summary.activeProjectCount === 1 ? 'project' : 'projects'} · {summary.stageCount} {summary.stageCount === 1 ? 'stage' : 'stages'}
        {summary.openValue > 0 ? ` · ${formatMoney(summary.openValue, summary.currency)}` : ''}
      </div>

      {summary.description && (
        <p className="mt-1.5 line-clamp-2 text-[12px]" style={{ color: 'var(--lead-body)' }}>{summary.description}</p>
      )}

      {error && <div className="mt-2 text-[11.5px]" style={{ color: '#dc2626' }}>{error}</div>}

      <div className="mt-3 flex items-center gap-3 border-t pt-3 text-[12px] font-medium" style={{ borderColor: 'var(--lead-line)' }}>
        <Link href={href} className="lead-focus" style={{ color: 'var(--lead-accent)' }}>Open</Link>
        <button type="button" onClick={duplicate} disabled={pending} className="disabled:opacity-50" style={{ color: 'var(--lead-body)' }}>
          {pending ? 'Duplicating…' : 'Duplicate'}
        </button>
        <button type="button" onClick={onEdit} className="ml-auto" style={{ color: 'var(--lead-muted)' }}>Settings</button>
      </div>
    </div>
  )
}
