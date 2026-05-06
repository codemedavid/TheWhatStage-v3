'use client'

import { useState, useTransition, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { WorkflowListItem } from '@/lib/workflow/queries'
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from '@/lib/workflow/templates'

type StatusFilter = 'all' | 'active' | 'draft' | 'paused' | 'archived'

const TRIGGER_LABELS: Record<string, string> = {
  stage_entered: 'Stage entered',
  stage_idle: 'Stage idle',
  submission_received: 'Submission received',
  booking_offset: 'Booking offset',
  cart_abandoned: 'Cart abandoned',
}

const STATUS_COLORS: Record<string, string> = {
  active: 'wfl-pill-active',
  draft: 'wfl-pill-draft',
  paused: 'wfl-pill-paused',
  archived: 'wfl-pill-archived',
}

function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

export function WorkflowsList({ workflows }: { workflows: WorkflowListItem[] }) {
  const router = useRouter()
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')
  const [creating, startCreate] = useTransition()

  const counts = useMemo(
    () => ({
      all: workflows.length,
      active: workflows.filter((w) => w.status === 'active').length,
      draft: workflows.filter((w) => w.status === 'draft').length,
      paused: workflows.filter((w) => w.status === 'paused').length,
      archived: workflows.filter((w) => w.status === 'archived').length,
    }),
    [workflows],
  )

  const totalRunsWeek = useMemo(
    () => workflows.reduce((s, w) => s + w.run_count_7d, 0),
    [workflows],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return workflows.filter((w) => {
      if (filter !== 'all' && w.status !== filter) return false
      if (!q) return true
      return (
        w.name.toLowerCase().includes(q) ||
        TRIGGER_LABELS[w.trigger?.kind ?? '']?.toLowerCase().includes(q)
      )
    })
  }, [workflows, filter, query])

  async function handleCreate() {
    startCreate(async () => {
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Untitled workflow' }),
      })
      if (res.ok) {
        const { workflow } = (await res.json()) as { workflow: { id: string } }
        router.push(`/dashboard/workflows/${workflow.id}`)
      }
    })
  }

  async function handleCreateFromTemplate(tpl: WorkflowTemplate) {
    startCreate(async () => {
      const built = tpl.build()
      const res = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: built.name,
          triggers: built.triggers,
          graph: built.graph,
        }),
      })
      if (res.ok) {
        const { workflow } = (await res.json()) as { workflow: { id: string } }
        router.push(`/dashboard/workflows/${workflow.id}`)
      }
    })
  }

  return (
    <div data-workflows-list>
      <div className="wfl-wrap">
        <div className="wfl-hero">
          <div className="wfl-hero-meta">
            <div className="wfl-eyebrow">
              <WorkflowIcon /> <span>Workspace · Workflows</span>
            </div>
            <h1>Workflows</h1>
            <p>
              Automated sequences triggered by stage events, submissions, and bookings.
              Build visual flows that send messages, move leads, and branch on conditions.
            </p>
          </div>
          <div className="wfl-hero-actions">
            <button
              type="button"
              className="wfl-btn wfl-btn-primary"
              onClick={handleCreate}
              disabled={creating}
            >
              <PlusIcon />
              {creating ? 'Creating…' : 'New workflow'}
            </button>
          </div>
        </div>

        <div className="wfl-stats">
          <div className="wfl-stat">
            <div className="wfl-stat-label">Total</div>
            <div className="wfl-stat-value">{counts.all}</div>
          </div>
          <div className="wfl-stat">
            <div className="wfl-stat-label">Active</div>
            <div className="wfl-stat-value">{counts.active}</div>
            <div className="wfl-stat-foot">
              <span className="wfl-live-dot" /> {counts.active > 0 ? 'Running automations' : 'None live'}
            </div>
          </div>
          <div className="wfl-stat">
            <div className="wfl-stat-label">Runs · 7d</div>
            <div className="wfl-stat-value">{totalRunsWeek}</div>
          </div>
        </div>

        <div className="wfl-toolbar">
          <div className="wfl-filter-tabs" role="tablist">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'active', label: 'Active' },
                { id: 'draft', label: 'Drafts' },
                { id: 'paused', label: 'Paused' },
                { id: 'archived', label: 'Archived' },
              ] as { id: StatusFilter; label: string }[]
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={filter === t.id}
                onClick={() => setFilter(t.id)}
                className={`wfl-filter-tab${filter === t.id ? ' active' : ''}`}
              >
                {t.label}
                <span className="wfl-filter-count">{counts[t.id]}</span>
              </button>
            ))}
          </div>
          <div className="wfl-search">
            <SearchIcon />
            <input
              placeholder="Search workflows…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="wfl-templates">
          <div className="wfl-templates-hdr">
            <span>Start from a template</span>
            <small>Pre-built scenarios — pick one, then fill in stages and timing.</small>
          </div>
          <div className="wfl-templates-grid">
            {WORKFLOW_TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                className="wfl-template-card"
                onClick={() => handleCreateFromTemplate(tpl)}
                disabled={creating}
              >
                <span className="wfl-template-trigger">{TRIGGER_LABELS[tpl.trigger_kind] ?? tpl.trigger_kind}</span>
                <span className="wfl-template-name">{tpl.name}</span>
                <span className="wfl-template-blurb">{tpl.blurb}</span>
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <EmptyState hasWorkflows={workflows.length > 0} onNew={handleCreate} creating={creating} />
        ) : (
          <div className="wfl-table">
            <div className="wfl-th">
              <div>Workflow</div>
              <div>Trigger</div>
              <div>Status</div>
              <div>Runs · 7d</div>
              <div>Last run</div>
              <div />
            </div>
            {filtered.map((w) => (
              <WorkflowRow key={w.id} workflow={w} onOpen={() => router.push(`/dashboard/workflows/${w.id}`)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function WorkflowRow({ workflow: w, onOpen }: { workflow: WorkflowListItem; onOpen: () => void }) {
  const successRate = w.run_count_7d > 0 ? Math.round((w.success_count_7d / w.run_count_7d) * 100) : null

  return (
    <button type="button" className="wfl-tr" onClick={onOpen}>
      <div className="wfl-col-name">
        <div className="wfl-name">{w.name}</div>
        <div className="wfl-version">v{w.version}</div>
      </div>
      <div>
        <span className="wfl-trigger-badge">{TRIGGER_LABELS[w.trigger?.kind] ?? w.trigger?.kind}</span>
      </div>
      <div>
        <span className={`wfl-pill ${STATUS_COLORS[w.status] ?? ''}`}>{w.status}</span>
      </div>
      <div className="wfl-col-runs">
        <span className="wfl-run-count">{w.run_count_7d}</span>
        {successRate !== null && (
          <span className={`wfl-success-rate ${w.failed_count_7d > 0 ? 'has-failed' : ''}`}>
            {successRate}% ok
          </span>
        )}
      </div>
      <div className="wfl-last-run">{relativeTime(w.last_run_at)}</div>
      <div>
        <ChevronIcon />
      </div>
    </button>
  )
}

function EmptyState({ hasWorkflows, onNew, creating }: { hasWorkflows: boolean; onNew: () => void; creating: boolean }) {
  return (
    <div className="wfl-empty">
      <div className="wfl-empty-icon">
        <WorkflowIcon />
      </div>
      <div className="wfl-empty-title">
        {hasWorkflows ? 'No workflows match your search' : 'No workflows yet'}
      </div>
      <div className="wfl-empty-body">
        {hasWorkflows
          ? 'Try adjusting the filter or search term.'
          : 'Create your first automation — triggered by stage changes, submissions, or booking offsets.'}
      </div>
      {!hasWorkflows && (
        <button type="button" className="wfl-btn wfl-btn-primary" onClick={onNew} disabled={creating}>
          <PlusIcon /> {creating ? 'Creating…' : 'New workflow'}
        </button>
      )}
    </div>
  )
}

function WorkflowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="5" height="5" rx="1" />
      <rect x="16" y="3" width="5" height="5" rx="1" />
      <rect x="16" y="16" width="5" height="5" rx="1" />
      <path d="M8 5.5h3.5a4 4 0 014 4V16" />
      <path d="M8 5.5h3.5a4 4 0 004-4V3" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}
