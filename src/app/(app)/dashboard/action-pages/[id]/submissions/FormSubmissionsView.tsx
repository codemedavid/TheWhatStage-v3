'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import type {
  SubmissionListItem,
  SubmissionProjectInfo,
} from '../../_lib/queries'
import { CreateProjectButton } from './_components/CreateProjectButton.client'
import {
  type DateRange,
  type SubmissionKind,
  computeRangeMetrics,
  computeStats,
  displayName,
  extractAnswers,
  extractFormFields,
  filterByDateRange,
  filterSubmissions,
  formatOutcomeLabel,
  formatPercent,
  getFilters,
  getScore,
  impliedQuote,
  isImpliedSubmission,
  resolveDateRange,
  submissionSource,
} from './form-submissions.helpers'

export interface FormSubmissionRow extends SubmissionListItem {
  project: SubmissionProjectInfo | null
}

interface Props {
  pageId: string
  pageTitle: string
  pageStatus: 'draft' | 'published' | 'archived'
  kind: SubmissionKind
  submissions: FormSubmissionRow[]
  /** Recent-first lead created_at timestamps, windowed for the conversion ratio. */
  leadTimestamps: string[]
  /** Exact lead total, used as the all-time conversion denominator. */
  leadTotal: number
}

type TileVariant = 'default' | 'success' | 'warning' | 'accent'
interface Tile {
  label: string
  value: number | string
  variant: TileVariant
}

const DATE_RANGES: { key: DateRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'all', label: 'All time' },
]

const PALETTE = {
  bg: '#FBF8F1',
  paper: '#FFFFFF',
  ink: '#1F1E1D',
  ink2: '#3A3835',
  ink3: '#6B6862',
  ink4: '#A39E92',
  line: '#E8E2D2',
  lineSoft: '#F0EBDC',
  accent: '#C96442',
  accentSoft: 'rgba(201,100,66,0.10)',
  accentInk: '#7A3A22',
  success: '#1F7A4D',
  successSoft: 'rgba(31,122,77,0.10)',
  warning: '#B45309',
  warningSoft: 'rgba(180,83,9,0.12)',
  fbBlue: '#1877F2',
}

const KIND_COPY: Record<SubmissionKind, { word: string; blurb: string }> = {
  form: {
    word: 'submissions',
    blurb:
      'Everyone who completed this form — who they are, what they filled in, and where the conversation can go next.',
  },
  qualification: {
    word: 'responses',
    blurb:
      'Everyone who finished the quiz — their qualification result, score, and the answers they gave.',
  },
}

