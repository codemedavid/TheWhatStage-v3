'use client'
import { useState } from 'react'
import { splitStageProjects } from '../_lib/board-split'
import { formatMoney } from '../_lib/format'
import { formatListDate, deriveProjectPriority, type PriorityTone } from '../_lib/list-view'
import type { DrawerTab } from '../_lib/project-toolbar'
import { useArchiveReveal } from './_useArchiveReveal'
import { ProjectDrawer } from './ProjectDrawer'
import { UnreadBadge } from '../../_components/UnreadBadge'
import type { ProjectCardRow } from '../_lib/queries'
import type { ProjectStageRow, ProjectWorkspaceRow } from '@/lib/projects/types'

type Column = { stage: ProjectStageRow; projects: ProjectCardRow[] }

// One shared grid template keeps the per-stage header row and every data row in
// perfect column alignment. The table scrolls horizontally on narrow screens
// rather than collapsing columns, mirroring the board's overflow behaviour.
const GRID =
  'minmax(200px,2.2fr) minmax(120px,1fr) minmax(160px,1.6fr) 116px 84px 96px'

const PRIORITY_STYLE: Record<PriorityTone, React.CSSProperties> = {
  high: { background: '#fce7f3', color: '#be185d' },
  medium: { background: '#fef9c3', color: '#a16207' },
  low: { background: '#dcfce7', color: '#15803d' },
  won: { background: '#d1fae5', color: '#047857' },
  lost: { background: '#fee2e2', color: '#b91c1c' },
}

