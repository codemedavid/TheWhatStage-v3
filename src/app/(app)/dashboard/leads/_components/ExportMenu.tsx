'use client'
import { useState, useTransition } from 'react'
import { useSearchParams } from 'next/navigation'
import { exportLeadsCsv } from '../actions/export'
import { LeadsQuery } from '../_lib/schemas'

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function ExportMenu() {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const sp = useSearchParams()

  const onExport = (scope: 'filtered' | 'all') => {
    const params = LeadsQuery.parse({
      view: sp.get('view') ?? undefined,
      stage: sp.get('stage') ?? undefined,
      page: sp.get('page') ?? undefined,
      q: sp.get('q') ?? undefined,
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
      sort: sp.get('sort') ?? undefined,
    })
    start(async () => {
      const csv = await exportLeadsCsv(params, scope)
      const stamp = new Date().toISOString().slice(0, 10)
      downloadCsv(`leads-${scope}-${stamp}.csv`, csv)
      setOpen(false)
    })
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className="lead-focus inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors disabled:opacity-50"
        style={{
          color: 'var(--lead-body)',
          border: '1px solid var(--lead-line)',
          background: 'var(--lead-surface)',
        }}
        onMouseEnter={(e) => !pending && (e.currentTarget.style.background = 'var(--lead-surface-2)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--lead-surface)')}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
        </svg>
        Export
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className="absolute right-0 top-9 z-50 w-48 overflow-hidden rounded-xl"
            style={{
              background: 'var(--lead-surface)',
              border: '1px solid var(--lead-line)',
              boxShadow: 'var(--lead-shadow-md)',
            }}
          >
            <MenuButton onClick={() => onExport('filtered')} label="Filtered view" sub="Current filters" />
            <div style={{ borderTop: '1px solid var(--lead-line)' }} />
            <MenuButton onClick={() => onExport('all')} label="All leads" sub="No filters" />
          </div>
        </>
      )}
    </div>
  )
}

function MenuButton({ onClick, label, sub }: { onClick: () => void; label: string; sub: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full px-3 py-2 text-left transition-colors"
      style={{ color: 'var(--lead-body)' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--lead-surface-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <div className="text-[13px] font-medium" style={{ color: 'var(--lead-ink)' }}>{label}</div>
      <div className="text-[11.5px]" style={{ color: 'var(--lead-muted)' }}>{sub}</div>
    </button>
  )
}