export default function FormSubmissionsView({
  pageId,
  pageTitle,
  pageStatus,
  kind,
  submissions,
  leadTimestamps,
  leadTotal,
}: Props) {
  const [range, setRange] = useState<DateRange>('all')
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const bounds = useMemo(() => resolveDateRange(range), [range])
  const dateScoped = useMemo(
    () => filterByDateRange(submissions, bounds),
    [submissions, bounds],
  )
  const metrics = useMemo(
    () => computeRangeMetrics(submissions, leadTimestamps, bounds, leadTotal),
    [submissions, leadTimestamps, bounds, leadTotal],
  )
  const tiles = useMemo<Tile[]>(() => {
    const conversionTile: Tile = {
      label: 'Lead → submission',
      value: formatPercent(metrics.conversionRate),
      variant: 'accent',
    }
    // Qualification funnels live or die on their outcome mix, so keep the
    // (range-scoped) outcome tiles and trade the redundant "This week" count
    // for the conversion ratio.
    if (kind === 'qualification') {
      const outcomeTiles: Tile[] = computeStats(kind, dateScoped)
        .filter((t) => t.label !== 'This week')
        .slice(0, 3)
        .map((t) => ({ label: t.label, value: t.value, variant: t.variant }))
      return [
        { label: 'Submissions', value: metrics.submissions, variant: 'default' },
        ...outcomeTiles.slice(0, 2),
        conversionTile,
      ]
    }
    return [
      { label: 'Submissions', value: metrics.submissions, variant: 'default' },
      { label: 'Leads', value: metrics.leads, variant: 'default' },
      conversionTile,
      { label: 'All-time total', value: submissions.length, variant: 'default' },
    ]
  }, [kind, metrics, dateScoped, submissions.length])
  const filters = useMemo(() => getFilters(kind, dateScoped), [kind, dateScoped])
  const filtered = useMemo(
    () => filterSubmissions(dateScoped, kind, filter, query),
    [dateScoped, kind, filter, query],
  )
  const openRow = useMemo(
    () => submissions.find((s) => s.id === openId) ?? null,
    [submissions, openId],
  )
  const copy = KIND_COPY[kind]

  return (
    <div className="min-h-screen" style={{ background: PALETTE.bg, color: PALETTE.ink }}>
      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Breadcrumb */}
        <div
          className="mb-4 flex items-center gap-2 text-[11px] uppercase tracking-[0.04em]"
          style={{ color: PALETTE.ink3, fontFamily: 'ui-monospace, monospace' }}
        >
          <Link href="/dashboard/action-pages" className="hover:underline" style={{ color: PALETTE.ink3 }}>
            Action Pages
          </Link>
          <span style={{ color: PALETTE.ink4 }}>/</span>
          <Link
            href={`/dashboard/action-pages/${pageId}`}
            className="truncate hover:underline"
            style={{ color: PALETTE.ink3 }}
          >
            {pageTitle}
          </Link>
          <span style={{ color: PALETTE.ink4 }}>/</span>
          <span style={{ color: PALETTE.ink }}>Submissions</span>
        </div>

        {/* Title row */}
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1
              className="mb-2 text-[38px] font-normal leading-[1.05] tracking-[-0.018em]"
              style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
            >
              {pageTitle}{' '}
              <em style={{ color: PALETTE.accent, fontStyle: 'italic' }}>{copy.word}</em>
            </h1>
            <p className="m-0 max-w-[580px] text-[14.5px] leading-[1.5]" style={{ color: PALETTE.ink3 }}>
              {copy.blurb}
              {pageStatus !== 'published' && (
                <span
                  className="ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{ background: PALETTE.warningSoft, color: PALETTE.warning }}
                >
                  {pageStatus}
                </span>
              )}
            </p>
          </div>
          <Link
            href={`/dashboard/action-pages/${pageId}`}
            className="shrink-0 rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors"
            style={{ borderColor: PALETTE.line, background: PALETTE.paper, color: PALETTE.ink2 }}
          >
            Edit page
          </Link>
        </div>

        {/* Date-range selector */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div
            className="inline-flex flex-wrap rounded-full border p-[3px]"
            style={{ background: PALETTE.paper, borderColor: PALETTE.line }}
          >
            {DATE_RANGES.map((r) => {
              const on = range === r.key
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => setRange(r.key)}
                  className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] transition-colors"
                  style={{
                    background: on ? PALETTE.accent : 'transparent',
                    color: on ? PALETTE.paper : PALETTE.ink3,
                  }}
                >
                  {r.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Stat tiles */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((s) => (
            <StatTile key={s.label} label={s.label} value={s.value} variant={s.variant} />
          ))}
        </div>

        {/* Filter row */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div
            className="inline-flex flex-wrap rounded-full border p-[3px]"
            style={{ background: PALETTE.paper, borderColor: PALETTE.line }}
          >
            {filters.map((f) => {
              const on = filter === f.key
              return (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] transition-colors"
                  style={{
                    background: on ? PALETTE.ink : 'transparent',
                    color: on ? PALETTE.paper : PALETTE.ink3,
                  }}
                >
                  {f.label}
                  <span
                    className="rounded-full px-1.5 py-px text-[11px]"
                    style={{
                      background: on ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.06)',
                      fontFamily: 'ui-monospace, monospace',
                    }}
                  >
                    {f.count}
                  </span>
                </button>
              )
            })}
          </div>

          <div className="relative inline-flex items-center">
            <svg
              className="pointer-events-none absolute left-3"
              width={14}
              height={14}
              viewBox="0 0 24 24"
              fill="none"
              stroke={PALETTE.ink4}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name or any field…"
              className="rounded-full border py-2 pl-9 pr-4 text-[13px] outline-none"
              style={{ width: 280, background: PALETTE.paper, borderColor: PALETTE.line, color: PALETTE.ink }}
            />
          </div>
        </div>

        {/* List */}
        {filtered.length === 0 ? (
          <div
            className="rounded-xl border border-dashed p-12 text-center"
            style={{ borderColor: PALETTE.line, background: PALETTE.paper }}
          >
            <p className="text-[13.5px]" style={{ color: PALETTE.ink3 }}>
              {submissions.length === 0
                ? `No ${copy.word} yet. They will appear here as leads complete this page.`
                : `No ${copy.word} match this filter.`}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((s) => (
              <SubmissionCard key={s.id} row={s} kind={kind} onOpen={() => setOpenId(s.id)} />
            ))}
          </div>
        )}
      </div>

      {openRow && (
        <SubmissionDrawer row={openRow} kind={kind} onClose={() => setOpenId(null)} />
      )}
    </div>
  )
}

