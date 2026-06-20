'use client'
import { useEffect, useState, useRef } from 'react'
import { useUrlState } from './_useUrlState'
import type { ProjectsQuery } from '../_lib/schemas'

export function ProjectsToolbar({ params }: { params: ProjectsQuery }) {
  const { set, isPending } = useUrlState()
  const [q, setQ] = useState(params.q ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  // Debounced search push. Only fire when the typed value differs from the URL —
  // otherwise the mount run (and every navigation) would push a redundant
  // replace. `set` is stable, so this effect runs only on real `q` changes.
  useEffect(() => {
    if (q === (params.q ?? '')) return
    const t = setTimeout(() => set({ q: q || undefined }), 250)
    return () => clearTimeout(t)
  }, [q, params.q, set])

  // "/" focuses search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const hasFilters = !!(params.q || params.range !== 'all' || params.from || params.to)

  return (
    <div
      className="mt-4 flex flex-wrap items-center gap-2"
      style={{
        opacity: isPending ? 0.7 : 1,
        transition: 'opacity 120ms',
      }}
      aria-busy={isPending}
    >
      <div
        className="group relative flex h-8 flex-1 min-w-[260px] max-w-md items-center gap-2 rounded-full px-3 transition-colors"
        style={{
          background: 'var(--lead-surface)',
          border: '1px solid var(--lead-line)',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ color: 'var(--lead-muted)' }}>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search projects"
          className="w-full bg-transparent text-[13px] outline-none placeholder:text-[color:var(--lead-faint)]"
          style={{ color: 'var(--lead-ink)' }}
        />
        {q ? (
          <button
            type="button"
            onClick={() => setQ('')}
            className="lead-focus inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full"
            style={{ color: 'var(--lead-muted)', background: 'var(--lead-surface-2)' }}
            aria-label="Clear search"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        ) : (
          <kbd
            className="hidden sm:inline-flex h-5 items-center rounded-md px-1.5 font-mono text-[10.5px]"
            style={{
              color: 'var(--lead-muted)',
              background: 'var(--lead-surface-2)',
              border: '1px solid var(--lead-line)',
            }}
          >
            /
          </kbd>
        )}
      </div>

      <RangePicker
        value={params.range}
        onChange={(v) => set({ range: v === 'all' ? undefined : v, from: undefined, to: undefined })}
      />

      <DateChip
        label="From"
        value={params.from ?? ''}
        onChange={(v) => set({ range: 'custom', from: v || undefined })}
      />
      <DateChip
        label="To"
        value={params.to ?? ''}
        onChange={(v) => set({ range: 'custom', to: v || undefined })}
      />

      {hasFilters && (
        <button
          type="button"
          onClick={() => set({ q: undefined, range: undefined, from: undefined, to: undefined })}
          className="lead-focus h-8 cursor-pointer rounded-full px-3 text-[12.5px] font-medium transition-colors"
          style={{ color: 'var(--lead-accent)' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--lead-accent-tint)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          Clear filters
        </button>
      )}
    </div>
  )
}

const RANGE_OPTIONS: { value: ProjectsQuery['range']; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All' },
]

function RangePicker({
  value,
  onChange,
}: {
  value: ProjectsQuery['range']
  onChange: (v: ProjectsQuery['range']) => void
}) {
  // `custom` (set via the From/To chips) is not one of the segments, so no
  // preset is highlighted while a custom range is active.
  return (
    <div
      className="inline-flex h-8 items-center rounded-full p-0.5"
      style={{ background: 'var(--lead-surface-2)', border: '1px solid var(--lead-line)' }}
    >
      {RANGE_OPTIONS.map(({ value: v, label }) => {
        const active = value === v
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            aria-pressed={active}
            className="lead-focus h-7 cursor-pointer rounded-full px-3 text-[12px] font-medium transition-colors"
            style={{
              background: active ? 'var(--lead-accent)' : 'transparent',
              color: active ? '#fff' : 'var(--lead-ink)',
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

function DateChip({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const has = !!value
  return (
    <label
      className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12.5px] transition-colors"
      style={{
        color: has ? 'var(--lead-ink)' : 'var(--lead-muted)',
        background: has ? 'var(--lead-accent-tint)' : 'var(--lead-surface)',
        border: `1px solid ${has ? 'var(--lead-accent-ring)' : 'var(--lead-line)'}`,
      }}
    >
      <span className="font-medium">{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="lead-focus cursor-pointer bg-transparent outline-none"
        style={{ color: 'inherit', colorScheme: 'inherit' }}
      />
    </label>
  )
}
