'use client'
import { useEffect, useOptimistic, startTransition, useState, useTransition } from 'react'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  horizontalListSortingStrategy,
  arrayMove,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { moveProject, archiveProject, unarchiveProject } from '../actions/projects'
import { markThreadRead } from '../../leads/actions/messenger'
import { createProjectStage, reorderProjectStages } from '../actions/stages'
import { splitStageProjects } from '../_lib/board-split'
import { buildProjectToolbarModel, type DrawerTab, type ProjectToolbarModel } from '../_lib/project-toolbar'
import { ProjectDrawer } from './ProjectDrawer'
import { StageSettingsDrawer } from './StageSettingsDrawer'
import type { ProjectCardRow } from '../_lib/queries'
import { UnreadBadge } from '../../_components/UnreadBadge'
import type { ProjectStageRow } from '@/lib/projects/types'
import { formatMoney } from '../_lib/format'

export { formatMoney }

type Column = { stage: ProjectStageRow; projects: ProjectCardRow[] }

// Stage columns and project cards share one DndContext. Column sortable ids are
// prefixed so onDragEnd can tell a column drag from a card drag, and the same
// prefixed id doubles as the card drop target for an empty column.
const STAGE_PREFIX = 'stage:'
const stageDragId = (stageId: string) => `${STAGE_PREFIX}${stageId}`
const stageIdFromDrag = (dragId: string) =>
  dragId.startsWith(STAGE_PREFIX) ? dragId.slice(STAGE_PREFIX.length) : null

type BoardAction =
  | { type: 'moveProject'; id: string; toStageId: string; toIndex: number }
  | { type: 'reorderStages'; orderedIds: string[] }

