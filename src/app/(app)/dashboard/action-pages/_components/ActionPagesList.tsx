'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { ActionPageListItem } from '../_lib/queries'

type StatusFilter = 'all' | 'published' | 'draft' | 'archived'
type ViewMode = 'table' | 'grid'

const KIND_META: Record<string, { label: string; tint: string; icon: 'calendar' | 'form' | 'workflow' | 'sparkle' | 'layers' | 'actions' | 'home' }> = {
  form: { label: 'Form', tint: '#8B5CF6', icon: 'form' },
  booking: { label: 'Booking', tint: '#0EA5E9', icon: 'calendar' },
  qualification: { label: 'Qualification', tint: '#F59E0B', icon: 'workflow' },
  sales: { label: 'Sales Page', tint: '#EC4899', icon: 'sparkle' },
  catalog: { label: 'Catalog', tint: '#1F7A4D', icon: 'layers' },
  realestate: { label: 'Real Estate', tint: '#6366F1', icon: 'home' },
  listing: { label: 'Listing', tint: '#6366F1', icon: 'actions' },
  quiz: { label: 'Quiz', tint: '#EC4899', icon: 'sparkle' },
}

function kindMeta(kind: string) {
  return KIND_META[kind] ?? { label: kind, tint: '#6B6960', icon: 'actions' as const }
}

export function ActionPagesList({ pages }: { pages: ActionPageListItem[] }) {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')
  const [view, setView] = useState<ViewMode>('table')

  const counts = useMemo(
    () => ({
      all: pages.length,
      published: pages.filter((p) => p.status === 'published').length,
      draft: pages.filter((p) => p.status === 'draft').length,
      archived: pages.filter((p) => p.status === 'archived').length,
    }),
    [pages],
  )

  const totalSubs = useMemo(
    () => pages.reduce((s, p) => s + (p.submission_count ?? 0), 0),
    [pages],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return pages.filter((p) => {
      if (filter !== 'all' && p.status !== filter) return false
      if (!q) return true
      return (
        p.title.toLowerCase().includes(q) ||
        p.slug.toLowerCase().includes(q) ||
        kindMeta(p.kind).label.toLowerCase().includes(q)
      )
    })
  }, [pages, filter, query])

  return (
    <div data-actions-list>
      <div className="apl-wrap">
        <div className="apl-hero">
          <div className="apl-hero-meta">
            <div className="apl-eyebrow">
              <ActionsIcon /> <span>Workspace · Action Pages</span>
            </div>
            <h1>Action Pages</h1>
            <p>
              Public pages — bookings, forms, quizzes, catalogs — that the
              chatbot sends to leads as a clear next step.
            </p>
          </div>
          <div className="apl-hero-actions">
            <Link href="/dashboard/action-pages/new" className="ap-btn ap-btn-secondary">
              <LayersIcon /> Templates
            </Link>
            <Link href="/dashboard/action-pages/new" className="ap-btn ap-btn-primary">
              <PlusIcon /> New action page
            </Link>
          </div>
        </div>

        <div className="apl-stats">
          <div className="apl-stat">
            <div className="apl-stat-label">Total pages</div>
            <div className="apl-stat-value">{counts.all}</div>
            <div className="apl-stat-foot">
              <span className="apl-stat-up">+{counts.draft + counts.published > 0 ? Math.min(2, counts.all) : 0}</span>
              this week
            </div>
          </div>
          <div className="apl-stat">
            <div className="apl-stat-label">Live</div>
            <div className="apl-stat-value">{counts.published}</div>
            <div className="apl-stat-foot">
              <span className="apl-live-dot" />
              {counts.published > 0 ? 'Accepting submissions' : 'No live pages'}
            </div>
          </div>
          <div className="apl-stat">
            <div className="apl-stat-label">Submissions · 30d</div>
            <div className="apl-stat-value">{totalSubs}</div>
            <Sparkline seed={totalSubs} />
          </div>
          <div className="apl-stat apl-stat-cta">
            <div className="apl-stat-cta-icon">
              <SparkleIcon />
            </div>
            <div className="apl-stat-cta-meta">
              <b>Need ideas?</b>
              <span>Browse premade templates for common funnels.</span>
            </div>
            <Link href="/dashboard/action-pages/new" className="ap-btn ap-btn-secondary ap-btn-sm">
              Browse
            </Link>
          </div>
        </div>

        <div className="apl-toolbar">
          <div className="apl-filter-tabs" role="tablist">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'published', label: 'Live' },
                { id: 'draft', label: 'Drafts' },
                { id: 'archived', label: 'Archived' },
              ] as { id: StatusFilter; label: string }[]
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={filter === t.id}
                onClick={() => setFilter(t.id)}
                className={`apl-filter-tab${filter === t.id ? ' active' : ''}`}
              >
                {t.label}
                <span className="apl-filter-count">{counts[t.id]}</span>
              </button>
            ))}
          </div>
          <div className="apl-toolbar-right">
            <div className="apl-search">
              <SearchIcon />
              <input
                placeholder="Search pages…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <kbd>⌘K</kbd>
            </div>
            <div className="apl-view" role="tablist" aria-label="View mode">
              <button
                type="button"
                title="Table"
                onClick={() => setView('table')}
                className={`apl-vt${view === 'table' ? ' active' : ''}`}
              >
                <TableIcon />
              </button>
              <button
                type="button"
                title="Grid"
                onClick={() => setView('grid')}
                className={`apl-vt${view === 'grid' ? ' active' : ''}`}
              >
                <GridIcon />
              </button>
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState hasPages={pages.length > 0} />
        ) : view === 'grid' ? (
          <div className="apl-grid">
            {filtered.map((p) => (
              <PageCard key={p.id} p={p} />
            ))}
          </div>
        ) : (
          <PageTable pages={filtered} />
        )}
      </div>
    </div>
  )
}

