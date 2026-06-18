'use client'
import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useDroppable } from '@dnd-kit/core'
import { LeadCard } from './LeadCard'
import { LeadDrawer } from './LeadDrawer'
import { Pagination } from './Pagination'
import { updateStage, deleteStage } from '../actions/stages'
import type { LeadRow, StageRow, FieldDefRow, CampaignOption } from '../_lib/queries'
import type { LeadsQuery } from '../_lib/schemas'

function sumValue(leads: LeadRow[]): number {
  return leads.reduce((acc, l) => acc + (l.estimated_value ?? 0), 0)
}

function formatTotal(v: number): string {
  if (!v) return ''
  if (v >= 1_000_000) return `₱${(v / 1_000_000).toFixed(v % 1_000_000 ? 1 : 0)}M`
  if (v >= 1_000) return `₱${(v / 1_000).toFixed(v % 1_000 ? 1 : 0)}k`
  return `₱${v.toLocaleString()}`
}

export function StageColumn({
  stage, leads, total, page, params, stages, fieldDefs, campaigns,
}: {
  stage: StageRow
  leads: LeadRow[]
  total: number
  page: number
  params: LeadsQuery
  stages: StageRow[]
  fieldDefs: FieldDefRow[]
  campaigns: CampaignOption[]
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  const [openAdd, setOpenAdd] = useState(false)
  const [editing, setEditing] = useState<LeadRow | null>(null)
  const [editStage, setEditStage] = useState(false)
  const stageValue = formatTotal(sumValue(leads))

  return (
    <div
      ref={setNodeRef}
      className="group/col flex w-[296px] shrink-0 flex-col rounded-2xl"
      style={{
        background: 'var(--lead-surface-2)',
        border: `1px solid ${isOver ? 'var(--lead-accent-rail)' : 'var(--lead-line)'}`,
        boxShadow: isOver ? `inset 0 0 0 1px var(--lead-accent-rail)` : 'none',
        transition: 'border-color 150ms ease, box-shadow 150ms ease',
      }}
    >
      {/* Header */}
      <div className="relative px-3 pt-3">
        <span
          aria-hidden
          className="absolute left-3 right-3 top-0 h-[3px] rounded-b-full"
          style={{ background: 'var(--lead-accent-rail)', opacity: stage.is_default ? 0.45 : 0.85 }}
        />
        <div className="flex items-center gap-2 pt-1">
          <span
            className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide"
            style={{ color: 'var(--lead-ink)' }}
          >
            {stage.name}
            <span
              className="inline-flex h-[18px] min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-semibold tabular-nums"
              style={{
                background: 'var(--lead-surface)',
                color: 'var(--lead-muted)',
                border: '1px solid var(--lead-line)',
              }}
            >
              {total}
            </span>
          </span>
          <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover/col:opacity-100">
            <button
              type="button"
              onClick={() => setEditStage(true)}
              aria-label={`Edit stage ${stage.name}`}
              className="lead-focus inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors"
              style={{ color: 'var(--lead-muted)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--lead-accent-tint)'
                e.currentTarget.style.color = 'var(--lead-accent)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--lead-muted)'
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setOpenAdd(true)}
              aria-label={`Add lead to ${stage.name}`}
              className="lead-focus inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors"
              style={{ color: 'var(--lead-muted)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--lead-accent-tint)'
                e.currentTarget.style.color = 'var(--lead-accent)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--lead-muted)'
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </span>
        </div>
        {stageValue && (
          <div
            className="mt-1 text-[11px] tabular-nums"
            style={{ color: 'var(--lead-muted)' }}
          >
            {stageValue} pipeline value
          </div>
        )}
        <StageRulesPreview
          description={stage.description}
          onClick={() => setEditStage(true)}
        />
      </div>

      {/* Cards */}
      <div className="flex-1 space-y-2 px-2 pb-2 pt-3">
        {leads.length === 0 ? (
          <div
            className="flex h-20 items-center justify-center rounded-xl text-[11.5px]"
            style={{
              color: 'var(--lead-faint)',
              border: `1px dashed ${isOver ? 'var(--lead-accent-rail)' : 'var(--lead-line)'}`,
              background: isOver ? 'var(--lead-accent-tint)' : 'transparent',
            }}
          >
            {isOver ? 'Drop here' : 'Empty'}
          </div>
        ) : (
          leads.map((l) => (
            <LeadCard key={l.id} lead={l} onClick={() => setEditing(l)} />
          ))
        )}
      </div>

      {total > leads.length && (
        <div className="px-3 pb-3 pt-1">
          <Pagination total={total} page={page} makeHref={(p) => buildHref(params, p)} />
        </div>
      )}

      {editStage && (
        <StageEditor stage={stage} onClose={() => setEditStage(false)} />
      )}

      {openAdd && (
        <LeadDrawer
          mode="create"
          stages={stages}
          fieldDefs={fieldDefs}
          campaigns={campaigns}
          presetStageId={stage.id}
          onClose={() => setOpenAdd(false)}
        />
      )}
      {editing && (
        <LeadDrawer
          mode="edit"
          lead={editing}
          stages={stages}
          fieldDefs={fieldDefs}
          campaigns={campaigns}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function StageRulesPreview({
  description,
  onClick,
}: {
  description: string | null
  onClick: () => void
}) {
  const hasRules = !!description?.trim()
  const truncated = hasRules
    ? description!.trim().length > 70
      ? `${description!.trim().slice(0, 70)}…`
      : description!.trim()
    : null

  return (
    <button
      type="button"
      onClick={onClick}
      title={hasRules ? description! : 'Add AI rules for this stage'}
      className="lead-focus mt-2 flex w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] leading-snug transition-colors"
      style={{
        color: hasRules ? 'var(--lead-muted)' : 'var(--lead-faint)',
        border: hasRules ? '1px solid transparent' : '1px dashed var(--lead-line)',
        background: 'transparent',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--lead-accent-tint)'
        e.currentTarget.style.color = 'var(--lead-accent)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = hasRules ? 'var(--lead-muted)' : 'var(--lead-faint)'
      }}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-[1px] shrink-0"
        aria-hidden
      >
        <path d="M12 2l2.39 4.84L20 8l-4 3.9.94 5.5L12 14.77 7.06 17.4 8 11.9 4 8l5.61-1.16L12 2z" />
      </svg>
      <span className="flex-1 truncate">
        {hasRules ? (
          <>
            <span style={{ color: 'var(--lead-faint)' }}>AI moves leads here when: </span>
            {truncated}
          </>
        ) : (
          <>No AI rules — won&apos;t auto-move leads here. <span style={{ textDecoration: 'underline' }}>Add rules</span></>
        )}
      </span>
    </button>
  )
}

function StageEditor({ stage, onClose }: { stage: StageRow; onClose: () => void }) {
  const [name, setName] = useState(stage.name)
  const [description, setDescription] = useState(stage.description ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [, startTransition] = useTransition()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    startTransition(() => setMounted(true))
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose, startTransition])

  const save = () => {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    start(async () => {
      try {
        await updateStage(stage.id, { name: name.trim(), description: description.trim() || null })
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save')
      }
    })
  }

  const remove = () => {
    if (stage.is_default) return
    if (!confirm(`Delete "${stage.name}"? Its leads will move to the default stage.`)) return
    start(async () => {
      try {
        await deleteStage(stage.id)
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete')
      }
    })
  }

  if (!mounted) return null
  const theme = document.querySelector('[data-leads-root]')?.getAttribute('data-theme') ?? 'light'

  return createPortal(
    <div
      data-leads-root
      data-theme={theme}
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${stage.name}`}
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-4 sm:items-center"
      style={{ background: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(2px)' }}
      onClick={onClose}
    >
      <div
        className="my-auto w-full max-w-md rounded-2xl p-5"
        style={{
          background: 'var(--lead-surface)',
          border: '1px solid var(--lead-line)',
          boxShadow: 'var(--lead-shadow-md)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 text-[15px] font-semibold" style={{ color: 'var(--lead-ink)' }}>
          Edit stage
        </div>
        <label className="mb-3 block">
          <div className="mb-1 text-[12px]" style={{ color: 'var(--lead-muted)' }}>Name</div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border px-2.5 py-1.5 text-[13px]"
            style={{ borderColor: 'var(--lead-line)', background: 'var(--lead-surface-2)', color: 'var(--lead-ink)' }}
          />
        </label>
        <label className="mb-3 block">
          <div className="mb-1 text-[12px] font-medium" style={{ color: 'var(--lead-ink)' }}>
            When should the AI move leads here?
          </div>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder={'Describe the signals — keywords, intent, replies, behaviors.\n\ne.g. Lead has confirmed interest and asked about pricing or availability.'}
            className="w-full rounded-md border px-2.5 py-1.5 text-[13px] leading-relaxed"
            style={{ borderColor: 'var(--lead-line)', background: 'var(--lead-surface-2)', color: 'var(--lead-ink)' }}
          />
          <div className="mt-1 text-[11px]" style={{ color: 'var(--lead-faint)' }}>
            The AI reads this to decide when a conversation belongs in this stage. The clearer the rules, the better the auto-classification.
          </div>
        </label>
        {error && (
          <div className="mb-3 text-[12px]" style={{ color: '#dc2626' }}>{error}</div>
        )}
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={remove}
            disabled={stage.is_default || pending}
            className="rounded-md border px-2.5 py-1.5 text-[12.5px] disabled:opacity-50"
            style={{ borderColor: '#fca5a5', color: '#b91c1c' }}
          >
            Delete
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border px-3 py-1.5 text-[12.5px]"
              style={{ borderColor: 'var(--lead-line)', color: 'var(--lead-body)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded-md px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-50"
              style={{ background: 'var(--lead-accent)' }}
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function buildHref(params: LeadsQuery, page: number) {
  const u = new URLSearchParams()
  u.set('view', 'kanban')
  if (params.q) u.set('q', params.q)
  u.set('range', params.range)
  if (params.from) u.set('from', params.from)
  if (params.to) u.set('to', params.to)
  u.set('sort', params.sort)
  u.set('page', String(page))
  return `/dashboard/leads?${u.toString()}`
}
