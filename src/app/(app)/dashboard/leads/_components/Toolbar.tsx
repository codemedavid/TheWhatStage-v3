'use client'
import { useEffect, useState, useRef } from 'react'
import { useUrlState } from './_useUrlState'
import type { LeadsQuery } from '../_lib/schemas'

export function Toolbar({ params }: { params: LeadsQuery }) {
  const { set, isPending } = useUrlState()
  const [q, setQ] = useState(params.q ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setTimeout(() => set({ q: q || undefined }), 250)
    return () => clearTimeout(t)
  }, [q, set])

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

  const hasFilters = !!(params.q || params.from || params.to)

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
          placeholder="Search leads"
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

      <DateChip
        label="From"
        value={params.from ?? ''}
        onChange={(v) => set({ from: v || undefined })}
      />
      <DateChip
        label="To"
        value={params.to ?? ''}
        onChange={(v) => set({ to: v || undefined })}
      />

      {params.view !== 'contact' && (
        <SortPicker
          value={params.sort}
          onChange={(v) => set({ sort: v })}
        />
      )}

      {params.view === 'contact' && (
        <>
          <div
            className="inline-flex h-8 items-center rounded-full p-0.5"
            style={{ background: 'var(--lead-surface-2)', border: '1px solid var(--lead-line)' }}
          >
            {(['either', 'phone', 'email', 'both'] as const).map((f) => {
              const active = params.contact_filter === f
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => set({ contact_filter: f, page: undefined })}
                  className="lead-focus h-7 cursor-pointer rounded-full px-3 text-[12px] transition-colors"
                  style={{
                    background: active ? 'var(--lead-accent)' : 'transparent',
                    color: active ? '#fff' : 'var(--lead-ink)',
                  }}
                >
                  {f === 'either' ? 'Has either' : f === 'phone' ? 'Has phone' : f === 'email' ? 'Has email' : 'Has both'}
                </button>
              )
            })}
          </div>

          <label
            className="relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors"
            style={{
              color: 'var(--lead-body)',
              background: 'var(--lead-surface)',
              border: '1px solid var(--lead-line)',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden style={{ color: 'var(--lead-muted)' }}>
              <path d="M3 6h13M3 12h9M3 18h5M17 8v12m0 0-3-3m3 3 3-3" />
            </svg>
            <select
              value={params.contact_sort}
              onChange={(e) => set({ contact_sort: e.target.value, page: undefined })}
              className="lead-focus cursor-pointer bg-transparent pr-1 outline-none"
              style={{ color: 'inherit' }}
            >
              <option value="recent_contact">Most recent contact</option>
              <option value="recent_lead">Most recent lead activity</option>
              <option value="name_asc">Name A–Z</option>
            </select>
          </label>
        </>
      )}

      {hasFilters && (
        <button
          type="button"
          onClick={() => set({ q: undefined, from: undefined, to: undefined })}
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

function SortPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label
      className="relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors"
      style={{
        color: 'var(--lead-body)',
        background: 'var(--lead-surface)',
        border: '1px solid var(--lead-line)',
      }}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden style={{ color: 'var(--lead-muted)' }}>
        <path d="M3 6h13M3 12h9M3 18h5M17 8v12m0 0-3-3m3 3 3-3" />
      </svg>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="lead-focus cursor-pointer bg-transparent pr-1 outline-none"
        style={{ color: 'inherit' }}
      >
        <option value="recent">Most recent</option>
        <option value="oldest">Oldest</option>
        <option value="name_asc">Name A–Z</option>
        <option value="value_desc">Value high to low</option>
      </select>
    </label>
  )
}
