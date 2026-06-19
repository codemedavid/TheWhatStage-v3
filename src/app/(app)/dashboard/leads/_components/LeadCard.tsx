'use client'
import { useEffect, useState, useTransition } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { LeadRow } from '../_lib/queries'
import { parseMatchedSignals } from '../_lib/signals'
import { UnreadBadge } from '../../_components/UnreadBadge'

const STALE_AFTER_DAYS = 7

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime()
  return Math.floor(ms / 86_400_000)
}

function formatValue(v: number): string {
  if (v >= 1_000_000) return `₱${(v / 1_000_000).toFixed(v % 1_000_000 ? 1 : 0)}M`
  if (v >= 1_000) return `₱${(v / 1_000).toFixed(v % 1_000 ? 1 : 0)}k`
  return `₱${v.toLocaleString()}`
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
  const [, startTransition] = useTransition()
  useEffect(() => startTransition(() => setMounted(true)), [startTransition])

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
  const { matched, freeReason } = parseMatchedSignals(lead.latest_auto_move?.reason)

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
      {lead.latest_auto_move && (
        <div
          className="absolute right-2 top-2 group/badge"
          aria-label={`Auto-moved to ${lead.latest_auto_move.to_stage_name ?? 'stage'} by AI`}
        >
          <span
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold cursor-default"
            style={{
              background: lead.latest_auto_move.source === 'deep_classifier' ? '#ede9fe' : '#dbeafe',
              color:      lead.latest_auto_move.source === 'deep_classifier' ? '#6d28d9' : '#1d4ed8',
              border: '1px solid var(--lead-line)',
            }}
          >
            AI
          </span>
          <div
            className="pointer-events-none absolute right-0 top-6 z-10 hidden w-56 rounded-lg p-2 text-[11px] shadow-md group-hover/badge:block"
            style={{
              background: 'var(--lead-surface)',
              border: '1px solid var(--lead-line)',
              color: 'var(--lead-body)',
            }}
          >
            <div className="font-medium" style={{ color: 'var(--lead-ink)' }}>
              {lead.latest_auto_move.source === 'deep_classifier' ? 'AI audit' : 'AI per-turn'} →{' '}
              {lead.latest_auto_move.to_stage_name ?? 'stage'}
            </div>
            <div className="mt-1" style={{ color: 'var(--lead-faint)' }} suppressHydrationWarning>
              {new Date(lead.latest_auto_move.created_at).toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
              })}
              {lead.latest_auto_move.confidence ? ` · ${lead.latest_auto_move.confidence}` : ''}
            </div>
            {lead.latest_auto_move.reason && (
              <div className="mt-1 line-clamp-3" style={{ color: 'var(--lead-body)' }}>
                {lead.latest_auto_move.reason.slice(0, 200)}
              </div>
            )}
          </div>
        </div>
      )}
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
          <div className="flex items-center gap-1.5">
            <div
              className="truncate text-[13px] font-medium leading-snug"
              style={{ color: 'var(--lead-ink)' }}
            >
              {lead.name}
            </div>
            <UnreadBadge count={lead.unread_count} title={`${lead.unread_count} unread message(s)`} />
            {lead.unread_count === 0 && (
              <UnreadBadge count={lead.missed_count} variant="missed" title={`${lead.missed_count} missed`} />
            )}
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

      {matched.length > 0 && (
        <div className="group/why absolute bottom-2 right-2">
          <button
            className="text-[10px] leading-none hover:text-gray-700"
            style={{ color: 'var(--lead-faint)' }}
            aria-label="Why is this lead here?"
            onClick={(e) => e.stopPropagation()}
          >
            ?
          </button>
          <div
            className="pointer-events-none absolute bottom-5 right-0 z-10 hidden w-56 rounded-lg p-2 text-[11px] shadow-md group-hover/why:block"
            style={{
              background: 'var(--lead-surface)',
              border: '1px solid var(--lead-line)',
              color: 'var(--lead-body)',
            }}
          >
            <div className="font-medium" style={{ color: 'var(--lead-ink)' }}>
              Why this stage
            </div>
            <ul className="mt-1 list-disc pl-4">
              {matched.map((signal) => (
                <li key={signal}>{signal}</li>
              ))}
            </ul>
            {freeReason && (
              <div className="mt-1" style={{ color: 'var(--lead-faint)' }}>
                {freeReason}
              </div>
            )}
            <div className="mt-1 text-[10px]" style={{ color: 'var(--lead-faint)' }}>
              source: {lead.latest_auto_move?.source} ·{' '}
              {lead.latest_auto_move?.confidence ?? '—'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
