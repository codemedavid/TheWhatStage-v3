'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { loadLeadProjects, createLeadProject } from '../actions/projects'
import { WorkspacePicker } from '../../projects/_components/WorkspacePicker.client'
import { projectHref } from '../../projects/_lib/links'
import type { ProjectCardRow } from '../../projects/_lib/queries'

type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; rows: ProjectCardRow[] }

export function LeadProjectsPanel({ leadId }: { leadId: string }) {
  const router = useRouter()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    startTransition(() => setState({ kind: 'loading' }))
    loadLeadProjects(leadId)
      .then((rows) => {
        if (!cancelled) startTransition(() => setState({ kind: 'ready', rows }))
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          startTransition(() =>
            setState({ kind: 'error', message: e instanceof Error ? e.message : 'Failed to load' }),
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [leadId, startTransition])

  const open = (id: string) => router.push(projectHref(id))

  const create = async (workspaceId: string) => {
    const id = await createLeadProject(leadId, undefined, workspaceId)
    router.push(projectHref(id))
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px]" style={{ color: 'var(--lead-muted)' }}>
          Deals and work created for this customer.
        </p>
        <WorkspacePicker
          label="+ New project"
          onPick={create}
          onError={setError}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--lead-accent)' }}
        />
      </div>

      {error && (
        <div className="text-[12px]" style={{ color: 'var(--lead-danger)' }}>{error}</div>
      )}

      {state.kind === 'loading' && (
        <div className="text-[12.5px]" style={{ color: 'var(--lead-muted)' }}>Loading projects…</div>
      )}

      {state.kind === 'error' && (
        <div className="text-[12.5px]" style={{ color: 'var(--lead-danger)' }}>{state.message}</div>
      )}

      {state.kind === 'ready' && state.rows.length === 0 && (
        <div
          className="rounded-lg p-4 text-[12.5px]"
          style={{ background: 'var(--lead-surface-2)', border: '1px solid var(--lead-line)', color: 'var(--lead-muted)' }}
        >
          No projects yet. Create one to track this deal and steer the assistant for this customer.
        </div>
      )}

      {state.kind === 'ready' && state.rows.length > 0 && (
        <div className="space-y-2">
          {state.rows.map((p) => (
            <ProjectRow key={p.id} project={p} onOpen={() => open(p.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function ProjectRow({ project, onOpen }: { project: ProjectCardRow; onOpen: () => void }) {
  const terminal = project.stage_kind === 'won' || project.stage_kind === 'lost'
  const chipBg =
    project.stage_kind === 'won'
      ? 'rgba(22,163,74,0.12)'
      : project.stage_kind === 'lost'
        ? 'rgba(220,38,38,0.10)'
        : 'var(--lead-accent-soft)'
  const chipFg =
    project.stage_kind === 'won'
      ? '#16a34a'
      : project.stage_kind === 'lost'
        ? '#dc2626'
        : 'var(--lead-accent)'

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left"
      style={{ background: 'var(--lead-surface)', border: '1px solid var(--lead-line)' }}
    >
      <span
        className="min-w-0 flex-1 truncate text-[13px] font-medium"
        style={{ color: 'var(--lead-ink)', opacity: terminal ? 0.7 : 1 }}
      >
        {project.title}
      </span>
      {project.value != null && (
        <span className="shrink-0 text-[12px] tabular-nums" style={{ color: 'var(--lead-body)' }}>
          {project.currency} {project.value}
        </span>
      )}
      {project.stage_name && (
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
          style={{ background: chipBg, color: chipFg }}
        >
          {project.stage_name}
        </span>
      )}
    </button>
  )
}