/* ============================================================ */
/*  Stat tile                                                    */
/* ============================================================ */

function StatTile({
  label,
  value,
  variant,
}: {
  label: string
  value: number | string
  variant: 'default' | 'success' | 'warning' | 'accent'
}) {
  const color =
    variant === 'success'
      ? PALETTE.success
      : variant === 'warning'
        ? PALETTE.warning
        : variant === 'accent'
          ? PALETTE.accent
          : PALETTE.ink

  return (
    <div className="overflow-hidden rounded-2xl border p-5" style={{ background: PALETTE.paper, borderColor: PALETTE.line }}>
      <span
        className="text-[36px] leading-none tracking-[-0.015em]"
        style={{ color, fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: 'italic' }}
      >
        {value}
      </span>
      <div
        className="mt-2 text-[10.5px] uppercase tracking-[0.12em]"
        style={{ color: PALETTE.ink3, fontFamily: 'ui-monospace, monospace' }}
      >
        {label}
      </div>
    </div>
  )
}

/* ============================================================ */
/*  Submission card                                             */
/* ============================================================ */

function SubmissionCard({
  row,
  kind,
  onOpen,
}: {
  row: FormSubmissionRow
  kind: SubmissionKind
  onOpen: () => void
}) {
  const name = displayName(row)
  const source = submissionSource(row)
  const fields = extractFormFields(row.data)
  const score = getScore(row.data)
  const preview = fields.slice(0, 3)
  const implied = isImpliedSubmission(row)
  const quote = implied ? impliedQuote(row.data) : null

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onOpen()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      className="group grid w-full grid-cols-[auto_1fr_auto] items-center gap-4 rounded-2xl border p-4 text-left transition-all"
      style={{ background: PALETTE.paper, borderColor: PALETTE.line, cursor: 'pointer' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = PALETTE.ink4
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = PALETTE.line
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <InitialAvatar name={name} source={source} size={44} />

      <div className="min-w-0">
        <div className="mb-1.5 flex flex-wrap items-center gap-2">
          <span className="truncate text-[15px] font-medium" style={{ color: PALETTE.ink, maxWidth: 240 }}>
            {name}
          </span>
          <SourcePill source={source} />
          {implied && <ImpliedPill />}
          {kind === 'qualification' && row.outcome && !implied && <OutcomePill outcome={row.outcome} />}
        </div>
        {implied ? (
          <span className="line-clamp-1 text-[12.5px] italic" style={{ color: PALETTE.ink3 }}>
            {quote ? `“${quote}”` : 'Signaled intent to proceed in chat — review and convert.'}
          </span>
        ) : preview.length > 0 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]" style={{ color: PALETTE.ink3 }}>
            {preview.map((f) => (
              <span key={f.key} className="inline-flex items-center gap-1.5">
                <span style={{ color: PALETTE.ink4 }}>{f.label}:</span>
                <span className="truncate" style={{ maxWidth: 200 }}>{f.value}</span>
              </span>
            ))}
          </div>
        ) : (
          <span className="text-[12.5px]" style={{ color: PALETTE.ink4 }}>
            {kind === 'qualification' ? 'No answers captured' : 'No fields captured'}
          </span>
        )}
      </div>

      <div className="flex flex-col items-end gap-2">
        <span
          className="text-[11px] tracking-[0.04em]"
          style={{ color: PALETTE.ink3, fontFamily: 'ui-monospace, monospace' }}
        >
          {relTime(row.created_at)}
        </span>
        {kind === 'qualification' && score !== null && (
          <span
            className="text-[20px] leading-none tracking-[-0.01em]"
            style={{ color: PALETTE.accent, fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: 'italic' }}
          >
            {score.toFixed(1)} pts
          </span>
        )}
        {/* Stop propagation so the project action doesn't open the drawer */}
        <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <CreateProjectButton submissionId={row.id} leadId={row.lead_id} existingProject={row.project} />
        </span>
      </div>
    </div>
  )
}