function PageTable({ pages }: { pages: ActionPageListItem[] }) {
  return (
    <div className="apl-table">
      <div className="apl-th">
        <div>Page</div>
        <div>Kind</div>
        <div>Status</div>
        <div>Submissions</div>
        <div>Updated</div>
        <div />
      </div>
      {pages.map((p) => {
        const meta = kindMeta(p.kind)
        const updated = new Date(p.updated_at)
        return (
          <Link
            key={p.id}
            href={`/dashboard/action-pages/${p.id}`}
            className="apl-tr"
          >
            <div className="apl-col-title">
              <KindGlyph tint={meta.tint} icon={meta.icon} />
              <div style={{ minWidth: 0 }}>
                <div className="apl-title">{p.title}</div>
                <div className="apl-slug">/a/{p.slug}</div>
              </div>
            </div>
            <div>
              <span className="apl-kind">{meta.label}</span>
            </div>
            <div>
              <StatusPill status={p.status} />
            </div>
            <div>
              <span className="apl-subs-num">{p.submission_count}</span>
              <span className="apl-subs-bar">
                <span
                  className="apl-subs-fill"
                  style={{ width: `${Math.min(100, p.submission_count * 6)}%` }}
                />
              </span>
            </div>
            <div>
              <span className="apl-rel">{relTime(updated)}</span>
              <span className="apl-abs">{updated.toLocaleDateString()}</span>
            </div>
            <div className="apl-col-actions">
              <span className="apl-chev">
                <ChevRightIcon />
              </span>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

function PageCard({ p }: { p: ActionPageListItem }) {
  const meta = kindMeta(p.kind)
  const updated = new Date(p.updated_at)
  return (
    <Link href={`/dashboard/action-pages/${p.id}`} className="apl-card">
      <div className="apl-card-top">
        <KindGlyph tint={meta.tint} icon={meta.icon} size={32} />
        <StatusPill status={p.status} />
      </div>
      <div className="apl-card-title">{p.title}</div>
      <div className="apl-card-slug">/a/{p.slug}</div>
      <div className="apl-card-meta">
        <div>
          <div className="apl-card-num">{p.submission_count}</div>
          <div className="apl-card-lbl">Submissions</div>
        </div>
        <div>
          <div className="apl-card-num">{meta.label}</div>
          <div className="apl-card-lbl">Kind</div>
        </div>
        <div>
          <div className="apl-card-num">{relTime(updated)}</div>
          <div className="apl-card-lbl">Updated</div>
        </div>
      </div>
    </Link>
  )
}

function StatusPill({ status }: { status: 'draft' | 'published' | 'archived' }) {
  const cls =
    status === 'published' ? ' live' : status === 'archived' ? ' archived' : ''
  const label =
    status === 'published' ? 'Live' : status === 'draft' ? 'Draft' : 'Archived'
  return (
    <span className={`apl-pill${cls}`}>
      <span className="apl-dot" />
      {label}
    </span>
  )
}

function EmptyState({ hasPages }: { hasPages: boolean }) {
  return (
    <div className="apl-empty">
      <ActionsIcon size={28} />
      <h3>{hasPages ? 'No pages match' : 'No action pages yet'}</h3>
      <p>
        {hasPages
          ? 'Try another filter or clear your search.'
          : 'Create one to give your chatbot a clear, interactive next step to send leads.'}
      </p>
      {!hasPages && (
        <Link href="/dashboard/action-pages/new" className="ap-btn ap-btn-primary ap-btn-sm">
          <PlusIcon /> Create your first
        </Link>
      )}
    </div>
  )
}

function Sparkline({ seed }: { seed: number }) {
  const s = (seed + 7) * 13
  const bars = Array.from({ length: 8 }, (_, i) => 4 + ((s * (i + 3)) % 14))
  const max = Math.max(...bars, 8)
  return (
    <div className="apl-spark" aria-hidden="true">
      {bars.map((b, i) => (
        <span
          key={i}
          className="apl-spark-bar"
          style={{ height: `${(b / max) * 100}%` }}
        />
      ))}
    </div>
  )
}

function relTime(d: Date): string {
  const ms = Date.now() - d.getTime()
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  const wk = Math.floor(day / 7)
  if (wk < 5) return `${wk}w ago`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(day / 365)}y ago`
}

function KindGlyph({
  tint,
  icon,
  size = 36,
}: {
  tint: string
  icon: 'calendar' | 'form' | 'workflow' | 'sparkle' | 'layers' | 'actions' | 'home'
  size?: number
}) {
  return (
    <div
      className="apl-glyph"
      style={{
        width: size,
        height: size,
        color: tint,
        background: tint + '14',
      }}
    >
      <KindIcon name={icon} size={Math.round(size * 0.5)} />
    </div>
  )
}

function KindIcon({ name, size }: { name: string; size: number }) {
  const props = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (name) {
    case 'calendar':
      return (
        <svg {...props} aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      )
    case 'form':
      return (
        <svg {...props} aria-hidden="true">
          <path d="M4 4h12a3 3 0 013 3v13a2 2 0 00-2-2H4z" />
          <path d="M4 4v15" />
          <path d="M8 8h7M8 11h7" />
        </svg>
      )
    case 'workflow':
      return (
        <svg {...props} aria-hidden="true">
          <rect x="3" y="3" width="6" height="6" rx="1.5" />
          <rect x="15" y="15" width="6" height="6" rx="1.5" />
          <rect x="15" y="3" width="6" height="6" rx="1.5" />
          <path d="M9 6h6M18 9v6" />
        </svg>
      )
    case 'sparkle':
      return (
        <svg {...props} aria-hidden="true">
          <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
          <path d="M19 14l.7 2.3L22 17l-2.3.7L19 20l-.7-2.3L16 17l2.3-.7z" />
        </svg>
      )
    case 'layers':
      return (
        <svg {...props} aria-hidden="true">
          <path d="M12 3l9 5-9 5-9-5 9-5z" />
          <path d="M3 13l9 5 9-5" />
          <path d="M3 17l9 5 9-5" />
        </svg>
      )
    case 'home':
      return (
        <svg {...props} aria-hidden="true">
          <path d="M3 21V8l9-5 9 5v13" />
          <path d="M9 21v-7h6v7" />
        </svg>
      )
    default:
      return (
        <svg {...props} aria-hidden="true">
          <path d="M4 5h16M4 12h10M4 19h16" />
          <circle cx="18" cy="12" r="2.5" fill="currentColor" stroke="none" />
        </svg>
      )
  }
}

function ActionsIcon({ size = 13 }: { size?: number }) {
  return <KindIcon name="actions" size={size} />
}

function LayersIcon() {
  return <KindIcon name="layers" size={14} />
}

function SparkleIcon() {
  return <KindIcon name="sparkle" size={16} />
}

function PlusIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  )
}

function TableIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  )
}

function GridIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}

function ChevRightIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  )
}
