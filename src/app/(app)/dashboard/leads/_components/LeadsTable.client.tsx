'use client'
import { useState } from 'react'
import { LeadDrawer } from './LeadDrawer'
import { BulkActionBar } from './BulkActionBar'
import type { LeadRow, StageRow, FieldDefRow } from '../_lib/queries'

export function LeadsTableClient({
  rows, stages, fieldDefs,
}: {
  rows: LeadRow[]
  stages: StageRow[]
  fieldDefs: FieldDefRow[]
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<LeadRow | null>(null)

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const toggleAll = () =>
    setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))

  const stageName = (id: string) => stages.find((s) => s.id === id)?.name ?? '—'

  return (
    <div className="border rounded-md overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[#F9FAFB] text-[#6B7280]">
          <tr>
            <th className="w-10 p-2">
              <input type="checkbox" checked={allChecked} onChange={toggleAll} />
            </th>
            <th className="text-left p-2">Name</th>
            <th className="text-left p-2">Email</th>
            <th className="text-left p-2">Company</th>
            <th className="text-left p-2">Stage</th>
            <th className="text-left p-2">Value</th>
            <th className="text-left p-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="p-6 text-center text-[#6B7280]">
                No leads.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr
              key={r.id}
              className="border-t hover:bg-[#F9FAFB] cursor-pointer"
              onClick={() => setEditing(r)}
            >
              <td className="p-2" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={() => toggle(r.id)}
                />
              </td>
              <td className="p-2 font-medium">{r.name}</td>
              <td className="p-2">{r.email ?? '—'}</td>
              <td className="p-2">{r.company ?? '—'}</td>
              <td className="p-2">{stageName(r.stage_id)}</td>
              <td className="p-2">{r.estimated_value ?? '—'}</td>
              <td className="p-2">{new Date(r.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {selected.size > 0 && (
        <BulkActionBar
          ids={Array.from(selected)}
          stages={stages}
          fieldDefs={fieldDefs}
          onDone={() => setSelected(new Set())}
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
