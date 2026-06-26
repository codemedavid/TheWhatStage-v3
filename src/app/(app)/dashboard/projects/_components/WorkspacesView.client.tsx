'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { duplicateWorkspace } from '../actions/workspaces'
import { WorkspaceSettingsDrawer } from './WorkspaceSettingsDrawer'
import { formatMoney } from '../_lib/format'
import {
  filterAndSortWorkspaces,
  formatRelativeUpdated,
  workspaceAvatar,
  WORKSPACE_SORTS,
  type WorkspaceSort,
} from '../_lib/workspace-view'
import type { WorkspaceSummary } from '../_lib/workspaces'
import type { ProjectWorkspaceRow } from '@/lib/projects/types'

type View = 'list' | 'grid'

const GRID_COLS = 'minmax(0,2.4fr) 1fr 1fr 1.2fr 130px'

export function WorkspacesView({ summaries }: { summaries: WorkspaceSummary[] }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<WorkspaceSort>('recent')
  const [view, setView] = useState<View>('list')
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<ProjectWorkspaceRow | null>(null)
  // Reference time captured once at mount; relative labels are coarse so the
  // SSR/CSR strings match (the spans also suppress hydration warnings).
  const [nowMs] = useState(() => Date.now())

  const rows = filterAndSortWorkspaces(summaries, query, sort)

  return (
    <>
      {/* Heading */}
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="max-w-[640px]">
          <h1 className="lead-display text-[36px] leading-[1.1]" style={{ color: 'var(--lead-ink)' }}>
            Projects
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed" style={{ color: 'var(--lead-muted)' }}>
            Each workspace runs its own stages, follow-ups, and projects. Open one to manage its
            board, or duplicate a workspace to reuse its workflow.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="lead-focus flex shrink-0 items-center gap-2 rounded-[10px] px-[18px] py-[11px] text-[14px] font-semibold text-white"
          style={{ background: 'var(--lead-accent)' }}
        >
          <PlusIcon />
          New workspace
        </button>
      </div>

      {/* Toolbar */}
      <div className="mt-6 flex items-center gap-3">
        <div
          className="flex max-w-[340px] flex-1 items-center gap-2.5 rounded-[10px] px-3 py-2.5"
          style={{ background: 'var(--lead-surface)', border: '1px solid var(--lead-line)' }}
        >
          <SearchIcon />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search workspaces"
            aria-label="Search workspaces"
            className="w-full bg-transparent text-[14px] outline-none"
            style={{ color: 'var(--lead-ink)' }}
          />
        </div>

        <SortMenu sort={sort} onChange={setSort} />

        <ViewToggle view={view} onChange={setView} />
      </div>

      {/* List / grid */}
      {view === 'list' ? (
        <div
          className="mt-[18px] overflow-hidden rounded-2xl"
          style={{ background: 'var(--lead-surface)', border: '1px solid var(--lead-line)' }}
        >
          <div
            className="grid items-center gap-[18px] px-6 py-3"
            style={{
              gridTemplateColumns: GRID_COLS,
              background: 'var(--lead-surface-2)',
              borderBottom: '1px solid var(--lead-line)',
            }}
          >
            <HeaderLabel>Workspace</HeaderLabel>
            <HeaderLabel align="right">Projects</HeaderLabel>
            <HeaderLabel align="right">Stages</HeaderLabel>
            <HeaderLabel align="right">Pipeline value</HeaderLabel>
            <span />
          </div>

          {rows.map((s) => (
            <WorkspaceRow
              key={s.id}
              summary={s}
              nowMs={nowMs}
              onEdit={() => setEditing(s)}
            />
          ))}

          <NewWorkspaceRow onClick={() => setCreating(true)} />
        </div>
      ) : (
        <div className="mt-[18px] grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((s) => (
            <WorkspaceCard key={s.id} summary={s} nowMs={nowMs} onEdit={() => setEditing(s)} />
          ))}
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="lead-focus flex min-h-[132px] flex-col items-center justify-center rounded-2xl text-[13px] font-medium"
            style={{ color: 'var(--lead-muted)', border: '1px dashed var(--lead-line-strong)' }}
          >
            <PlusIcon />
            <span className="mt-1.5">New workspace</span>
          </button>
        </div>
      )}

      <div className="mt-3.5 text-[13px]" style={{ color: 'var(--lead-muted)' }}>
        {rows.length} {rows.length === 1 ? 'workspace' : 'workspaces'}
        {query && summaries.length !== rows.length ? ` of ${summaries.length}` : ''}
      </div>

      {creating && <WorkspaceSettingsDrawer mode="create" onClose={() => setCreating(false)} />}
      {editing && (
        <WorkspaceSettingsDrawer
          key={editing.id}
          mode="edit"
          workspace={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

// ── Row ──────────────────────────────────────────────────────────────────────

function WorkspaceRow({
  summary,
  nowMs,
  onEdit,
}: {
  summary: WorkspaceSummary
  nowMs: number
  onEdit: () => void
}) {
  const avatar = workspaceAvatar(summary)
  const href = `/dashboard/projects/${summary.id}`

  return (
    <div
      className="grid items-center gap-[18px] px-6 py-[18px] transition-colors lead-row"
      style={{ gridTemplateColumns: GRID_COLS, borderBottom: '1px solid var(--lead-line)' }}
    >
      <div className="flex min-w-0 items-center gap-3.5">
        <Avatar avatar={avatar} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link
              href={href}
              className="lead-focus truncate text-[15px] font-bold hover:underline"
              style={{ color: 'var(--lead-ink)' }}
            >
              {summary.name}
            </Link>
            {summary.is_default && <DefaultBadge />}
          </div>
          <div
            className="mt-0.5 truncate text-[13px]"
            style={{ color: 'var(--lead-muted)' }}
            suppressHydrationWarning
          >
            {formatRelativeUpdated(summary.updated_at, nowMs)}
          </div>
        </div>
      </div>

      <div className="text-right text-[15px] font-semibold" style={{ color: 'var(--lead-ink)' }}>
        {summary.activeProjectCount}
      </div>
      <div className="text-right text-[15px] font-semibold" style={{ color: 'var(--lead-ink)' }}>
        {summary.stageCount}
      </div>
      <div className="text-right text-[15px] font-bold" style={{ color: 'var(--lead-ink)' }}>
        {summary.openValue > 0 ? formatMoney(summary.openValue, summary.currency) : '—'}
      </div>

      <div className="flex items-center justify-end gap-1.5">
        <Link
          href={href}
          className="lead-focus rounded-lg px-4 py-2 text-[13.5px] font-semibold text-white"
          style={{ background: 'var(--lead-accent)' }}
        >
          Open
        </Link>
        <RowMenu summary={summary} onEdit={onEdit} />
      </div>
    </div>
  )
}

// ── Grid card (alternate view) ───────────────────────────────────────────────

function WorkspaceCard({
  summary,
  nowMs,
  onEdit,
}: {
  summary: WorkspaceSummary
  nowMs: number
  onEdit: () => void
}) {
  const avatar = workspaceAvatar(summary)
  const href = `/dashboard/projects/${summary.id}`

  return (
    <div
      className="flex flex-col rounded-2xl p-4"
      style={{ background: 'var(--lead-surface)', border: '1px solid var(--lead-line)' }}
    >
      <div className="flex items-center gap-3">
        <Avatar avatar={avatar} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Link
              href={href}
              className="lead-focus truncate text-[14.5px] font-bold hover:underline"
              style={{ color: 'var(--lead-ink)' }}
            >
              {summary.name}
            </Link>
            {summary.is_default && <DefaultBadge />}
          </div>
          <div
            className="truncate text-[12.5px]"
            style={{ color: 'var(--lead-muted)' }}
            suppressHydrationWarning
          >
            {formatRelativeUpdated(summary.updated_at, nowMs)}
          </div>
        </div>
        <RowMenu summary={summary} onEdit={onEdit} />
      </div>

      <div className="mt-3 text-[12.5px]" style={{ color: 'var(--lead-muted)' }}>
        {summary.activeProjectCount} {summary.activeProjectCount === 1 ? 'project' : 'projects'} ·{' '}
        {summary.stageCount} {summary.stageCount === 1 ? 'stage' : 'stages'}
        {summary.openValue > 0 ? ` · ${formatMoney(summary.openValue, summary.currency)}` : ''}
      </div>

      <Link
        href={href}
        className="lead-focus mt-3 inline-flex w-fit rounded-lg px-4 py-2 text-[13px] font-semibold text-white"
        style={{ background: 'var(--lead-accent)' }}
      >
        Open
      </Link>
    </div>
  )
}

// ── Shared pieces ────────────────────────────────────────────────────────────

function Avatar({ avatar }: { avatar: { initial: string; bg: string; fg: string } }) {
  return (
    <div
      className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px] text-[17px] font-bold"
      style={{ background: avatar.bg, color: avatar.fg }}
      aria-hidden
    >
      {avatar.initial}
    </div>
  )
}

function DefaultBadge() {
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold"
      style={{ background: 'var(--lead-accent-soft)', color: 'var(--lead-accent)' }}
    >
      Default
    </span>
  )
}

function HeaderLabel({ children, align }: { children: string; align?: 'right' }) {
  return (
    <div
      className="text-[11.5px] font-bold uppercase tracking-[0.06em]"
      style={{ color: 'var(--lead-muted)', textAlign: align }}
    >
      {children}
    </div>
  )
}

function NewWorkspaceRow({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="lead-row flex w-full items-center gap-3.5 px-6 py-4 text-left"
    >
      <div
        className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[11px]"
        style={{ border: '1.5px dashed var(--lead-line-strong)', color: 'var(--lead-muted)' }}
      >
        <PlusIcon />
      </div>
      <div>
        <div className="text-[15px] font-semibold" style={{ color: 'var(--lead-accent)' }}>
          New workspace
        </div>
        <div className="mt-0.5 text-[13px]" style={{ color: 'var(--lead-muted)' }}>
          Start a fresh board, or duplicate an existing workflow
        </div>
      </div>
    </button>
  )
}

// Per-row overflow menu: Open / Duplicate / Settings.
function RowMenu({ summary, onEdit }: { summary: WorkspaceSummary; onEdit: () => void }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))

  const duplicate = () => {
    setError(null)
    setOpen(false)
    start(async () => {
      const res = await duplicateWorkspace(summary.id)
      if (res.ok) router.push(`/dashboard/projects/${res.id}`)
      else setError(res.error)
    })
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="lead-focus flex h-[34px] w-[34px] items-center justify-center rounded-lg"
        style={{ border: '1px solid var(--lead-line)', color: 'var(--lead-muted)' }}
      >
        {pending ? <Spinner /> : <DotsIcon />}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[40px] z-20 w-[164px] overflow-hidden rounded-xl py-1 shadow-lg"
          style={{ background: 'var(--lead-surface)', border: '1px solid var(--lead-line)' }}
        >
          <MenuItem onClick={() => { setOpen(false); router.push(`/dashboard/projects/${summary.id}`) }}>
            Open board
          </MenuItem>
          <MenuItem onClick={duplicate}>Duplicate</MenuItem>
          <MenuItem onClick={() => { setOpen(false); onEdit() }}>Settings</MenuItem>
        </div>
      )}

      {error && (
        <div className="absolute right-0 top-[40px] z-20 w-[200px] rounded-md px-2 py-1 text-[11.5px]" style={{ background: 'var(--lead-surface)', border: '1px solid var(--lead-line)', color: '#dc2626' }}>
          {error}
        </div>
      )}
    </div>
  )
}