/* ============================================================ */
/*  Drawer                                                      */
/* ============================================================ */

function SubmissionDrawer({
  row,
  kind,
  onClose,
}: {
  row: FormSubmissionRow
  kind: SubmissionKind
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const name = displayName(row)
  const source = submissionSource(row)
  const fields = extractFormFields(row.data)
  const answers = extractAnswers(row.data)
  const score = getScore(row.data)
  const implied = isImpliedSubmission(row)
  const quote = implied ? impliedQuote(row.data) : null

  return (
    <>
      <div
        className="fixed inset-0 z-[100]"
        style={{ background: 'rgba(31,30,29,0.40)', backdropFilter: 'blur(2px)', animation: 'subsFade 200ms ease-out' }}
        onClick={onClose}
      />
      <aside
        className="fixed inset-y-0 right-0 z-[101] flex w-[560px] max-w-[calc(100vw-40px)] flex-col"
        style={{
          background: PALETTE.paper,
          boxShadow: '-20px 0 60px -20px rgba(0,0,0,0.25)',
          animation: 'subsDrawerIn 300ms cubic-bezier(.2,.7,.2,1)',
        }}
      >
        <style>{`
          @keyframes subsFade { from { opacity: 0 } to { opacity: 1 } }
          @keyframes subsDrawerIn {
            from { transform: translateX(20px); opacity: 0.4 }
            to { transform: translateX(0); opacity: 1 }
          }
        `}</style>

        {/* Head */}
        <div className="flex items-center gap-3 border-b px-6 py-4" style={{ borderColor: PALETTE.line, background: PALETTE.bg }}>
          <div className="min-w-0 flex-1">
            <div
              className="mb-0.5 text-[10.5px] uppercase tracking-[0.12em]"
              style={{ color: PALETTE.ink3, fontFamily: 'ui-monospace, monospace' }}
            >
              {kind === 'qualification' ? 'Response' : 'Submission'} · {relTime(row.created_at)}
            </div>
            <div className="truncate text-[22px] leading-[1.2] tracking-[-0.01em]" style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}>
              {name === 'Anonymous' ? (
                <em style={{ color: PALETTE.accent, fontStyle: 'italic' }}>Anonymous</em>
              ) : (
                <>
                  From{' '}
                  <em style={{ color: PALETTE.accent, fontStyle: 'italic' }}>{name}</em>
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-full transition-colors"
            style={{ color: PALETTE.ink3 }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = PALETTE.lineSoft
              e.currentTarget.style.color = PALETTE.ink
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = PALETTE.ink3
            }}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {/* 01 — Lead */}
          <DrawerSection num="01" title="Lead">
            <div className="flex gap-4 rounded-xl border p-4" style={{ background: PALETTE.bg, borderColor: PALETTE.line }}>
              <InitialAvatar name={name} source={source} size={56} />
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-[17px] font-medium leading-[1.2]" style={{ color: PALETTE.ink }}>
                  {name}
                </div>
                <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px]" style={{ color: PALETTE.ink3 }}>
                  <span className="inline-flex items-center gap-1.5">
                    <SourceIcon source={source} />
                    via {source}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <ClockIcon />
                    {fullTime(row.created_at)}
                  </span>
                </div>
                {row.lead_id && (
                  <Link
                    href={`/dashboard/leads?lead=${row.lead_id}`}
                    className="mt-3 inline-flex items-center gap-1 text-[12px] hover:underline"
                    style={{ color: PALETTE.accent }}
                  >
                    Open full lead profile →
                  </Link>
                )}
              </div>
            </div>
          </DrawerSection>

          {/* 02 — Responses (qualification) or Form fields */}
          {kind === 'qualification' ? (
            <DrawerSection num="02" title="Responses">
              {(row.outcome || score !== null) && (
                <div
                  className="mb-3 flex items-center justify-between gap-3 rounded-xl border p-4"
                  style={{ background: PALETTE.paper, borderColor: PALETTE.line }}
                >
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-[0.08em]" style={{ color: PALETTE.ink3, fontFamily: 'ui-monospace, monospace' }}>
                      Result
                    </div>
                    {row.outcome ? <OutcomePill outcome={row.outcome} /> : <span style={{ color: PALETTE.ink3 }}>—</span>}
                  </div>
                  {score !== null && (
                    <div className="text-right">
                      <div className="mb-1 text-[10px] uppercase tracking-[0.08em]" style={{ color: PALETTE.ink3, fontFamily: 'ui-monospace, monospace' }}>
                        Score
                      </div>
                      <span
                        className="text-[28px] leading-none"
                        style={{ color: PALETTE.accent, fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: 'italic' }}
                      >
                        {score.toFixed(1)}
                      </span>
                    </div>
                  )}
                </div>
              )}
              {answers.length > 0 ? (
                <div className="overflow-hidden rounded-xl border" style={{ background: PALETTE.paper, borderColor: PALETTE.line }}>
                  {answers.map((a, i) => (
                    <div
                      key={a.prompt + i}
                      className="grid gap-3 px-4 py-3"
                      style={{
                        gridTemplateColumns: '1fr auto',
                        borderTop: i === 0 ? 'none' : `1px solid ${PALETTE.lineSoft}`,
                      }}
                    >
                      <span className="text-[12.5px] leading-snug" style={{ color: PALETTE.ink3 }}>{a.prompt}</span>
                      <span className="max-w-[220px] break-words text-right text-[13.5px] font-medium" style={{ color: PALETTE.ink }}>
                        {a.value}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyBlock text="No answers were captured for this response." />
              )}
            </DrawerSection>
          ) : implied ? (
            <DrawerSection num="02" title="Chat-implied intent">
              <div
                className="rounded-xl border p-4"
                style={{ background: PALETTE.paper, borderColor: PALETTE.line }}
              >
                <div className="mb-2 flex items-center gap-2">
                  <ImpliedPill />
                  <span className="text-[12.5px]" style={{ color: PALETTE.ink3 }}>
                    Detected from the conversation — no form was filled.
                  </span>
                </div>
                {quote ? (
                  <p
                    className="m-0 text-[15px] italic leading-[1.5]"
                    style={{ color: PALETTE.ink, fontFamily: "'Instrument Serif', Georgia, serif" }}
                  >
                    “{quote}”
                  </p>
                ) : (
                  <span className="text-[13px]" style={{ color: PALETTE.ink3 }}>
                    The customer signaled they want to proceed.
                  </span>
                )}
              </div>
            </DrawerSection>
          ) : (
            <DrawerSection num="02" title="Form fields">
              {fields.length > 0 ? (
                <div className="overflow-hidden rounded-xl border" style={{ background: PALETTE.paper, borderColor: PALETTE.line }}>
                  {fields.map((f, i) => (
                    <FieldRow key={f.key + i} label={f.label} value={f.value} first={i === 0} />
                  ))}
                </div>
              ) : (
                <EmptyBlock text="This submission has no field data attached." />
              )}
            </DrawerSection>
          )}

          {/* 03 — Project */}
          <DrawerSection num="03" title="Project">
            <div className="flex items-center justify-between gap-3 rounded-xl border p-4" style={{ background: PALETTE.bg, borderColor: PALETTE.line }}>
              <div>
                <div className="mb-0.5 text-[14px] font-medium" style={{ color: PALETTE.ink2 }}>
                  {row.project ? 'Tracked as a project' : 'Turn this into a project'}
                </div>
                <div className="text-[12.5px]" style={{ color: PALETTE.ink3 }}>
                  {row.project
                    ? 'Open the deal on the Projects board to keep working it.'
                    : row.lead_id
                      ? 'Create a project to track this deal through your stages.'
                      : 'Link a lead first to create a project from this submission.'}
                </div>
              </div>
              <div className="shrink-0">
                <CreateProjectButton submissionId={row.id} leadId={row.lead_id} existingProject={row.project} />
              </div>
            </div>
          </DrawerSection>

          {/* 04 — Activity */}
          <DrawerSection num="04" title="Activity">
            <Timeline row={row} kind={kind} />
          </DrawerSection>
        </div>
      </aside>
    </>
  )
}

function DrawerSection({ num, title, children }: { num: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <div className="mb-3 flex items-center gap-2.5">
        <span
          className="rounded-full px-2 py-0.5 text-[10px] tracking-[0.1em]"
          style={{ background: PALETTE.accentSoft, color: PALETTE.accent, fontFamily: 'ui-monospace, monospace' }}
        >
          {num}
        </span>
        <h2 className="text-[19px] font-normal leading-tight tracking-[-0.005em]" style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}>
          {title}
        </h2>
      </div>
      {children}
    </section>
  )
}

function FieldRow({ label, value, first }: { label: string; value: string; first: boolean }) {
  const [copied, setCopied] = useState(false)
  const onCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }
  }
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  const isPhone = /^[+]?[\d\s\-()]{6,}$/.test(value)

  return (
    <div
      className="grid items-baseline gap-3 px-4 py-3"
      style={{ gridTemplateColumns: '140px 1fr auto', borderTop: first ? 'none' : `1px solid ${PALETTE.lineSoft}` }}
    >
      <span className="text-[10.5px] uppercase tracking-[0.08em]" style={{ color: PALETTE.ink3, fontFamily: 'ui-monospace, monospace' }}>
        {label}
      </span>
      <span className="break-words text-[14px] leading-[1.5]" style={{ color: PALETTE.ink }}>
        {isEmail ? (
          <a href={`mailto:${value}`} className="hover:underline" style={{ color: PALETTE.accent }}>{value}</a>
        ) : isPhone ? (
          <a href={`tel:${value.replace(/\s/g, '')}`} className="hover:underline" style={{ color: PALETTE.accent }}>{value}</a>
        ) : (
          value
        )}
      </span>
      <button
        type="button"
        onClick={onCopy}
        className="grid place-items-center p-1 transition-colors"
        style={{ color: copied ? PALETTE.success : PALETTE.ink4 }}
        aria-label={copied ? 'Copied' : 'Copy'}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  )
}