export function ProjectListView({
  columns,
  stages,
  workspaceId,
  workspaces,
}: {
  columns: Column[]
  stages: ProjectStageRow[]
  workspaceId: string
  workspaces: ProjectWorkspaceRow[]
}) {
  const { showArchived } = useArchiveReveal()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<ProjectCardRow | null>(null)
  const [selectedTab] = useState<DrawerTab>('overview')
  // Which stage a new project is being created in (null = closed).
  const [createStageId, setCreateStageId] = useState<string | null>(null)

  const defaultStageId = stages.find((s) => s.is_default)?.id ?? stages[0]?.id ?? null

  const toggle = (stageId: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(stageId)) next.delete(stageId)
      else next.add(stageId)
      return next
    })

  return (
    <>
      <div className="mb-3 flex items-center justify-end">
        <button
          type="button"
          onClick={() => defaultStageId && setCreateStageId(defaultStageId)}
          disabled={!defaultStageId}
          className="rounded-md px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--lead-accent)' }}
        >
          + New project
        </button>
      </div>

      <div className="lead-scroll overflow-x-auto pb-4">
        <div className="flex min-w-[760px] flex-col gap-4">
          {columns.map(({ stage, projects }) => (
            <StageGroup
              key={stage.id}
              stage={stage}
              projects={projects}
              showArchived={showArchived}
              isCollapsed={collapsed.has(stage.id)}
              onToggle={() => toggle(stage.id)}
              onOpen={setSelected}
              onAdd={() => setCreateStageId(stage.id)}
            />
          ))}
        </div>
      </div>

      {createStageId && (
        <ProjectDrawer
          mode="create"
          stages={stages}
          createStageId={createStageId}
          workspaceId={workspaceId}
          onClose={() => setCreateStageId(null)}
        />
      )}

      {selected && (
        <ProjectDrawer
          key={selected.id}
          mode="edit"
          project={selected}
          stages={stages}
          workspaceId={workspaceId}
          workspaces={workspaces}
          initialTab={selectedTab}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  )
}

function StageGroup({
  stage,
  projects,
  showArchived,
  isCollapsed,
  onToggle,
  onOpen,
  onAdd,
}: {
  stage: ProjectStageRow
  projects: ProjectCardRow[]
  showArchived: boolean
  isCollapsed: boolean
  onToggle: () => void
  onOpen: (project: ProjectCardRow) => void
  onAdd: () => void
}) {
  const { active, archived } = splitStageProjects(projects, showArchived)
  const rows = [...active, ...archived]
  const subtotal = projects.reduce((sum, p) => sum + (p.value ?? 0), 0)
  const currency = projects[0]?.currency ?? 'PHP'

  return (
    <section
      className="overflow-hidden rounded-2xl"
      style={{ background: 'var(--lead-surface)', border: '1px solid var(--lead-line)' }}
    >
      {/* Group header — collapsible, colour-keyed to the stage. */}
      <div
        className="flex items-center justify-between gap-2 px-3 py-2"
        style={{ background: 'var(--lead-surface-2)', borderBottom: isCollapsed ? 'none' : '1px solid var(--lead-line)' }}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!isCollapsed}
          className="lead-focus flex min-w-0 items-center gap-2 rounded-md py-0.5 pr-1"
        >
          <svg
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden
            style={{ color: 'var(--lead-muted)', transform: isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 120ms' }}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
          <span
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[12px] font-semibold uppercase tracking-wide"
            style={{ background: stage.color ? `${stage.color}22` : 'var(--lead-surface)', color: 'var(--lead-ink)' }}
          >
            {stage.color && <span className="h-2 w-2 rounded-full" style={{ background: stage.color }} />}
            {stage.name}
            <span style={{ color: 'var(--lead-muted)' }}>{active.length}</span>
          </span>
        </button>
        <div className="flex items-center gap-2">
          {subtotal > 0 && (
            <span className="text-[11.5px] font-medium" style={{ color: 'var(--lead-muted)' }}>
              {formatMoney(subtotal, currency)}
            </span>
          )}
          <button
            type="button"
            onClick={onAdd}
            aria-label={`Add project to ${stage.name}`}
            className="lead-focus rounded-md p-1"
            style={{ color: 'var(--lead-muted)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <>
          {/* Column headings */}
          <div
            className="grid items-center gap-3 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide"
            style={{ gridTemplateColumns: GRID, color: 'var(--lead-muted)', borderBottom: '1px solid var(--lead-line)' }}
          >
            <span>Project Name</span>
            <span>Client</span>
            <span>Description</span>
            <span>Deadline</span>
            <span>People</span>
            <span>Priority</span>
          </div>

          {rows.length === 0 ? (
            <div className="px-3 py-4 text-[12.5px]" style={{ color: 'var(--lead-muted)' }}>
              No projects in this stage.
            </div>
          ) : (
            rows.map((project) => (
              <ProjectRow key={project.id} project={project} onOpen={onOpen} />
            ))
          )}
        </>
      )}
    </section>
  )
}

function ProjectRow({
  project,
  onOpen,
}: {
  project: ProjectCardRow
  onOpen: (project: ProjectCardRow) => void
}) {
  const priority = deriveProjectPriority(project)

  return (
    <button
      type="button"
      onClick={() => onOpen(project)}
      className="lead-focus grid w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[color:var(--lead-surface-2)]"
      style={{ gridTemplateColumns: GRID, borderBottom: '1px solid var(--lead-line)', opacity: project.is_archived ? 0.55 : 1 }}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium" style={{ color: 'var(--lead-ink)' }}>
        <span className="truncate">{project.title}</span>
        <UnreadBadge count={project.unread_count} title={`${project.unread_count} unread message(s)`} />
        {project.unread_count === 0 && (
          <UnreadBadge count={project.missed_count} variant="missed" title={`${project.missed_count} missed message(s)`} />
        )}
        {project.is_archived && (
          <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide" style={{ background: 'var(--lead-surface-2)', color: 'var(--lead-muted)' }}>
            archived
          </span>
        )}
      </span>

      <span className="truncate text-[12.5px]" style={{ color: 'var(--lead-body)' }}>
        {project.lead_name ?? 'Unknown customer'}
      </span>

      <span className="truncate text-[12.5px]" style={{ color: 'var(--lead-muted)' }}>
        {project.description || '—'}
      </span>

      <span className="text-[12.5px]" style={{ color: 'var(--lead-body)' }}>
        {formatListDate(project.updated_at)}
      </span>

      <span className="flex items-center">
        <Avatar name={project.lead_name} pictureUrl={project.lead_picture_url} />
      </span>

      <span>
        <span
          className="inline-flex items-center rounded-md px-2 py-0.5 text-[11.5px] font-semibold"
          style={PRIORITY_STYLE[priority.tone]}
        >
          {priority.label}
        </span>
      </span>
    </button>
  )
}

function Avatar({ name, pictureUrl }: { name: string | null; pictureUrl: string | null }) {
  if (pictureUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={pictureUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
  }
  return (
    <span
      className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-white"
      style={{ background: 'var(--lead-accent)' }}
    >
      {(name ?? '?').charAt(0).toUpperCase()}
    </span>
  )
}