function MenuItem({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="lead-row block w-full px-3.5 py-2 text-left text-[13.5px] font-medium"
      style={{ color: 'var(--lead-ink)' }}
    >
      {children}
    </button>
  )
}

function SortMenu({ sort, onChange }: { sort: WorkspaceSort; onChange: (s: WorkspaceSort) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="lead-focus flex items-center gap-1.5 rounded-[10px] px-3.5 py-2.5 text-[13.5px] font-semibold"
        style={{ background: 'var(--lead-surface)', border: '1px solid var(--lead-line)', color: 'var(--lead-body)' }}
      >
        <SortIcon />
        Sort
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[44px] z-20 w-[190px] overflow-hidden rounded-xl py-1 shadow-lg"
          style={{ background: 'var(--lead-surface)', border: '1px solid var(--lead-line)' }}
        >
          {WORKSPACE_SORTS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="menuitemradio"
              aria-checked={sort === opt.value}
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className="lead-row flex w-full items-center justify-between px-3.5 py-2 text-left text-[13.5px] font-medium"
              style={{ color: 'var(--lead-ink)' }}
            >
              {opt.label}
              {sort === opt.value && <CheckIcon />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div
      className="flex gap-0.5 rounded-[10px] p-[3px]"
      style={{ background: 'var(--lead-surface)', border: '1px solid var(--lead-line)' }}
    >
      <ToggleButton active={view === 'list'} label="List view" onClick={() => onChange('list')}>
        <ListIcon />
      </ToggleButton>
      <ToggleButton active={view === 'grid'} label="Grid view" onClick={() => onChange('grid')}>
        <GridIcon />
      </ToggleButton>
    </div>
  )
}

function ToggleButton({
  active,
  label,
  onClick,
  children,
}: {
  active: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className="lead-focus flex h-[30px] w-[34px] items-center justify-center rounded-[7px]"
      style={{
        background: active ? 'var(--lead-accent)' : 'transparent',
        color: active ? '#fff' : 'var(--lead-muted)',
      }}
    >
      {children}
    </button>
  )
}

// ── Hook ─────────────────────────────────────────────────────────────────────

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onOutside()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [ref, onOutside])
}

// ── Icons ────────────────────────────────────────────────────────────────────

const sIcon = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" {...sIcon} strokeWidth={2.2} aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
function SearchIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" {...sIcon} style={{ color: 'var(--lead-muted)' }} aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}
function SortIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...sIcon} aria-hidden>
      <path d="M3 6h18M7 12h10M10 18h4" />
    </svg>
  )
}
function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...sIcon} aria-hidden>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  )
}
function GridIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" {...sIcon} aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}
function DotsIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  )
}
function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...sIcon} style={{ color: 'var(--lead-accent)' }} aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}
function Spinner() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" {...sIcon} className="animate-spin" aria-hidden>
      <path d="M21 12a9 9 0 1 1-6.2-8.5" />
    </svg>
  )
}
