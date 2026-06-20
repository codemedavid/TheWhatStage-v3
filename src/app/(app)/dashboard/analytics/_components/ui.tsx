import type { ReactNode } from 'react'
import { formatDelta, type Delta } from '@/lib/analytics/metrics'

/**
 * Server-safe presentational primitives shared across the analytics dashboard.
 * No "use client", no hooks — pure render, callable from server components.
 */

export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`rounded-2xl border border-neutral-200/80 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${className}`}
    >
      {children}
    </div>
  )
}

export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight text-neutral-900">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-[12.5px] text-neutral-500">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

/**
 * A signed change pill. `goodWhen` decides which direction is coloured positive
 * (e.g. leads up = good, lost up = bad). Flat and baseline-less deltas are muted.
 */
export function DeltaBadge({
  delta,
  goodWhen = 'up',
}: {
  delta: Delta | null
  goodWhen?: 'up' | 'down'
}) {
  if (!delta || delta.direction === 'flat' || delta.pct === null) {
    return (
      <span className="inline-flex items-center rounded-full bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium text-neutral-400">
        {delta ? formatDelta(delta) : '—'}
      </span>
    )
  }
  const isGood = delta.direction === goodWhen
  const arrow = delta.direction === 'up' ? '↑' : '↓'
  const tone = isGood ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${tone}`}
    >
      <span aria-hidden>{arrow}</span>
      {formatDelta(delta)}
    </span>
  )
}
