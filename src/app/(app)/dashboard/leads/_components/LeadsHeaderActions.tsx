'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useUrlState } from './_useUrlState'
import { ThemeToggle } from './LeadsShell'
import { LeadDrawer } from './LeadDrawer'
import { ExportMenu } from './ExportMenu'
import type { StageRow, FieldDefRow, CampaignOption } from '../_lib/queries'

export function LeadsHeaderActions({
  view, stages, fieldDefs, campaigns,
}: {
  view: 'kanban' | 'table' | 'contact'
  stages: StageRow[]
  fieldDefs: FieldDefRow[]
  campaigns: CampaignOption[]
}) {
  const [openAdd, setOpenAdd] = useState(false)

  return (
    <>
      <ViewSwitch view={view} />
      <Divider />
      <OverflowMenu />
      <ExportMenu />
      <ThemeToggle />
      <button
        type="button"
        onClick={() => setOpenAdd(true)}
        className="lead-focus inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors"
        style={{
          background: 'var(--lead-accent)',
          color: '#fff',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--lead-accent-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--lead-accent)')}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add lead
      </button>

      {openAdd && (
        <LeadDrawer
          mode="create"
          stages={stages}
          fieldDefs={fieldDefs}
          campaigns={campaigns}
          onClose={() => setOpenAdd(false)}
        />
      )}
    </>
  )
}

function Divider() {
  return (
    <span
      aria-hidden
      className="h-5 w-px"
      style={{ background: 'var(--lead-line)' }}
    />
  )
}

function ViewSwitch({ view }: { view: 'kanban' | 'table' | 'contact' }) {
  const { set } = useUrlState()
  return (
    <div
      className="inline-flex h-8 items-center rounded-full p-0.5"
      style={{ background: 'var(--lead-surface-2)', border: '1px solid var(--lead-line)' }}
    >
      {(['kanban', 'table', 'contact'] as const).map((v) => {
        const active = view === v
        return (
          <button
            key={v}
            type="button"
            onClick={() => set({ view: v })}
            aria-pressed={active}
            className="lead-focus inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-all"
            style={{
              background: active ? 'var(--lead-surface)' : 'transparent',
              color: active ? 'var(--lead-ink)' : 'var(--lead-muted)',
              boxShadow: active ? 'var(--lead-shadow-sm)' : 'none',
            }}
          >
            {v === 'kanban' ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <rect x="3" y="4" width="5" height="16" rx="1" />
                <rect x="10" y="4" width="5" height="10" rx="1" />
                <rect x="17" y="4" width="4" height="13" rx="1" />
              </svg>
            ) : v === 'table' ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                <circle cx="12" cy="12" r="1" />
                <circle cx="5" cy="12" r="1" />
                <circle cx="19" cy="12" r="1" />
              </svg>
            )}
            {v === 'kanban' ? 'Board' : v === 'table' ? 'Table' : 'Contacts'}
          </button>
        )
      })}
    </div>
  )
}

function OverflowMenu() {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Configuration"
        onClick={() => setOpen((v) => !v)}
        className="lead-focus inline-flex h-8 w-8 items-center justify-center rounded-full transition-colors"
        style={{ color: 'var(--lead-muted)' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--lead-surface-2)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="6" r="1.4" />
          <circle cx="12" cy="12" r="1.4" />
          <circle cx="12" cy="18" r="1.4" />
        </svg>
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
            <MenuLink href="/dashboard/leads/stages" label="Manage stages" />
            <MenuLink href="/dashboard/leads/fields" label="Custom fields" />
          </div>
        </>
      )}
    </div>
  )
}

function MenuLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="block px-3 py-2 text-[13px] transition-colors"
      style={{ color: 'var(--lead-body)' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--lead-surface-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {label}
    </Link>
  )
}
