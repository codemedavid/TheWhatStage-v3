'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LeadDrawer } from './LeadDrawer'
import { BulkActionBar } from './BulkActionBar'
import type { LeadRow, StageRow, FieldDefRow, CampaignOption } from '../_lib/queries'

function formatValue(v: number | null): string {
  if (v === null) return ''
  if (v >= 1_000_000) return `₱${(v / 1_000_000).toFixed(v % 1_000_000 ? 1 : 0)}M`
  if (v >= 1_000) return `₱${(v / 1_000).toFixed(v % 1_000 ? 1 : 0)}k`
  return `₱${v.toLocaleString()}`
}

export function LeadsTableClient({
  rows, stages, fieldDefs, campaigns,
}: {
  rows: LeadRow[]
  stages: StageRow[]
  fieldDefs: FieldDefRow[]
  campaigns: CampaignOption[]
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
    <div
      className="overflow-hidden rounded-2xl"
      style={{
        background: 'var(--lead-surface)',
        border: '1px solid var(--lead-line)',
        boxShadow: 'var(--lead-shadow-sm)',
      }}
    >
      <div className="overflow-x-auto lead-scroll">
        <table className="w-full text-[13px]">
          <thead
            className="sticky top-0 z-[1]"
            style={{
              background: 'var(--lead-surface-2)',
              borderBottom: '1px solid var(--lead-line)',
            }}
          >
            <tr style={{ color: 'var(--lead-muted)' }}>
              <th className="w-10 px-3 py-2.5 text-left">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  className="lead-focus h-3.5 w-3.5 rounded accent-[color:var(--lead-accent)]"
                />
              </th>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Phone</Th>
              <Th>Company</Th>
              <Th>Stage</Th>
              <Th>Campaign</Th>
              <Th align="right">Value</Th>
              <Th align="right">Created</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-6 py-12 text-center" style={{ color: 'var(--lead-muted)' }}>
                  <div className="text-[14px] font-medium" style={{ color: 'var(--lead-ink)' }}>
                    No leads match
                  </div>
                  <div className="mt-1 text-[12.5px]">Try clearing filters or adding a lead.</div>
                </td>
              </tr>
            )}
            {rows.map((r, i) => {
              const isSel = selected.has(r.id)
              return (
                <tr
                  key={r.id}
                  onClick={() => setEditing(r)}
                  className="group cursor-pointer transition-colors"
                  style={{
                    borderTop: i === 0 ? 'none' : '1px solid var(--lead-line)',
                    background: isSel ? 'var(--lead-accent-tint)' : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSel) e.currentTarget.style.background = 'var(--lead-surface-2)'
                  }}
                  onMouseLeave={(e) => {
                    if (!isSel) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSel}
                      onChange={() => toggle(r.id)}
                      className="lead-focus h-3.5 w-3.5 rounded accent-[color:var(--lead-accent)]"
                    />
                  </td>
                  <td className="px-3 py-2.5 font-medium" style={{ color: 'var(--lead-ink)' }}>
                    <div className="flex items-center gap-2">
                      <Avatar src={r.picture_url} name={r.name} />
                      <span className="truncate">{r.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--lead-body)' }}>
                    <ContactCell primary={r.email} all={r.emails} />
                  </td>
                  <td className="px-3 py-2.5 tabular-nums" style={{ color: 'var(--lead-body)' }}>
                    <ContactCell primary={r.phone} all={r.phones} />
                  </td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--lead-body)' }}>
                    {r.company ?? <Em />}
                  </td>
                  <td className="px-3 py-2.5">
                    <StageBadge name={stageName(r.stage_id)} />
                  </td>
                  <td className="px-3 py-2.5">
                    <CampaignBadge name={r.campaign_name} />
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--lead-ink)' }}>
                    {r.estimated_value !== null ? formatValue(r.estimated_value) : <Em />}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: 'var(--lead-muted)' }} suppressHydrationWarning>
                    {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

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
          campaigns={campaigns}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  )
}

function Em() {
  return <span style={{ color: 'var(--lead-faint)' }}>—</span>
}

function ContactCell({ primary, all }: { primary: string | null; all: string[] | null }) {
  const values = useMemo(() => {
    const seen = new Set<string>()
    const list: string[] = []
    for (const v of [primary, ...(all ?? [])]) {
      if (!v) continue
      const t = v.trim()
      if (!t || seen.has(t)) continue
      seen.add(t)
      list.push(t)
    }
    return list
  }, [primary, all])

  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t)) return
      if (popRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const close = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  if (values.length === 0) return <Em />
  if (values.length === 1) return <span className="truncate">{values[0]}</span>

  const toggleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (open) {
      setOpen(false)
      return
    }
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width })
    setOpen(true)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggleOpen}
        className="lead-focus inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-[color:var(--lead-surface-2)]"
        style={{ color: 'var(--lead-body)' }}
        title={`${values.length} detected`}
      >
        <span className="truncate">{values[0]}</span>
        <span
          className="inline-flex h-4 shrink-0 items-center rounded-sm px-1 text-[10px] font-medium tabular-nums"
          style={{ background: 'var(--lead-surface-2)', color: 'var(--lead-muted)' }}
        >
          +{values.length - 1}
        </span>
        <Chevron open={open} />
      </button>
      {open && pos && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popRef}
            className="overflow-hidden rounded-lg py-1 text-[12.5px]"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              minWidth: Math.max(pos.width, 220),
              zIndex: 50,
              background: 'var(--lead-surface)',
              border: '1px solid var(--lead-line)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
            }}
          >
            {values.map((v, i) => (
              <div
                key={`${v}-${i}`}
                className="flex items-center gap-2 px-3 py-1.5"
                style={{ color: 'var(--lead-ink)' }}
              >
                <span className="flex-1 truncate">{v}</span>
                {i === 0 && (
                  <span
                    className="rounded-sm px-1 text-[10px] uppercase tracking-wide"
                    style={{ background: 'var(--lead-accent-soft)', color: 'var(--lead-accent)' }}
                  >
                    Primary
                  </span>
                )}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      aria-hidden
      style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms', flexShrink: 0 }}
    >
      <path
        d="M2 3.5L5 6.5L8 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

function Avatar({ src, name }: { src: string | null; name: string }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        className="h-6 w-6 shrink-0 rounded-full object-cover"
        style={{ background: 'var(--lead-accent-soft)' }}
      />
    )
  }
  return (
    <span
      aria-hidden
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold"
      style={{ color: 'var(--lead-accent)', background: 'var(--lead-accent-soft)' }}
    >
      {initials(name)}
    </span>
  )
}

function CampaignBadge({ name }: { name: string | null }) {
  return (
    <span
      className="inline-flex max-w-[160px] items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium"
      title={name ?? 'Main bot (no campaign)'}
      style={{
        color: name ? 'var(--lead-body)' : 'var(--lead-faint)',
        background: 'var(--lead-surface-2)',
        border: '1px solid var(--lead-line)',
      }}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: name ? 'var(--lead-accent)' : 'var(--lead-faint)' }}
      />
      <span className="truncate">{name ?? 'Main bot'}</span>
    </span>
  )
}

function StageBadge({ name }: { name: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium"
      style={{
        color: 'var(--lead-accent)',
        background: 'var(--lead-accent-soft)',
      }}
    >
      {name}
    </span>
  )
}
