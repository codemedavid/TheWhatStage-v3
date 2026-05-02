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
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center">
      <div
        className="pointer-events-auto flex h-12 items-center gap-2 rounded-full px-3"
        style={{
          background: 'var(--lead-ink)',
          color: 'var(--lead-page)',
          boxShadow: 'var(--lead-shadow-lg)',
        }}
      >
        <span
          className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] font-medium tabular-nums"
          style={{ background: 'rgba(255,255,255,0.10)' }}
        >
          <span style={{ color: 'var(--lead-accent-rail)' }}>●</span>
          {ids.length} selected
        </span>

        <span aria-hidden className="h-5 w-px" style={{ background: 'rgba(255,255,255,0.12)' }} />

        <select
          onChange={(e) => e.target.value && onMove(e.target.value)}
          defaultValue=""
          disabled={pending}
          className="lead-focus h-8 rounded-full px-3 text-[12.5px] font-medium outline-none disabled:opacity-50"
          style={{
            background: 'transparent',
            color: 'inherit',
          }}
        >
          <option value="" disabled style={{ color: '#000' }}>Move to stage</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id} style={{ color: '#000' }}>{s.name}</option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => setEditOpen(true)}
          disabled={pending}
          className="lead-focus inline-flex h-8 items-center rounded-full px-3 text-[12.5px] font-medium transition-colors disabled:opacity-50"
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.10)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          Edit fields
        </button>

        <button
          type="button"
          onClick={onDelete}
          disabled={pending}
          className="lead-focus inline-flex h-8 items-center rounded-full px-3 text-[12.5px] font-medium transition-colors disabled:opacity-50"
          style={{ color: '#fca5a5' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(248,113,113,0.16)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          Delete
        </button>

        <span aria-hidden className="h-5 w-px" style={{ background: 'rgba(255,255,255,0.12)' }} />

        <button
          type="button"
          onClick={onDone}
          aria-label="Clear selection"
          className="lead-focus inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors"
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.10)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

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
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(20,17,11,0.32)' }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        onSubmit={submit}
        className="w-[460px] rounded-2xl"
        style={{
          background: 'var(--lead-surface)',
          border: '1px solid var(--lead-line)',
          boxShadow: 'var(--lead-shadow-lg)',
        }}
      >
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--lead-line)' }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--lead-muted)' }}>
            Bulk edit
          </div>
          <div className="mt-0.5 text-[15px] font-semibold" style={{ color: 'var(--lead-ink)' }}>
            Update {ids.length} {ids.length === 1 ? 'lead' : 'leads'}
          </div>
          <div className="mt-1 text-[12px]" style={{ color: 'var(--lead-muted)' }}>
            Only fields you fill will be applied.
          </div>
        </div>
        <div className="space-y-3 px-5 py-4">
          <Row label="Company">
            <ModalInput onChange={(v) => set('company', v)} />
          </Row>
          <Row label="Source">
            <ModalInput onChange={(v) => set('source', v)} />
          </Row>
          <Row label="Estimated value">
            <ModalInput type="number" prefix="$" onChange={(v) =>
              set('estimated_value', v === '' ? '' : Number(v))
            } />
          </Row>
          {fieldDefs.map((fd) => (
            <Row key={fd.id} label={fd.label}>
              <ModalInput
                type={fd.type === 'number' ? 'number' : fd.type === 'date' ? 'date' : 'text'}
                onChange={(v) =>
                  set(`cf:${fd.key}`, fd.type === 'number' ? Number(v) : v)
                }
              />
            </Row>
          ))}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3" style={{ borderTop: '1px solid var(--lead-line)' }}>
          <button
            type="button"
            onClick={onClose}
            className="lead-focus inline-flex h-8 items-center rounded-full px-3.5 text-[12.5px] font-medium"
            style={{
              color: 'var(--lead-body)',
              border: '1px solid var(--lead-line)',
            }}
          >
            Cancel
          </button>
          <button
            disabled={pending}
            type="submit"
            className="lead-focus inline-flex h-8 items-center rounded-full px-3.5 text-[12.5px] font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--lead-accent)' }}
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
      <div className="mb-1 text-[11.5px] font-medium" style={{ color: 'var(--lead-muted)' }}>{label}</div>
      {children}
    </label>
  )
}

function ModalInput({
  onChange, type = 'text', prefix,
}: {
  onChange: (v: string) => void
  type?: string
  prefix?: string
}) {
  return (
    <div
      className="flex h-9 items-center rounded-lg px-2.5 focus-within:[box-shadow:0_0_0_2px_var(--lead-page),_0_0_0_4px_var(--lead-accent-ring)]"
      style={{ background: 'var(--lead-surface)', border: '1px solid var(--lead-line)' }}
    >
      {prefix && <span className="mr-1 text-[13px]" style={{ color: 'var(--lead-muted)' }}>{prefix}</span>}
      <input
        type={type}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-transparent text-[13px] outline-none"
        style={{ color: 'var(--lead-ink)' }}
      />
    </div>
  )
}
