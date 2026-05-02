'use client'
import { useEffect, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { LeadRow } from '../_lib/queries'

const STALE_AFTER_DAYS = 7

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime()
  return Math.floor(ms / 86_400_000)
}

function formatValue(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v % 1_000_000 ? 1 : 0)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(v % 1_000 ? 1 : 0)}k`
  return `$${v.toLocaleString()}`
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

export function LeadCard({ lead, onClick }: { lead: LeadRow; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: lead.id })

  // dnd-kit's `attributes` include an `aria-describedby` ID drawn from a global
  // counter that drifts between SSR and the client. Skip wiring sortable
  // behavior on the first paint so the server HTML and first client render
  // match exactly; activate after mount.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const style: React.CSSProperties = {
    transform: mounted ? CSS.Transform.toString(transform) : undefined,
    transition: mounted ? transition : undefined,
    opacity: mounted && isDragging ? 0.4 : 1,
    background: 'var(--lead-surface)',
    border: '1px solid var(--lead-line)',
    boxShadow:
      mounted && isDragging ? 'var(--lead-shadow-lg)' : 'var(--lead-shadow-sm)',
  }

  const age = daysSince(lead.updated_at)
  const stale = age >= STALE_AFTER_DAYS

  return (
    <div
      ref={mounted ? setNodeRef : undefined}
      style={style}
      className="group relative cursor-grab rounded-xl px-3 py-2.5 active:cursor-grabbing"
      onClick={(e) => {
        if (mounted && isDragging) return
        e.stopPropagation()
        onClick()
      }}
      {...(mounted ? attributes : {})}
      {...(mounted ? listeners : {})}
    >
      <div className="flex items-start gap-2.5">
        {lead.picture_url ? (
          <img
            src={lead.picture_url}
            alt=""
            referrerPolicy="no-referrer"
            className="mt-0.5 h-7 w-7 shrink-0 rounded-full object-cover"
            style={{ background: 'var(--lead-accent-soft)' }}
          />
        ) : (
          <div
            aria-hidden
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10.5px] font-semibold"
            style={{
              color: 'var(--lead-accent)',
              background: 'var(--lead-accent-soft)',
            }}
          >
            {initials(lead.name)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div
            className="truncate text-[13px] font-medium leading-snug"
            style={{ color: 'var(--lead-ink)' }}
          >
            {lead.name}
          </div>
          {lead.company && (
            <div
              className="truncate text-[11.5px]"
              style={{ color: 'var(--lead-muted)' }}
            >
              {lead.company}
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <span
          className="inline-flex max-w-[160px] items-center rounded-full px-1.5 py-0.5 text-[10.5px] font-medium"
          title={lead.campaign_name ?? 'Main bot (no campaign)'}
          style={{
            color: lead.campaign_name ? 'var(--lead-body)' : 'var(--lead-faint)',
            background: 'var(--lead-surface-2)',
            border: '1px solid var(--lead-line)',
          }}
        >
          <span
            aria-hidden
            className="mr-1 inline-block h-1.5 w-1.5 rounded-full"
            style={{
              background: lead.campaign_name ? 'var(--lead-accent)' : 'var(--lead-faint)',
            }}
          />
          <span className="truncate">{lead.campaign_name ?? 'Main bot'}</span>
        </span>
      </div>

      {(lead.estimated_value !== null || stale) && (
        <div className="mt-2 flex items-center justify-between">
          {lead.estimated_value !== null ? (
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
              style={{
                color: 'var(--lead-accent)',
                background: 'var(--lead-accent-soft)',
              }}
            >
              {formatValue(lead.estimated_value)}
            </span>
          ) : <span />}
          <span
            className="inline-flex items-center gap-1 text-[11px] tabular-nums"
            style={{ color: stale ? 'var(--lead-warn)' : 'var(--lead-faint)' }}
          >
            <span
              aria-hidden
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: stale ? 'var(--lead-warn)' : 'var(--lead-faint)' }}
            />
            {age === 0 ? 'today' : `${age}d`}
          </span>
        </div>
      )}
    </div>
  )
}