function EmptyBlock({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed p-4 text-[12.5px]" style={{ borderColor: PALETTE.line, background: PALETTE.bg, color: PALETTE.ink3 }}>
      {text}
    </div>
  )
}

function Timeline({ row, kind }: { row: FormSubmissionRow; kind: SubmissionKind }) {
  type Item = { kind: 'default' | 'success' | 'warning'; text: string; time: string }
  const items: Item[] = [
    {
      kind: 'default',
      text: kind === 'qualification' ? 'Completed the quiz' : 'Submitted the form',
      time: fullTime(row.created_at),
    },
  ]
  if (kind === 'qualification' && row.outcome) {
    const isNeg = /disqual|lost|not_fit|invalid/i.test(row.outcome)
    items.push({
      kind: isNeg ? 'warning' : 'success',
      text: `Result: ${formatOutcomeLabel(row.outcome)}`,
      time: fullTime(row.created_at),
    })
  }
  if (row.project) {
    items.push({
      kind: 'success',
      text: `Tracked as a project${row.project.stageName ? ` · ${row.project.stageName}` : ''}`,
      time: '—',
    })
  }

  return (
    <div className="pl-1">
      {items.map((it, i) => {
        const last = i === items.length - 1
        const dotBg = it.kind === 'success' ? PALETTE.success : it.kind === 'warning' ? PALETTE.warning : PALETTE.paper
        const dotInk = it.kind === 'default' ? PALETTE.ink3 : PALETTE.paper
        return (
          <div key={i} className="relative grid gap-3 py-2" style={{ gridTemplateColumns: '24px 1fr' }}>
            {!last && (
              <span
                aria-hidden
                className="absolute"
                style={{ left: 11, top: 26, width: 2, height: 'calc(100% - 12px)', background: PALETTE.line }}
              />
            )}
            <span
              className="relative z-[1] grid h-6 w-6 place-items-center rounded-full border"
              style={{ background: dotBg, color: dotInk, borderColor: it.kind === 'default' ? PALETTE.ink4 : 'transparent' }}
            >
              {it.kind === 'success' ? <CheckIcon size={12} /> : <DotIcon />}
            </span>
            <div className="pt-[3px]">
              <div className="text-[13.5px] leading-[1.4]" style={{ color: PALETTE.ink2 }}>{it.text}</div>
              <div className="mt-0.5 text-[10.5px] tracking-[0.04em]" style={{ color: PALETTE.ink3, fontFamily: 'ui-monospace, monospace' }}>
                {it.time}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ============================================================ */
/*  Pills, avatars                                              */
/* ============================================================ */

function SourcePill({ source }: { source: 'Messenger' | 'Web' }) {
  const meta =
    source === 'Messenger'
      ? { bg: 'rgba(24,119,242,0.10)', ink: '#1456B0', label: 'Messenger' }
      : { bg: PALETTE.lineSoft, ink: PALETTE.ink3, label: 'Web' }
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]"
      style={{ background: meta.bg, color: meta.ink, fontFamily: 'ui-monospace, monospace' }}
    >
      {meta.label}
    </span>
  )
}

function ImpliedPill() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10.5px] uppercase tracking-[0.06em]"
      style={{ background: 'rgba(124,58,237,0.10)', color: '#6D28D9', fontFamily: 'ui-monospace, monospace' }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
      Chat-implied
    </span>
  )
}

function OutcomePill({ outcome }: { outcome: string }) {
  const isNeg = /disqual|lost|not_fit|invalid/i.test(outcome)
  const isPos = /qual|won|hot|booked|checked/i.test(outcome)
  const meta = isNeg
    ? { bg: PALETTE.accentSoft, ink: PALETTE.accent }
    : isPos
      ? { bg: PALETTE.successSoft, ink: PALETTE.success }
      : { bg: PALETTE.warningSoft, ink: PALETTE.warning }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10.5px] uppercase tracking-[0.06em]"
      style={{ background: meta.bg, color: meta.ink, fontFamily: 'ui-monospace, monospace' }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
      {formatOutcomeLabel(outcome)}
    </span>
  )
}

function InitialAvatar({ name, source, size }: { name: string; source: 'Messenger' | 'Web'; size: number }) {
  const initial = name && name !== 'Anonymous' ? name.trim()[0]?.toUpperCase() ?? '?' : '?'
  const fontSize = size === 56 ? 26 : 20
  const gradient =
    source === 'Messenger'
      ? 'linear-gradient(135deg, #1877F2 0%, #0a66c2 100%)'
      : 'linear-gradient(135deg, #C96442 0%, #7A3A22 100%)'
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full text-white"
      style={{
        width: size,
        height: size,
        background: gradient,
        fontFamily: "'Instrument Serif', Georgia, serif",
        fontStyle: 'italic',
        fontSize,
      }}
    >
      {initial}
    </span>
  )
}

/* ============================================================ */
/*  Icons                                                       */
/* ============================================================ */

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

function ClockIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}
function CloseIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" {...stroke}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}
function CopyIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" {...stroke}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  )
}
function CheckIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...stroke}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}
function DotIcon() {
  return (
    <svg width={6} height={6} viewBox="0 0 6 6">
      <circle cx="3" cy="3" r="3" fill="currentColor" />
    </svg>
  )
}
function SourceIcon({ source }: { source: 'Messenger' | 'Web' }) {
  if (source === 'Messenger') {
    return (
      <svg width={12} height={12} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M12 2C6.477 2 2 6.145 2 11.243c0 2.908 1.437 5.51 3.687 7.21V22l3.37-1.852C10.077 20.374 11.02 20.5 12 20.5c5.523 0 10-4.145 10-9.257C22 6.145 17.523 2 12 2zm1.05 12.47l-2.55-2.72-4.98 2.72 5.48-5.82 2.6 2.72 4.93-2.72-5.48 5.82z" />
      </svg>
    )
  }
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
    </svg>
  )
}

/* ============================================================ */
/*  Time helpers                                               */
/* ============================================================ */

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
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
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(day / 365)}y ago`
}

function fullTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