export function ProjectBoardClient({
  columns,
  stages,
  showArchived,
}: {
  columns: Column[]
  stages: ProjectStageRow[]
  showArchived: boolean
}) {
  const [creating, setCreating] = useState(false)
  // Open the edit drawer instantly from the in-memory row instead of doing a
  // `router.push(?project=)` round-trip — the server refetch was what made the
  // drawer feel laggy. Mirrors the leads board's local `editing` state.
  const [selected, setSelected] = useState<ProjectCardRow | null>(null)
  // Which tab the edit drawer opens on. A normal card click lands on 'overview';
  // the card's Read button opens straight into 'conversation'.
  const [selectedTab, setSelectedTab] = useState<DrawerTab>('overview')
  const [settingsStage, setSettingsStage] = useState<ProjectStageRow | null>(null)

  const openProject = (project: ProjectCardRow) => {
    setSelectedTab('overview')
    setSelected(project)
  }

  // Card "Read messages" fast path: jump into the conversation and clear the
  // unread/missed badges in one click. The board refreshes via revalidatePath.
  const openMessages = (project: ProjectCardRow) => {
    setSelectedTab('conversation')
    setSelected(project)
    startTransition(async () => {
      try { await markThreadRead(project.lead_id) }
      catch { /* badge state refreshes on next load */ }
    })
  }
  const [optimistic, setOptimistic] = useOptimistic(
    columns,
    (state, action: BoardAction) => {
      if (action.type === 'reorderStages') {
        const byId = new Map(state.map((c) => [c.stage.id, c]))
        return action.orderedIds
          .map((id) => byId.get(id))
          .filter((c): c is Column => Boolean(c))
      }
      const next = state.map((c) => ({ ...c, projects: [...c.projects] }))
      let moved: ProjectCardRow | undefined
      for (const c of next) {
        const i = c.projects.findIndex((p) => p.id === action.id)
        if (i >= 0) { moved = c.projects.splice(i, 1)[0]; break }
      }
      if (!moved) return state
      const target = next.find((c) => c.stage.id === action.toStageId)
      if (!target) return state
      target.projects.splice(action.toIndex, 0, { ...moved, stage_id: action.toStageId })
      return next
    },
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)

    // Column drag: active id is prefixed. Resolve the target column whether the
    // pointer is over another column or over a card inside one.
    const activeStageId = stageIdFromDrag(activeId)
    if (activeStageId) {
      const targetStageId =
        stageIdFromDrag(overId) ??
        optimistic.find((c) => c.projects.some((p) => p.id === overId))?.stage.id
      if (!targetStageId || targetStageId === activeStageId) return
      const ids = optimistic.map((c) => c.stage.id)
      const from = ids.indexOf(activeStageId)
      const to = ids.indexOf(targetStageId)
      if (from < 0 || to < 0) return
      const orderedIds = arrayMove(ids, from, to)
      startTransition(async () => {
        setOptimistic({ type: 'reorderStages', orderedIds })
        await reorderProjectStages(orderedIds)
      })
      return
    }

    // Card drag: over id is either a prefixed (empty) column or another card.
    let toStageId: string | undefined
    let toIndex = 0
    const overColId = stageIdFromDrag(overId)
    const overCol = overColId ? optimistic.find((c) => c.stage.id === overColId) : undefined
    if (overCol) {
      toStageId = overCol.stage.id
      toIndex = overCol.projects.length
    } else {
      for (const c of optimistic) {
        const i = c.projects.findIndex((p) => p.id === overId)
        if (i >= 0) { toStageId = c.stage.id; toIndex = i; break }
      }
    }
    if (!toStageId) return
    const finalStageId = toStageId
    startTransition(async () => {
      setOptimistic({ type: 'moveProject', id: activeId, toStageId: finalStageId, toIndex })
      await moveProject(activeId, finalStageId, toIndex)
    })
  }

  const defaultStageId = stages.find((s) => s.is_default)?.id ?? stages[0]?.id ?? null

  return (
    <>
      <div className="mb-3 flex items-center justify-end">
        <button
          type="button"
          onClick={() => setCreating(true)}
          disabled={!defaultStageId}
          className="rounded-md px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--lead-accent)' }}
        >
          + New project
        </button>
      </div>

      <DndContext id="project-board" sensors={sensors} onDragEnd={onDragEnd}>
        <SortableContext
          items={optimistic.map((c) => stageDragId(c.stage.id))}
          strategy={horizontalListSortingStrategy}
        >
          <div className="lead-scroll lead-edge-fade flex gap-3 overflow-x-auto pb-4">
            {optimistic.map((c) => (
              <StageColumn
                key={c.stage.id}
                stage={c.stage}
                projects={c.projects}
                showArchived={showArchived}
                onOpen={openProject}
                onReadMessages={openMessages}
                onSettings={setSettingsStage}
              />
            ))}
            <AddStageColumn />
          </div>
        </SortableContext>
      </DndContext>

      {creating && defaultStageId && (
        <ProjectDrawer
          mode="create"
          stages={stages}
          createStageId={defaultStageId}
          onClose={() => setCreating(false)}
        />
      )}

      {selected && (
        <ProjectDrawer
          key={selected.id}
          mode="edit"
          project={selected}
          stages={stages}
          initialTab={selectedTab}
          onClose={() => setSelected(null)}
        />
      )}

      {settingsStage && (
        <StageSettingsDrawer
          key={settingsStage.id}
          stage={settingsStage}
          onClose={() => setSettingsStage(null)}
        />
      )}
    </>
  )
}

