'use client'
import { useOptimistic, startTransition, useState, useTransition } from 'react'
import { createStage } from '../actions/stages'
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
} from '@dnd-kit/sortable'
import { moveLead } from '../actions/leads'
import { StageColumn } from './StageColumn'
import type { LeadRow, StageRow, FieldDefRow, CampaignOption } from '../_lib/queries'
import type { LeadsQuery } from '../_lib/schemas'

type Column = { stage: StageRow; leads: LeadRow[]; total: number }

export function KanbanBoardClient({
  columns, stages, fieldDefs, campaigns, params,
}: {
  columns: Column[]
  stages: StageRow[]
  fieldDefs: FieldDefRow[]
  campaigns: CampaignOption[]
  params: LeadsQuery
}) {
  const [optimistic, setOptimistic] = useOptimistic(
    columns,
    (state, action: { id: string; toStageId: string; toIndex: number }) => {
      const next = state.map((c) => ({ ...c, leads: [...c.leads] }))
      let moved: LeadRow | undefined
      for (const c of next) {
        const i = c.leads.findIndex((l) => l.id === action.id)
        if (i >= 0) {
          moved = c.leads.splice(i, 1)[0]
          break
        }
      }
      if (!moved) return state
      const target = next.find((c) => c.stage.id === action.toStageId)
      if (!target) return state
      target.leads.splice(action.toIndex, 0, { ...moved, stage_id: action.toStageId })
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

    let toStageId: string | undefined
    let toIndex = 0
    const overCol = optimistic.find((c) => c.stage.id === overId)
    if (overCol) {
      toStageId = overCol.stage.id
      toIndex = overCol.leads.length
    } else {
      for (const c of optimistic) {
        const i = c.leads.findIndex((l) => l.id === overId)
        if (i >= 0) {
          toStageId = c.stage.id
          toIndex = i
          break
        }
      }
    }
    if (!toStageId) return

    const finalStageId = toStageId
    startTransition(async () => {
      setOptimistic({ id: activeId, toStageId: finalStageId, toIndex })
      await moveLead(activeId, finalStageId, toIndex)
    })
  }

  const allEmpty = optimistic.every((c) => c.total === 0)
  if (allEmpty) {
    return <BoardEmptyState />
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="lead-scroll lead-edge-fade flex gap-3 overflow-x-auto pb-4">
        {optimistic.map((c) => (
          <SortableContext
            key={c.stage.id}
            items={c.leads.map((l) => l.id)}
            strategy={verticalListSortingStrategy}
          >
            <StageColumn
              stage={c.stage}
              leads={c.leads}
              total={c.total}
              page={params.page}
              params={params}
              stages={stages}
              fieldDefs={fieldDefs}
              campaigns={campaigns}
            />
          </SortableContext>
        ))}
        <AddStageColumn />
      </div>
    </DndContext>
  )
}

function AddStageColumn() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const reset = () => {
    setName('')
    setDescription('')
    setError(null)
    setOpen(false)
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    start(async () => {
      try {
        await createStage({ name: name.trim(), description: description.trim() || null })
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
        className="lead-focus flex w-[296px] shrink-0 flex-col items-center justify-center rounded-2xl text-[13px] font-medium transition-colors"
        style={{
          minHeight: 140,
          color: 'var(--lead-muted)',
          background: 'transparent',
          border: '1px dashed var(--lead-line-strong)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'var(--lead-accent-tint)'
          e.currentTarget.style.color = 'var(--lead-accent)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = 'var(--lead-muted)'
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className="mt-1.5">Add stage</span>
      </button>
    )
  }

  return (
    <form
      onSubmit={submit}
      className="flex w-[296px] shrink-0 flex-col gap-2 rounded-2xl p-3"
      style={{
        background: 'var(--lead-surface-2)',
        border: '1px solid var(--lead-line)',
      }}
    >
      <div className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--lead-ink)' }}>
        New stage
      </div>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        className="rounded-md border px-2.5 py-1.5 text-[13px]"
        style={{ borderColor: 'var(--lead-line)', background: 'var(--lead-surface)', color: 'var(--lead-ink)' }}
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (helps AI auto-classify)"
        rows={3}
        className="rounded-md border px-2.5 py-1.5 text-[13px]"
        style={{ borderColor: 'var(--lead-line)', background: 'var(--lead-surface)', color: 'var(--lead-ink)' }}
      />
      {error && <div className="text-[12px]" style={{ color: '#dc2626' }}>{error}</div>}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-md border px-2.5 py-1.5 text-[12.5px]"
          style={{ borderColor: 'var(--lead-line)', color: 'var(--lead-body)' }}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md px-2.5 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--lead-accent)' }}
        >
          {pending ? 'Adding…' : 'Add stage'}
        </button>
      </div>
    </form>
  )
}

function BoardEmptyState() {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-2xl py-20 text-center"
      style={{
        border: '1px dashed var(--lead-line-strong)',
        background: 'var(--lead-surface)',
      }}
    >
      <div
        className="mb-3 flex h-12 w-12 items-center justify-center rounded-full"
        style={{ background: 'var(--lead-accent-soft)', color: 'var(--lead-accent)' }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="4" width="5" height="16" rx="1" />
          <rect x="10" y="4" width="5" height="10" rx="1" />
          <rect x="17" y="4" width="4" height="13" rx="1" />
        </svg>
      </div>
      <div className="text-[15px] font-semibold" style={{ color: 'var(--lead-ink)' }}>
        No leads yet
      </div>
      <div className="mt-1 max-w-xs text-[13px]" style={{ color: 'var(--lead-muted)' }}>
        Add your first lead to start building your pipeline. Use the Add lead button in the top right.
      </div>
    </div>
  )
}
