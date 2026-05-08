'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'

export interface PropertySubmissionRow {
  id: string
  outcome: string | null
  data: Record<string, unknown>
  meta: Record<string, unknown> | null
  created_at: string
  lead_id: string | null
  lead_name: string | null
  source_action_page: {
    id: string
    title: string
    kind: string
    slug: string
  } | null
}

interface Props {
  pageId: string
  pageTitle: string
  pageStatus: 'draft' | 'published' | 'archived'
  submissions: PropertySubmissionRow[]
  /** Breadcrumb label and bottom description copy. Defaults to property copy. */
  breadcrumbLabel?: string
  editLabel?: string
  description?: string
  emptyMessage?: string
}

const KIND_META: Record<string, { bg: string; text: string; label: string }> = {
  form: { bg: '#F5F3FF', text: '#6D28D9', label: 'Form' },
  booking: { bg: '#EFF6FF', text: '#1D4ED8', label: 'Booking' },
  qualification: { bg: '#FFFBEB', text: '#B45309', label: 'Qualification' },
}

type FilterKind = 'all' | 'form' | 'booking' | 'qualification'

export default function PropertySubmissionsView({
  pageId,
  pageTitle,
  pageStatus,
  submissions,
  breadcrumbLabel = 'Property submissions',
  editLabel = 'Edit property',
  description = 'Forms, bookings and qualifications collected from this property page.',
  emptyMessage = 'No submissions yet. When visitors complete a linked action page on this listing, their submissions will appear here.',
}: Props) {
  const [filter, setFilter] = useState<FilterKind>('all')
  const [query, setQuery] = useState('')

  const counts = useMemo(() => {
    const c: Record<FilterKind, number> = { all: submissions.length, form: 0, booking: 0, qualification: 0 }
    for (const s of submissions) {
      const k = s.source_action_page?.kind
      if (k === 'form' || k === 'booking' || k === 'qualification') c[k] += 1
    }
    return c
  }, [submissions])

  const filtered = useMemo(() => {
    let list = submissions
    if (filter !== 'all') {
      list = list.filter((s) => s.source_action_page?.kind === filter)
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter((s) => {
        const name = s.lead_name?.toLowerCase() ?? ''
        const title = s.source_action_page?.title.toLowerCase() ?? ''
        const outcome = s.outcome?.toLowerCase() ?? ''
        const fieldText = JSON.stringify(s.data).toLowerCase()
        return (
          name.includes(q) ||
          title.includes(q) ||
          outcome.includes(q) ||
          fieldText.includes(q)
        )
      })
    }
    return list
  }, [submissions, filter, query])

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-16">
      <div className="flex items-center gap-3 pt-1">
        <Link
          href="/dashboard/action-pages"
          className="text-[12px] text-[#6B7280] hover:text-[#111827]"
        >
          ← Action Pages
        </Link>
        <span className="text-[#D1D5DB]">/</span>
        <Link
          href={`/dashboard/action-pages/${pageId}`}
          className="truncate text-[12px] font-medium text-[#374151] hover:text-[#111827]"
        >
          {pageTitle}
        </Link>
        <span className="text-[#D1D5DB]">/</span>
        <span className="text-[12px] text-[#6B7280]">{breadcrumbLabel}</span>
        <div className="flex-1" />
        <Link
          href={`/dashboard/action-pages/${pageId}`}
          className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-[12px] font-medium text-[#374151] hover:bg-[#F9FAFB]"
        >
          {editLabel}
        </Link>
      </div>

      <div className="space-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight text-[#111827]">
          {pageTitle} — submissions
        </h1>
        <p className="text-[13px] text-[#6B7280]">
          {description}
          {pageStatus !== 'published' && (
            <span className="ml-2 rounded-full bg-[#FEF3C7] px-2 py-0.5 text-[11px] font-medium text-[#92400E]">
              {pageStatus}
            </span>
          )}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total" value={counts.all} color="indigo" />
        <StatCard label="Forms" value={counts.form} color="violet" />
        <StatCard label="Bookings" value={counts.booking} color="blue" />
        <StatCard
          label="Qualifications"
          value={counts.qualification}
          color="amber"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(['all', 'form', 'booking', 'qualification'] as FilterKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors ${
              filter === k
                ? 'border-[#111827] bg-[#111827] text-white'
                : 'border-[#E5E7EB] bg-white text-[#374151] hover:bg-[#F9FAFB]'
            }`}
          >
            {k === 'all' ? 'All' : KIND_META[k]?.label ?? k}
            <span className="ml-1.5 text-[11px] opacity-70">{counts[k]}</span>
          </button>
        ))}
        <div className="ml-auto">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-[13px]"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#D1D5DB] bg-white p-12 text-center">
          <p className="text-[13px] text-[#6B7280]">
            {submissions.length === 0
              ? emptyMessage
              : 'No submissions match this filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filtered.map((s) => (
            <SubmissionCard key={s.id} submission={s} />
          ))}
        </div>
      )}
    </div>
  )
}

function SubmissionCard({ submission: s }: { submission: PropertySubmissionRow }) {
  const meta = s.source_action_page
    ? KIND_META[s.source_action_page.kind] ?? {
        bg: '#F3F4F6',
        text: '#6B7280',
        label: s.source_action_page.kind,
      }
    : null

  const summary = summarizeSubmission(s)

  return (
    <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start gap-3">
        {meta && (
          <span
            className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: meta.bg, color: meta.text }}
          >
            {meta.label}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="truncate text-[14px] font-semibold text-[#111827]">
              {s.lead_name ?? 'Anonymous'}
            </h3>
            {s.outcome && (
              <span className="text-[11px] text-[#6B7280]">· {s.outcome}</span>
            )}
          </div>
          {s.source_action_page && (
            <div className="mt-0.5 truncate text-[12px] text-[#6B7280]">
              via{' '}
              <Link
                href={`/dashboard/action-pages/${s.source_action_page.id}`}
                className="font-medium text-[#0EA5E9] hover:underline"
              >
                {s.source_action_page.title}
              </Link>
            </div>
          )}
          {typeof s.meta?.source_property_unit_title === 'string' &&
            s.meta.source_property_unit_title && (
              <div className="mt-1">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-100">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  {String(s.meta.source_property_unit_title)}
                </span>
              </div>
            )}
        </div>
        <div className="text-right">
          <div className="text-[11px] text-[#9CA3AF]">
            {relTime(new Date(s.created_at))}
          </div>
          {s.lead_id && (
            <Link
              href={`/dashboard/leads?lead=${s.lead_id}`}
              className="text-[11px] text-[#0EA5E9] hover:underline"
            >
              View lead →
            </Link>
          )}
        </div>
      </div>

      {summary.length > 0 && (
        <dl className="mt-3 grid grid-cols-1 gap-1.5 border-t border-[#F3F4F6] pt-3 sm:grid-cols-2">
          {summary.map((row) => (
            <div key={row.label} className="flex items-baseline gap-2">
              <dt className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-[#9CA3AF]">
                {row.label}
              </dt>
              <dd className="truncate text-[12.5px] text-[#374151]">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

function summarizeSubmission(
  s: PropertySubmissionRow,
): Array<{ label: string; value: string }> {
  const data = s.data ?? {}
  const out: Array<{ label: string; value: string }> = []
  const kind = s.source_action_page?.kind

  if (kind === 'booking') {
    if (typeof data.slot_iso === 'string') {
      const d = new Date(data.slot_iso)
      if (!Number.isNaN(d.getTime())) {
        out.push({ label: 'Slot', value: d.toLocaleString() })
      }
    }
  }
  if (kind === 'qualification') {
    if (typeof data.score === 'number') {
      out.push({ label: 'Score', value: String(data.score) })
    }
  }

  const fields =
    data.fields && typeof data.fields === 'object'
      ? (data.fields as Record<string, unknown>)
      : null
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      out.push({ label: humanize(k), value: formatVal(v) })
      if (out.length >= 6) break
    }
  } else {
    for (const [k, v] of Object.entries(data)) {
      if (k === 'slot_iso' || k === 'fields' || k === 'answers' || k === 'score') continue
      out.push({ label: humanize(k), value: formatVal(v) })
      if (out.length >= 6) break
    }
  }
  return out
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.map(formatVal).join(', ')
  return JSON.stringify(v)
}

function humanize(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
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
  return d.toLocaleDateString()
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: 'blue' | 'indigo' | 'violet' | 'amber'
}) {
  const map = {
    blue: { bg: '#EFF6FF', num: '#2563EB', text: '#1D4ED8' },
    indigo: { bg: '#EEF2FF', num: '#4F46E5', text: '#4338CA' },
    violet: { bg: '#F5F3FF', num: '#7C3AED', text: '#6D28D9' },
    amber: { bg: '#FFFBEB', num: '#D97706', text: '#B45309' },
  }
  const c = map[color]
  return (
    <div className="rounded-xl px-4 py-3" style={{ background: c.bg }}>
      <div
        className="text-[26px] font-bold leading-none tabular-nums"
        style={{ color: c.num }}
      >
        {value}
      </div>
      <div className="mt-1 text-[12px] font-medium" style={{ color: c.text }}>
        {label}
      </div>
    </div>
  )
}
