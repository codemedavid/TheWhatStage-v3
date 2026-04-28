'use client'
import { useOptimistic, startTransition } from 'react'
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
import type { LeadRow, StageRow, FieldDefRow } from '../_lib/queries'
import type { LeadsQuery } from '../_lib/schemas'

type Column = { stage: StageRow; leads: LeadRow[]; total: number }

export function KanbanBoardClient({
  columns, stages, fieldDefs, params,
}: {
  columns: Column[]
  stages: StageRow[]
  fieldDefs: FieldDefRow[]
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

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-3">
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
            />
          </SortableContext>
        ))}
      </div>
    </DndContext>
  )
}
