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
import { moveProject } from '../actions/projects'
import { createProjectStage, reorderProjectStages } from '../actions/stages'
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
}: {
  columns: Column[]
  stages: ProjectStageRow[]
}) {
  const [creating, setCreating] = useState(false)
  // Open the edit drawer instantly from the in-memory row instead of doing a
  // `router.push(?project=)` round-trip — the server refetch was what made the
  // drawer feel laggy. Mirrors the leads board's local `editing` state.
  const [selected, setSelected] = useState<ProjectCardRow | null>(null)
  const [settingsStage, setSettingsStage] = useState<ProjectStageRow | null>(null)
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
                onOpen={setSelected}
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
  onOpen,
  onSettings,
}: {
  stage: ProjectStageRow
  projects: ProjectCardRow[]
  onOpen: (project: ProjectCardRow) => void
  onSettings: (stage: ProjectStageRow) => void
}) {
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

      <SortableContext items={projects.map((p) => p.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-1 flex-col gap-2">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} onOpen={onOpen} />
          ))}
        </div>
      </SortableContext>
    </div>
  )
}

function ProjectCard({ project, onOpen }: { project: ProjectCardRow; onOpen: (project: ProjectCardRow) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.id })

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
      className="lead-focus cursor-grab rounded-xl p-2.5 transition-shadow active:cursor-grabbing"
    >
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
