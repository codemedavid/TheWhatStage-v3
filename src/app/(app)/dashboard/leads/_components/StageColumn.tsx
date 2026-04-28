'use client'
import { useState } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { LeadCard } from './LeadCard'
import { LeadDrawer } from './LeadDrawer'
import { Pagination } from './Pagination'
import type { LeadRow, StageRow, FieldDefRow } from '../_lib/queries'
import type { LeadsQuery } from '../_lib/schemas'

export function StageColumn({
  stage, leads, total, page, params, stages, fieldDefs,
}: {
  stage: StageRow
  leads: LeadRow[]
  total: number
  page: number
  params: LeadsQuery
  stages: StageRow[]
  fieldDefs: FieldDefRow[]
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const [openAdd, setOpenAdd] = useState(false)
  const [editing, setEditing] = useState<LeadRow | null>(null)

  return (
    <div
      ref={setNodeRef}
      className={`w-72 shrink-0 bg-[#F9FAFB] rounded-md p-2 ${isOver ? 'ring-2 ring-emerald-500' : ''}`}
    >
      <div className="flex items-center justify-between px-1 py-1">
        <div>
          <div className="text-sm font-semibold text-[#111827]">{stage.name}</div>
          <div className="text-xs text-[#6B7280]">{total}</div>
        </div>
        <button onClick={() => setOpenAdd(true)} className="text-emerald-600 text-sm">
          + Add
        </button>
      </div>
      <div className="space-y-2 min-h-[40px]">
        {leads.map((l) => (
          <LeadCard key={l.id} lead={l} onClick={() => setEditing(l)} />
        ))}
      </div>
      <div className="pt-2">
        <Pagination total={total} page={page} makeHref={(p) => buildHref(params, p)} />
      </div>

      {openAdd && (
        <LeadDrawer
          mode="create"
          stages={stages}
          fieldDefs={fieldDefs}
          onClose={() => setOpenAdd(false)}
        />
      )}
      {editing && (
        <LeadDrawer
          mode="edit"
          lead={editing}
          stages={stages}
          fieldDefs={fieldDefs}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function buildHref(params: LeadsQuery, page: number) {
  const u = new URLSearchParams()
  u.set('view', 'kanban')
  if (params.q) u.set('q', params.q)
  if (params.from) u.set('from', params.from)
  if (params.to) u.set('to', params.to)
  u.set('sort', params.sort)
  u.set('page', String(page))
  return `/dashboard/leads?${u.toString()}`
}
