'use client'
import { useState, useTransition } from 'react'
import { bulkDeleteLeads, bulkMoveLeads, bulkUpdateLeads } from '../actions/leads'
import type { StageRow, FieldDefRow } from '../_lib/queries'

export function BulkActionBar({
  ids, stages, fieldDefs, onDone,
}: {
  ids: string[]
  stages: StageRow[]
  fieldDefs: FieldDefRow[]
  onDone: () => void
}) {
  const [pending, start] = useTransition()
  const [editOpen, setEditOpen] = useState(false)

  const onMove = (toStageId: string) =>
    start(async () => {
      await bulkMoveLeads(ids, toStageId)
      onDone()
    })

  const onDelete = () => {
    if (!confirm(`Delete ${ids.length} lead(s)?`)) return
    start(async () => {
      await bulkDeleteLeads(ids)
      onDone()
    })
  }

  return (
    <div className="sticky bottom-0 bg-white border-t p-3 flex items-center gap-2 flex-wrap">
      <span className="text-sm text-[#374151]">{ids.length} selected</span>
      <select
        onChange={(e) => e.target.value && onMove(e.target.value)}
        defaultValue=""
        className="border rounded-md px-2 py-1.5 text-sm"
      >
        <option value="" disabled>Move to stage…</option>
        {stages.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <button
        onClick={() => setEditOpen(true)}
        className="px-3 py-1.5 text-sm border rounded-md"
      >
        Edit selected
      </button>
      <button
        onClick={onDelete}
        disabled={pending}
        className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-md disabled:opacity-50"
      >
        Delete
      </button>

      {editOpen && (
        <BulkEditModal
          ids={ids}
          fieldDefs={fieldDefs}
          onClose={() => setEditOpen(false)}
          onDone={() => {
            setEditOpen(false)
            onDone()
          }}
        />
      )}
    </div>
  )
}

function BulkEditModal({
  ids, fieldDefs, onClose, onDone,
}: {
  ids: string[]
  fieldDefs: FieldDefRow[]
  onClose: () => void
  onDone: () => void
}) {
  const [pending, start] = useTransition()
  const [patch, setPatch] = useState<Record<string, unknown>>({})
  const set = (k: string, v: unknown) => setPatch((p) => ({ ...p, [k]: v }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    start(async () => {
      const cf: Record<string, unknown> = {}
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(patch)) {
        if (k.startsWith('cf:')) cf[k.slice(3)] = v
        else if (v !== '' && v !== undefined) out[k] = v
      }
      if (Object.keys(cf).length) out.custom_fields = cf
      await bulkUpdateLeads(ids, out)
      onDone()
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="bg-white rounded-md p-5 w-[420px] space-y-3"
      >
        <h3 className="font-semibold">
          Edit {ids.length} leads — only fields you fill are applied
        </h3>
        <Row label="Company">
          <input
            className="border rounded px-2 py-1 text-sm w-full"
            onChange={(e) => set('company', e.target.value)}
          />
        </Row>
        <Row label="Source">
          <input
            className="border rounded px-2 py-1 text-sm w-full"
            onChange={(e) => set('source', e.target.value)}
          />
        </Row>
        <Row label="Estimated value">
          <input
            type="number"
            className="border rounded px-2 py-1 text-sm w-full"
            onChange={(e) =>
              set('estimated_value', e.target.value === '' ? '' : Number(e.target.value))
            }
          />
        </Row>
        {fieldDefs.map((fd) => (
          <Row key={fd.id} label={fd.label}>
            <input
              className="border rounded px-2 py-1 text-sm w-full"
              type={fd.type === 'number' ? 'number' : fd.type === 'date' ? 'date' : 'text'}
              onChange={(e) =>
                set(`cf:${fd.key}`, fd.type === 'number' ? Number(e.target.value) : e.target.value)
              }
            />
          </Row>
        ))}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm border rounded-md">
            Cancel
          </button>
          <button
            disabled={pending}
            type="submit"
            className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-md"
          >
            Apply
          </button>
        </div>
      </form>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs text-[#374151] mb-1">{label}</div>
      {children}
    </label>
  )
}
