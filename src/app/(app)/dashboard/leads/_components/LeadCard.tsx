'use client'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { LeadRow } from '../_lib/queries'

export function LeadCard({ lead, onClick }: { lead: LeadRow; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: lead.id })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-white border rounded-md p-2 cursor-grab"
      onClick={onClick}
      {...attributes}
      {...listeners}
    >
      <div className="text-sm font-medium text-[#111827]">{lead.name}</div>
      {lead.company && <div className="text-xs text-[#6B7280]">{lead.company}</div>}
      {lead.estimated_value !== null && (
        <div className="text-xs text-emerald-700 mt-1">${lead.estimated_value}</div>
      )}
    </div>
  )
}
