'use client'
import { useState } from 'react'
import { useUrlState } from './_useUrlState'
import { ProjectBoardClient } from './ProjectBoard.client'
import { ProjectListView } from './ProjectListView.client'
import type { ProjectCardRow } from '../_lib/queries'
import type { ProjectStageRow, ProjectWorkspaceRow } from '@/lib/projects/types'

export type ProjectView = 'kanban' | 'list'

type Column = { stage: ProjectStageRow; projects: ProjectCardRow[] }

const TABS: { value: ProjectView; label: string; icon: React.ReactNode }[] = [
  {
    value: 'kanban',
    label: 'Kanban',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="4" width="6" height="16" rx="1" />
        <rect x="15" y="4" width="6" height="10" rx="1" />
      </svg>
    ),
  },
  {
    value: 'list',
    label: 'List',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
      </svg>
    ),
  },
]

export function ProjectViews({
  initialView,
  columns,
  stages,
  workspaceId,
  workspaces,
}: {
  initialView: ProjectView
  columns: Column[]
  stages: ProjectStageRow[]
  workspaceId: string
  workspaces: ProjectWorkspaceRow[]
}) {
  const { set } = useUrlState()
  // Local state drives the instant switch; the URL is updated in step so the
  // choice is shareable and survives a refresh. `kanban` is the default and is
  // kept out of the URL to avoid a noisy ?view=kanban.
  const [view, setView] = useState<ProjectView>(initialView)

  const select = (next: ProjectView) => {
    setView(next)
    set({ view: next === 'kanban' ? undefined : next })
  }

  return (
    <div className="mt-5">
      <div
        className="mb-4 inline-flex items-center rounded-full p-0.5"
        style={{ background: 'var(--lead-surface-2)', border: '1px solid var(--lead-line)' }}
        role="tablist"
        aria-label="Project view"
      >
        {TABS.map(({ value, label, icon }) => {
          const active = view === value
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => select(value)}
              className="lead-focus inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors"
              style={{
                background: active ? 'var(--lead-accent)' : 'transparent',
                color: active ? '#fff' : 'var(--lead-ink)',
              }}
            >
              {icon}
              {label}
            </button>
          )
        })}
      </div>

      {view === 'kanban' ? (
        <ProjectBoardClient
          columns={columns}
          stages={stages}
          workspaceId={workspaceId}
          workspaces={workspaces}
        />
      ) : (
        <ProjectListView
          columns={columns}
          stages={stages}
          workspaceId={workspaceId}
          workspaces={workspaces}
        />
      )}
    </div>
  )
}
