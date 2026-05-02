'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { CampaignListItem } from '../_lib/queries'
import { toggleCampaignEnabled } from '../actions/campaign'

type StatusFilter = 'all' | 'active' | 'paused' | 'draft' | 'archived'

export function CampaignsList({ campaigns }: { campaigns: CampaignListItem[] }) {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')

  const counts = useMemo(
    () => ({
      all: campaigns.length,
      active: campaigns.filter((c) => c.status === 'active').length,
      paused: campaigns.filter((c) => c.status === 'paused').length,
      draft: campaigns.filter((c) => c.status === 'draft').length,
      archived: campaigns.filter((c) => c.status === 'archived').length,
    }),
    [campaigns],
  )

  const enabledCount = useMemo(
    () => campaigns.filter((c) => c.enabled).length,
    [campaigns],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return campaigns.filter((c) => {
      if (filter !== 'all' && c.status !== filter) return false
      if (!q) return true
      return c.name.toLowerCase().includes(q)
    })
  }, [campaigns, filter, query])

  return (
    <div data-funnels-root>
      <div className="fn-wrap">
        <header className="fn-head">
          <div className="fn-head-copy">
            <div className="fn-eyebrow">
              <WorkflowIcon />
              <span>Workspace · Funnels</span>
            </div>
            <h1>Campaigns</h1>
            <p>
              Group funnels into campaigns. Each campaign owns a personality, a
              goal, and an enable/disable switch — so you can A/B test entire
              flows or pause one without touching the others.
            </p>
          </div>
          <div className="fn-actions">
            <Link href="/dashboard/funnels/new" className="fn-btn fn-btn-primary">
              <PlusIcon /> New campaign
            </Link>
          </div>
        </header>

        <section className="fn-metrics" aria-label="Campaign metrics">
          <Metric label="Total" value={String(counts.all)} detail="All campaigns" />
          <Metric label="Enabled" value={String(enabledCount)} detail="Currently in rotation" />
          <Metric label="Active" value={String(counts.active)} detail="Status: active" />
          <Metric label="Drafts" value={String(counts.draft)} detail="Not yet launched" />
        </section>

        <div className="fnl-toolbar">
          <div className="fnl-tabs" role="tablist">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'active', label: 'Active' },
                { id: 'paused', label: 'Paused' },
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
                className={`fnl-tab${filter === t.id ? ' active' : ''}`}
              >
                {t.label}
                <span className="fnl-tab-count">{counts[t.id]}</span>
              </button>
            ))}
          </div>
          <div className="fnl-search">
            <SearchIcon />
            <input
              placeholder="Search campaigns…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState hasAny={campaigns.length > 0} />
        ) : (
          <div className="fnl-grid">
            {filtered.map((c) => (
              <CampaignCard key={c.id} c={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CampaignCard({ c }: { c: CampaignListItem }) {
  const updated = new Date(c.updated_at)
  return (
    <div className="fnl-card">
      <Link href={`/dashboard/funnels/${c.id}`} className="fnl-card-main">
        <div className="fnl-card-top">
          <span className={`fn-status ${c.status}`}>{c.status}</span>
          <span className="fnl-card-mode">
            {c.assignment_mode === 'random' ? `Random · w${c.weight}` : 'Manual'}
          </span>
        </div>
        <div className="fnl-card-title">{c.name}</div>
        <div className="fnl-card-sub">
          {c.description?.trim() || 'No description.'}
        </div>
        <div className="fnl-card-meta">
          <div>
            <div className="fnl-card-num">{c.funnel_count}</div>
            <div className="fnl-card-lbl">Funnels</div>
          </div>
          <div>
            <div className="fnl-card-num">
              {c.goal_action_page_title ?? '—'}
            </div>
            <div className="fnl-card-lbl">Goal page</div>
          </div>
          <div>
            <div className="fnl-card-num">{relTime(updated)}</div>
            <div className="fnl-card-lbl">Updated</div>
          </div>
        </div>
      </Link>
      <form action={toggleCampaignEnabled} className="fnl-card-toggle">
        <input type="hidden" name="id" value={c.id} />
        <input type="hidden" name="enabled" value={c.enabled ? 'false' : 'true'} />
        <button
          type="submit"
          className={`fnl-toggle${c.enabled ? ' on' : ''}`}
          aria-label={c.enabled ? 'Disable campaign' : 'Enable campaign'}
          title={c.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
        >
          <span className="fnl-toggle-knob" />
          <span className="fnl-toggle-label">{c.enabled ? 'On' : 'Off'}</span>
        </button>
      </form>
    </div>
  )
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="fn-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  )
}

function EmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="fnl-empty">
      <WorkflowIcon size={28} />
      <h3>{hasAny ? 'No campaigns match' : 'No campaigns yet'}</h3>
      <p>
        {hasAny
          ? 'Try another filter or clear your search.'
          : 'Create one to script the conversation flow your chatbot follows from first message to final action page.'}
      </p>
      {!hasAny && (
        <Link href="/dashboard/funnels/new" className="fn-btn fn-btn-primary">
          <PlusIcon /> Create your first
        </Link>
      )}
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

function WorkflowIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h5v5H4z" />
      <path d="M15 4h5v5h-5z" />
      <path d="M15 15h5v5h-5z" />
      <path d="M9 9.5h2.5c1.7 0 3-1.3 3-3V6" />
      <path d="M9 9.5h2.5c1.7 0 3 1.3 3 3V17" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  )
}