function StageColumn({
  stage,
  projects,
  showArchived,
  onOpen,
  onReadMessages,
  onSettings,
}: {
  stage: ProjectStageRow
  projects: ProjectCardRow[]
  showArchived: boolean
  onOpen: (project: ProjectCardRow) => void
  onReadMessages: (project: ProjectCardRow) => void
  onSettings: (stage: ProjectStageRow) => void
}) {
  // Archived cards never enter the sortable list; they render as static dimmed
  // rows below it only when the operator reveals them. Count + subtotal still
  // span the full set, so the header reflects archived value too.
  const { active, archived, archivedCount } = splitStageProjects(projects, showArchived)
  // The column is a sortable item (for left/right reorder) AND the drop target
  // for cards landing in an empty column. Dragging is bound to the header grip
  // only, so clicking cards / the ⋯ button never starts a column drag.
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: stageDragId(stage.id) })

  // Gate dnd-kit wiring until mount so the aria ids match the server HTML.
  // Mirrors ProjectCard.
  const [mounted, setMounted] = useState(false)
  const [, startMountTransition] = useTransition()
  useEffect(() => startMountTransition(() => setMounted(true)), [])

  const subtotal = projects.reduce((sum, p) => sum + (p.value ?? 0), 0)
  const currency = projects[0]?.currency ?? 'PHP'

  const style: React.CSSProperties = {
    transform: mounted ? CSS.Transform.toString(transform) : undefined,
    transition: mounted ? transition : undefined,
    opacity: mounted && isDragging ? 0.5 : 1,
    background: mounted && isOver ? 'var(--lead-accent-tint)' : 'var(--lead-surface-2)',
    border: '1px solid var(--lead-line)',
    minHeight: 320,
  }

  return (
    <div
      ref={mounted ? setNodeRef : undefined}
      style={style}
      className="flex w-[296px] shrink-0 flex-col rounded-2xl p-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            ref={mounted ? setActivatorNodeRef : undefined}
            {...(mounted ? attributes : {})}
            {...(mounted ? listeners : {})}
            aria-label={`Reorder ${stage.name} stage`}
            className="lead-focus -ml-1 cursor-grab rounded p-0.5 active:cursor-grabbing"
            style={{ color: 'var(--lead-muted)', touchAction: 'none' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" />
              <circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" />
              <circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
            </svg>
          </button>
          {stage.color && (
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: stage.color }} />
          )}
          <span className="text-[13px] font-semibold" style={{ color: 'var(--lead-ink)' }}>
            {stage.name}
          </span>
          <span className="text-[11px]" style={{ color: 'var(--lead-muted)' }}>{projects.length}</span>
          {archivedCount > 0 && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              style={{ background: 'var(--lead-surface)', color: 'var(--lead-muted)', border: '1px solid var(--lead-line)' }}
              title={`${archivedCount} archived card(s) — hidden from the board but still counted`}
            >
              {archivedCount} archived
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {subtotal > 0 && (
            <span className="text-[11px] font-medium" style={{ color: 'var(--lead-muted)' }}>
              {formatMoney(subtotal, currency)}
            </span>
          )}
          <button
            type="button"
            onClick={() => onSettings(stage)}
            aria-label={`${stage.name} stage settings`}
            className="lead-focus rounded p-0.5"
            style={{ color: 'var(--lead-muted)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>
        </div>
      </div>

      <SortableContext items={active.map((p) => p.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-1 flex-col gap-2">
          {active.map((p) => (
            <ProjectCard key={p.id} project={p} onOpen={onOpen} onReadMessages={onReadMessages} />
          ))}
        </div>
      </SortableContext>

      {archived.length > 0 && (
        <div className="mt-3 flex flex-col gap-2 border-t pt-3" style={{ borderColor: 'var(--lead-line)' }}>
          <div className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--lead-muted)' }}>
            Archived
          </div>
          {archived.map((p) => (
            <ArchivedCard key={p.id} project={p} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  )
}

function ArchivedCard({ project, onOpen }: { project: ProjectCardRow; onOpen: (project: ProjectCardRow) => void }) {
  const [pending, start] = useTransition()

  const restore = (e: React.MouseEvent) => {
    e.stopPropagation()
    start(async () => {
      try { await unarchiveProject(project.id) }
      catch { /* surfaced on next load; revalidatePath refreshes the board */ }
    })
  }

  return (
    <div
      onClick={() => onOpen(project)}
      className="lead-focus cursor-pointer rounded-xl p-2.5"
      style={{ background: 'var(--lead-surface)', border: '1px dashed var(--lead-line)', opacity: 0.6 }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 truncate text-[13px] font-medium leading-snug" style={{ color: 'var(--lead-ink)' }}>
          {project.title}
        </span>
        {project.value != null && (
          <span className="shrink-0 text-[12px] font-semibold" style={{ color: 'var(--lead-muted)' }}>
            {formatMoney(project.value, project.currency)}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="truncate text-[11.5px]" style={{ color: 'var(--lead-muted)' }}>
          {project.lead_name ?? 'Unknown customer'}
        </span>
        <button
          type="button"
          onClick={restore}
          disabled={pending}
          className="shrink-0 text-[11.5px] font-medium disabled:opacity-50"
          style={{ color: 'var(--lead-accent)' }}
        >
          {pending ? 'Restoring…' : 'Unarchive'}
        </button>
      </div>
    </div>
  )
}

// Hover-revealed action cluster pinned to a card's bottom-right corner: a green
// Archive toggle and (when messages are waiting) a quick Read button. Kept off
// the default paint so it doesn't clutter the dense board, and every button
// stops pointer/click propagation so it never starts a drag or opens the drawer.
function CardQuickActions({
  archive,
  read,
  archiving,
  onArchive,
  onRead,
  stop,
}: {
  archive: ProjectToolbarModel['archive']
  read: ProjectToolbarModel['read']
  archiving: boolean
  onArchive: (e: React.MouseEvent) => void
  onRead: (e: React.MouseEvent) => void
  stop: (e: React.SyntheticEvent) => void
}) {
  const readStyle =
    read.variant === 'unread'
      ? { background: '#dc2626', color: '#ffffff', border: '1px solid #dc2626' }
      : { background: '#fffbeb', color: '#b45309', border: '1px solid #fcd34d' }

  return (
    <div
      className="absolute bottom-1.5 right-1.5 z-10 flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100"
      onPointerDown={stop}
    >
      {read.show && (
        <button
          type="button"
          onPointerDown={stop}
          onClick={onRead}
          title={`${read.label} — open conversation`}
          aria-label={`${read.label} — open conversation`}
          className="lead-focus inline-flex h-6 items-center gap-1 rounded-full px-1.5 text-[10.5px] font-semibold shadow-sm"
          style={readStyle}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </svg>
          {read.count}
        </button>
      )}
      <button
        type="button"
        onPointerDown={stop}
        onClick={onArchive}
        disabled={archiving}
        title={archive.isArchived ? 'Unarchive' : 'Archive — declutter the board, totals still counted'}
        aria-label={archive.isArchived ? 'Unarchive project' : 'Archive project'}
        className="lead-focus inline-flex h-6 items-center gap-1 rounded-full px-2 text-[10.5px] font-semibold shadow-sm disabled:opacity-50"
        style={{ background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0' }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="4" width="18" height="4" rx="1" />
          <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M9 12h6" />
        </svg>
        {archiving ? '…' : archive.label}
      </button>
    </div>
  )
}

function ProjectCard({
  project,
  onOpen,
  onReadMessages,
}: {
  project: ProjectCardRow
  onOpen: (project: ProjectCardRow) => void
  onReadMessages: (project: ProjectCardRow) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.id })
  const [archiving, startArchive] = useTransition()
  const { archive, read } = buildProjectToolbarModel(project)

  // Stop the click/pointer from reaching the card (which opens the drawer) or
  // dnd-kit (which would start a drag) when an action button is pressed.
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  const onArchive = (e: React.MouseEvent) => {
    e.stopPropagation()
    startArchive(async () => {
      try { await archiveProject(project.id) }
      catch { /* surfaced on next load; revalidatePath refreshes the board */ }
    })
  }

  const onRead = (e: React.MouseEvent) => {
    e.stopPropagation()
    onReadMessages(project)
  }

  // dnd-kit's `attributes` include an `aria-describedby` ID from a global
  // counter that drifts between SSR and the client. Gate sortable wiring until
  // after mount so the first paint matches the server HTML. Mirrors LeadCard.
  const [mounted, setMounted] = useState(false)
  const [, startMountTransition] = useTransition()
  useEffect(() => startMountTransition(() => setMounted(true)), [])

  const style: React.CSSProperties = {
    transform: mounted ? CSS.Transform.toString(transform) : undefined,
    transition: mounted ? transition : undefined,
    opacity: mounted && isDragging ? 0.5 : 1,
    background: 'var(--lead-surface)',
    border: '1px solid var(--lead-line)',
    boxShadow: mounted && isDragging ? 'var(--lead-shadow-lg)' : 'var(--lead-shadow-sm)',
  }

  return (
    <div
      ref={mounted ? setNodeRef : undefined}
      style={style}
      {...(mounted ? attributes : {})}
      {...(mounted ? listeners : {})}
      onClick={(e) => {
        // A drag ends with a synthetic click — ignore it so dropping a card
        // doesn't also open the drawer.
        if (mounted && isDragging) return
        e.stopPropagation()
        onOpen(project)
      }}
      className="lead-focus group relative cursor-grab rounded-xl p-2.5 transition-shadow active:cursor-grabbing"
    >
      <CardQuickActions
        archive={archive}
        read={read}
        archiving={archiving}
        onArchive={onArchive}
        onRead={onRead}
        stop={stop}
      />
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium leading-snug" style={{ color: 'var(--lead-ink)' }}>
          <span className="truncate">{project.title}</span>
          <UnreadBadge count={project.unread_count} title={`${project.unread_count} unread message(s) from this client`} />
          {project.unread_count === 0 && (
            <UnreadBadge count={project.missed_count} variant="missed" title={`${project.missed_count} missed message(s)`} />
          )}
        </span>
        {project.value != null && (
          <span className="shrink-0 text-[12px] font-semibold" style={{ color: 'var(--lead-accent)' }}>
            {formatMoney(project.value, project.currency)}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px]" style={{ color: 'var(--lead-muted)' }}>
        {project.lead_picture_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={project.lead_picture_url} alt="" className="h-4 w-4 rounded-full object-cover" />
        ) : (
          <span className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-semibold text-white" style={{ background: 'var(--lead-accent)' }}>
            {(project.lead_name ?? '?').charAt(0).toUpperCase()}
          </span>
        )}
        <span className="truncate">{project.lead_name ?? 'Unknown customer'}</span>
      </div>
      {project.origin_submission_kind && (
        <span className="mt-1.5 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ background: 'var(--lead-accent-soft)', color: 'var(--lead-accent)' }}>
          from {project.origin_submission_kind}
        </span>
      )}
    </div>
  )
}

function AddStageColumn() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const reset = () => { setName(''); setError(null); setOpen(false) }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    start(async () => {
      try {
        await createProjectStage({ name: name.trim(), kind: 'open' })
        reset()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add stage')
      }
    })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="lead-focus flex w-[296px] shrink-0 flex-col items-center justify-center rounded-2xl text-[13px] font-medium"
        style={{ minHeight: 140, color: 'var(--lead-muted)', border: '1px dashed var(--lead-line-strong)' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className="mt-1.5">Add stage</span>
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="flex w-[296px] shrink-0 flex-col gap-2 rounded-2xl p-3" style={{ background: 'var(--lead-surface-2)', border: '1px solid var(--lead-line)' }}>
      <div className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--lead-ink)' }}>New stage</div>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="rounded-md border px-2.5 py-1.5 text-[13px]" style={{ borderColor: 'var(--lead-line)', background: 'var(--lead-surface)', color: 'var(--lead-ink)' }} />
      {error && <div className="text-[12px]" style={{ color: '#dc2626' }}>{error}</div>}
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={reset} className="rounded-md border px-2.5 py-1.5 text-[12.5px]" style={{ borderColor: 'var(--lead-line)', color: 'var(--lead-body)' }}>Cancel</button>
        <button type="submit" disabled={pending} className="rounded-md px-2.5 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-50" style={{ background: 'var(--lead-accent)' }}>{pending ? 'Adding…' : 'Add stage'}</button>
      </div>
    </form>
  )
}
