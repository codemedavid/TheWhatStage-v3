'use client'

import { useMemo, useState, useTransition, useEffect } from 'react'
import Link from 'next/link'
import type { OrderPayment } from '@/lib/order-payments/types'
import { verifyPayment, rejectPayment } from './payment-actions'

export interface SalesSubmissionRow {
  id: string
  outcome: string | null
  data: Record<string, unknown>
  meta: Record<string, unknown> | null
  created_at: string
  lead_id: string | null
  lead: {
    id: string
    name: string | null
    email: string | null
    phone: string | null
    picture_url: string | null
    psid: string | null
    fb_page_id: string | null
  } | null
  source_action_page: {
    id: string
    title: string
    kind: string
    slug: string
  } | null
  payment: OrderPayment | null
}

interface Props {
  pageId: string
  pageTitle: string
  pageStatus: 'draft' | 'published' | 'archived'
  submissions: SalesSubmissionRow[]
}

type FilterKind = 'all' | 'sales' | 'form' | 'booking' | 'qualification'

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

export default function SalesSubmissionsView({
  pageId,
  pageTitle,
  pageStatus,
  submissions,
}: Props) {
  const [filter, setFilter] = useState<FilterKind>('all')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const stats = useMemo(() => {
    let paid = 0
    let awaiting = 0
    let revenue = 0
    let currency = ''
    for (const s of submissions) {
      if (s.payment?.status === 'verified') {
        paid += 1
        revenue += s.payment.amount ?? 0
        if (!currency && s.payment.currency) currency = s.payment.currency
      } else if (s.payment?.status === 'submitted') {
        awaiting += 1
      }
    }
    return { total: submissions.length, paid, awaiting, revenue, currency }
  }, [submissions])

  const counts = useMemo(() => {
    const c: Record<FilterKind, number> = {
      all: submissions.length,
      sales: 0,
      form: 0,
      booking: 0,
      qualification: 0,
    }
    for (const s of submissions) {
      const k = s.source_action_page?.kind
      if (k === 'form' || k === 'booking' || k === 'qualification') c[k] += 1
      else c.sales += 1
    }
    return c
  }, [submissions])

  const filtered = useMemo(() => {
    let list = submissions
    if (filter !== 'all') {
      list = list.filter((s) => {
        const k = s.source_action_page?.kind
        if (filter === 'sales') return !k || k === 'sales'
        return k === filter
      })
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter((s) => {
        const name = (s.lead?.name ?? '').toLowerCase()
        const email = (s.lead?.email ?? '').toLowerCase()
        const phone = (s.lead?.phone ?? '').toLowerCase()
        const fieldText = JSON.stringify(s.data).toLowerCase()
        return (
          name.includes(q) ||
          email.includes(q) ||
          phone.includes(q) ||
          fieldText.includes(q)
        )
      })
    }
    return list
  }, [submissions, filter, query])

  const openRow = useMemo(
    () => submissions.find((s) => s.id === openId) ?? null,
    [submissions, openId],
  )

  return (
    <div
      className="min-h-screen"
      style={{ background: PALETTE.bg, color: PALETTE.ink }}
    >
      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Breadcrumb */}
        <div
          className="mb-4 flex items-center gap-2 text-[11px] uppercase tracking-[0.04em]"
          style={{ color: PALETTE.ink3, fontFamily: 'ui-monospace, monospace' }}
        >
          <Link
            href="/dashboard/action-pages"
            className="hover:underline"
            style={{ color: PALETTE.ink3 }}
          >
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
              <em style={{ color: PALETTE.accent, fontStyle: 'italic' }}>
                submissions
              </em>
            </h1>
            <p
              className="m-0 max-w-[580px] text-[14.5px] leading-[1.5]"
              style={{ color: PALETTE.ink3 }}
            >
              Every buyer who completed the form on this sales page — their
              Facebook profile, what they filled in, and the payment they
              attached.
              {pageStatus !== 'published' && (
                <span
                  className="ml-2 rounded-full px-2 py-0.5 text-[11px] font-medium"
                  style={{
                    background: PALETTE.warningSoft,
                    color: PALETTE.warning,
                  }}
                >
                  {pageStatus}
                </span>
              )}
            </p>
          </div>
          <Link
            href={`/dashboard/action-pages/${pageId}`}
            className="shrink-0 rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              borderColor: PALETTE.line,
              background: PALETTE.paper,
              color: PALETTE.ink2,
            }}
          >
            Edit sales page
          </Link>
        </div>

        {/* Stat tiles */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Total" value={stats.total} />
          <StatTile label="Paid" value={stats.paid} variant="success" />
          <StatTile
            label="Awaiting"
            value={stats.awaiting}
            variant={stats.awaiting > 0 ? 'warning' : 'default'}
          />
          <StatTile
            label="Revenue"
            value={stats.revenue}
            variant="accent"
            currency={stats.currency}
          />
        </div>

        {/* Filter row */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div
            className="inline-flex rounded-full border p-[3px]"
            style={{ background: PALETTE.paper, borderColor: PALETTE.line }}
          >
            {(['all', 'sales', 'form', 'booking', 'qualification'] as FilterKind[]).map(
              (k) => {
                const on = filter === k
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setFilter(k)}
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] transition-colors"
                    style={{
                      background: on ? PALETTE.ink : 'transparent',
                      color: on ? PALETTE.paper : PALETTE.ink3,
                    }}
                  >
                    {k === 'all'
                      ? 'All'
                      : k.charAt(0).toUpperCase() + k.slice(1)}
                    <span
                      className="rounded-full px-1.5 py-px text-[11px]"
                      style={{
                        background: on
                          ? 'rgba(255,255,255,0.18)'
                          : 'rgba(0,0,0,0.06)',
                        fontFamily: 'ui-monospace, monospace',
                      }}
                    >
                      {counts[k]}
                    </span>
                  </button>
                )
              },
            )}
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
              placeholder="Search name, email, or any field…"
              className="rounded-full border py-2 pl-9 pr-4 text-[13px] outline-none"
              style={{
                width: 280,
                background: PALETTE.paper,
                borderColor: PALETTE.line,
                color: PALETTE.ink,
              }}
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
                ? 'No submissions yet. When buyers complete the form on this sales page, they will appear here.'
                : 'No submissions match this filter.'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((s) => (
              <SubmissionCard
                key={s.id}
                row={s}
                onOpen={() => setOpenId(s.id)}
              />
            ))}
          </div>
        )}
      </div>

      {openRow && (
        <SubmissionDrawer
          row={openRow}
          pageId={pageId}
          onClose={() => setOpenId(null)}
        />
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
  variant = 'default',
  currency,
}: {
  label: string
  value: number
  variant?: 'default' | 'success' | 'warning' | 'accent'
  currency?: string
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
    <div
      className="overflow-hidden rounded-2xl border p-5"
      style={{ background: PALETTE.paper, borderColor: PALETTE.line }}
    >
      <div className="flex items-baseline gap-1">
        {variant === 'accent' && currency && (
          <span
            className="text-[14px]"
            style={{ color, fontFamily: "'Instrument Serif', Georgia, serif" }}
          >
            {currencySymbol(currency)}
          </span>
        )}
        <span
          className="text-[36px] leading-none tracking-[-0.015em]"
          style={{
            color,
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontStyle: 'italic',
          }}
        >
          {variant === 'accent' ? value.toLocaleString() : value}
        </span>
      </div>
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
/*  Submission card                                              */
/* ============================================================ */

function SubmissionCard({
  row,
  onOpen,
}: {
  row: SalesSubmissionRow
  onOpen: () => void
}) {
  const status = paymentDisplayStatus(row.payment)
  const kindLabel = row.source_action_page?.kind ?? 'sales'
  const fields = extractFields(row.data)
  const name = row.lead?.name ?? '—'
  const email = pickField(fields, ['email', 'contact_email']) ?? row.lead?.email
  const phone = pickField(fields, ['phone', 'contact_phone']) ?? row.lead?.phone
  const location = pickField(fields, ['location', 'city', 'address'])

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group grid w-full grid-cols-[auto_1fr_auto] items-center gap-4 rounded-2xl border p-4 text-left transition-all"
      style={{ background: PALETTE.paper, borderColor: PALETTE.line }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = PALETTE.ink4
        e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.04)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = PALETTE.line
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
      <FBAvatar
        name={name}
        pictureUrl={row.lead?.picture_url ?? null}
        size={44}
      />

      <div className="min-w-0">
        <div className="mb-1.5 flex items-center gap-2">
          <span
            className="truncate text-[15px] font-medium"
            style={{ color: PALETTE.ink, maxWidth: 240 }}
          >
            {name}
          </span>
          <KindPill kind={kindLabel} />
          {status && <StatusPill status={status} />}
        </div>
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]"
          style={{ color: PALETTE.ink3 }}
        >
          {email && (
            <span className="inline-flex items-center gap-1.5">
              <MailIcon />
              {email}
            </span>
          )}
          {phone && (
            <span className="inline-flex items-center gap-1.5">
              <PhoneIcon />
              {phone}
            </span>
          )}
          {location && (
            <span className="inline-flex items-center gap-1.5">
              <PinIcon />
              {location}
            </span>
          )}
        </div>
        {row.payment?.status === 'submitted' && (
          <div
            className="mt-3 flex items-center gap-1.5 border-t pt-2.5 text-[12px]"
            style={{
              borderColor: PALETTE.lineSoft,
              borderStyle: 'dashed',
              color: PALETTE.warning,
            }}
          >
            <AlertIcon />
            <span className="font-medium">
              Awaiting your verification — receipt attached
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-col items-end gap-1.5">
        <span
          className="text-[11px] tracking-[0.04em]"
          style={{ color: PALETTE.ink3, fontFamily: 'ui-monospace, monospace' }}
        >
          {relTime(row.created_at)}
        </span>
        {row.payment?.amount != null && (
          <span
            className="text-[22px] leading-none tracking-[-0.01em]"
            style={{
              color: PALETTE.accent,
              fontFamily: "'Instrument Serif', Georgia, serif",
              fontStyle: 'italic',
            }}
          >
            {currencySymbol(row.payment.currency ?? '')}
            {row.payment.amount.toLocaleString()}
          </span>
        )}
        {!row.payment && (
          <span
            className="text-[11px] tracking-[0.04em]"
            style={{
              color: PALETTE.ink4,
              fontFamily: 'ui-monospace, monospace',
            }}
          >
            No payment
          </span>
        )}
      </div>
    </button>
  )
}

/* ============================================================ */
/*  Drawer                                                       */
/* ============================================================ */

function SubmissionDrawer({
  row,
  pageId,
  onClose,
}: {
  row: SalesSubmissionRow
  pageId: string
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

  const fields = extractFields(row.data)
  const name = row.lead?.name ?? '—'

  return (
    <>
      <div
        className="fixed inset-0 z-[100]"
        style={{
          background: 'rgba(31,30,29,0.40)',
          backdropFilter: 'blur(2px)',
          animation: 'subsFade 200ms ease-out',
        }}
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
        <div
          className="flex items-center gap-3 border-b px-6 py-4"
          style={{ borderColor: PALETTE.line, background: PALETTE.bg }}
        >
          <div className="min-w-0 flex-1">
            <div
              className="mb-0.5 text-[10.5px] uppercase tracking-[0.12em]"
              style={{
                color: PALETTE.ink3,
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              Submission · {relTime(row.created_at)}
            </div>
            <div
              className="truncate text-[22px] leading-[1.2] tracking-[-0.01em]"
              style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
            >
              {name === '—' ? (
                <em style={{ color: PALETTE.accent, fontStyle: 'italic' }}>
                  Anonymous buyer
                </em>
              ) : (
                <>
                  From{' '}
                  <em style={{ color: PALETTE.accent, fontStyle: 'italic' }}>
                    {name}
                  </em>
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
            <div
              className="flex gap-4 rounded-xl border p-4"
              style={{ background: PALETTE.bg, borderColor: PALETTE.line }}
            >
              <FBAvatar
                name={name}
                pictureUrl={row.lead?.picture_url ?? null}
                size={56}
              />
              <div className="min-w-0 flex-1">
                <div
                  className="mb-1 text-[17px] font-medium leading-[1.2]"
                  style={{ color: PALETTE.ink }}
                >
                  {name}
                </div>
                {row.lead?.psid && (
                  <a
                    href={`https://www.facebook.com/${row.lead.psid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mb-2 inline-flex items-center gap-1 text-[12.5px] hover:underline"
                    style={{ color: PALETTE.fbBlue }}
                  >
                    <FBMark />
                    View on Facebook
                  </a>
                )}
                <div
                  className="flex flex-wrap gap-x-3.5 gap-y-1 text-[12.5px]"
                  style={{ color: PALETTE.ink3 }}
                >
                  {row.lead?.email && (
                    <span className="inline-flex items-center gap-1.5">
                      <MailIcon />
                      {row.lead.email}
                    </span>
                  )}
                  {row.lead?.phone && (
                    <span className="inline-flex items-center gap-1.5">
                      <PhoneIcon />
                      {row.lead.phone}
                    </span>
                  )}
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

          {/* 02 — Form fields */}
          {fields.length > 0 && (
            <DrawerSection num="02" title="Form fields">
              <div
                className="overflow-hidden rounded-xl border"
                style={{ background: PALETTE.paper, borderColor: PALETTE.line }}
              >
                {fields.map((f, i) => (
                  <FieldRow key={f.key + i} field={f} first={i === 0} />
                ))}
              </div>
            </DrawerSection>
          )}

          {/* 03 — Payment */}
          <DrawerSection num="03" title="Payment">
            {row.payment ? (
              <PaymentBlock payment={row.payment} pageId={pageId} />
            ) : (
              <div
                className="flex items-center justify-between gap-3 rounded-xl border border-dashed p-4"
                style={{ borderColor: PALETTE.line, background: PALETTE.bg }}
              >
                <div>
                  <div
                    className="mb-0.5 text-[14px] font-medium"
                    style={{ color: PALETTE.ink2 }}
                  >
                    No payment yet
                  </div>
                  <div
                    className="text-[12.5px]"
                    style={{ color: PALETTE.ink3 }}
                  >
                    This lead submitted the form but never attached a receipt.
                  </div>
                </div>
                {row.lead?.psid && (
                  <a
                    href={`https://www.facebook.com/messages/t/${row.lead.psid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 rounded-md px-3 py-1.5 text-[12.5px] font-medium"
                    style={{
                      background: PALETTE.ink,
                      color: PALETTE.paper,
                    }}
                  >
                    Send reminder
                  </a>
                )}
              </div>
            )}
          </DrawerSection>

          {/* 04 — Activity */}
          <DrawerSection num="04" title="Activity">
            <Timeline row={row} />
          </DrawerSection>
        </div>
      </aside>
    </>
  )
}

function DrawerSection({
  num,
  title,
  children,
}: {
  num: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-7">
      <div className="mb-3 flex items-center gap-2.5">
        <span
          className="rounded-full px-2 py-0.5 text-[10px] tracking-[0.1em]"
          style={{
            background: PALETTE.accentSoft,
            color: PALETTE.accent,
            fontFamily: 'ui-monospace, monospace',
          }}
        >
          {num}
        </span>
        <h2
          className="text-[19px] font-normal leading-tight tracking-[-0.005em]"
          style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
        >
          {title}
        </h2>
      </div>
      {children}
    </section>
  )
}

function FieldRow({
  field,
  first,
}: {
  field: { key: string; label: string; value: string; kind?: 'email' | 'phone' | 'text' }
  first: boolean
}) {
  const [copied, setCopied] = useState(false)
  const onCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(field.value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }
  }
  const isEmail = field.kind === 'email' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(field.value)
  const isPhone = field.kind === 'phone' || /^[+]?[\d\s\-()]{6,}$/.test(field.value)

  return (
    <div
      className="grid items-baseline gap-3 px-4 py-3"
      style={{
        gridTemplateColumns: '140px 1fr auto',
        borderTop: first ? 'none' : `1px solid ${PALETTE.lineSoft}`,
      }}
    >
      <span
        className="text-[10.5px] uppercase tracking-[0.08em]"
        style={{ color: PALETTE.ink3, fontFamily: 'ui-monospace, monospace' }}
      >
        {field.label}
      </span>
      <span
        className="break-words text-[14px] leading-[1.5]"
        style={{ color: PALETTE.ink }}
      >
        {isEmail ? (
          <a
            href={`mailto:${field.value}`}
            className="hover:underline"
            style={{ color: PALETTE.accent }}
          >
            {field.value}
          </a>
        ) : isPhone ? (
          <a
            href={`tel:${field.value.replace(/\s/g, '')}`}
            className="hover:underline"
            style={{ color: PALETTE.accent }}
          >
            {field.value}
          </a>
        ) : (
          field.value
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

function PaymentBlock({
  payment,
  pageId,
}: {
  payment: OrderPayment
  pageId: string
}) {
  const status = paymentDisplayStatus(payment)!
  return (
    <div
      className="overflow-hidden rounded-xl border p-5"
      style={{ background: PALETTE.paper, borderColor: PALETTE.line }}
    >
      <div
        className="mb-3.5 flex items-start justify-between gap-4 border-b pb-3.5"
        style={{ borderColor: PALETTE.lineSoft, borderStyle: 'dashed' }}
      >
        <div
          className="text-[36px] leading-none tracking-[-0.015em]"
          style={{
            color: PALETTE.accent,
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontStyle: 'italic',
          }}
        >
          {payment.amount != null
            ? `${currencySymbol(payment.currency ?? '')}${payment.amount.toLocaleString()}`
            : '—'}
        </div>
        <div className="text-right">
          <StatusPill status={status} />
          {status === 'rejected' && payment.rejection_reason && (
            <p
              className="mt-1.5 max-w-[200px] text-[11.5px] leading-tight"
              style={{ color: PALETTE.accent }}
            >
              {payment.rejection_reason}
            </p>
          )}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3">
        <PaymentDetail label="Method">
          <div className="flex items-center gap-2">
            <span style={{ color: PALETTE.ink }}>{payment.method_name}</span>
            <span
              className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
              style={{
                background: PALETTE.lineSoft,
                color: PALETTE.ink3,
                fontFamily: 'ui-monospace, monospace',
              }}
            >
              {payment.method_kind}
            </span>
          </div>
        </PaymentDetail>
        <PaymentDetail label="Currency">
          {payment.currency ?? '—'}
        </PaymentDetail>
        {payment.note && (
          <PaymentDetail label="Buyer note" full>
            <span style={{ color: PALETTE.ink2 }}>{payment.note}</span>
          </PaymentDetail>
        )}
        <PaymentDetail label="Submitted">
          {fullTime(payment.created_at)}
        </PaymentDetail>
        {payment.verified_at && (
          <PaymentDetail label="Verified">
            {fullTime(payment.verified_at)}
          </PaymentDetail>
        )}
      </div>

      {payment.proof_url && (
        <a
          href={payment.proof_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-4 block overflow-hidden rounded-lg border"
          style={{ borderColor: PALETTE.line, background: PALETTE.bg }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={payment.proof_url}
            alt="Payment proof"
            className="block w-full"
            style={{ maxHeight: 360, objectFit: 'contain' }}
          />
        </a>
      )}

      {payment.status === 'submitted' && (
        <PaymentActionsRow paymentId={payment.id} pageId={pageId} />
      )}
    </div>
  )
}

function PaymentDetail({
  label,
  children,
  full,
}: {
  label: string
  children: React.ReactNode
  full?: boolean
}) {
  return (
    <div className={full ? 'col-span-2' : ''}>
      <div
        className="mb-1 text-[10px] uppercase tracking-[0.08em]"
        style={{ color: PALETTE.ink3, fontFamily: 'ui-monospace, monospace' }}
      >
        {label}
      </div>
      <div className="text-[13.5px]" style={{ color: PALETTE.ink }}>
        {children}
      </div>
    </div>
  )
}

function PaymentActionsRow({
  paymentId,
  pageId,
}: {
  paymentId: string
  pageId: string
}) {
  const [pending, start] = useTransition()
  const [showReject, setShowReject] = useState(false)
  const [reason, setReason] = useState('')

  return (
    <div
      className="flex flex-col gap-2 border-t pt-3.5"
      style={{ borderColor: PALETTE.line }}
    >
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => start(() => verifyPayment(paymentId, pageId))}
          className="flex-1 rounded-md px-4 py-2.5 text-[13.5px] font-medium transition-colors disabled:opacity-50"
          style={{
            background: PALETTE.ink,
            color: PALETTE.paper,
          }}
        >
          Mark as paid
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setShowReject((v) => !v)}
          className="flex-1 rounded-md border px-4 py-2.5 text-[13.5px] font-medium transition-colors disabled:opacity-50"
          style={{
            borderColor: PALETTE.accent,
            color: PALETTE.accent,
            background: 'transparent',
          }}
        >
          Reject…
        </button>
      </div>
      {showReject && (
        <form
          className="grid gap-2"
          action={(fd: FormData) => {
            const r = String(fd.get('reason') ?? '').trim()
            if (!r) return
            start(async () => {
              await rejectPayment(paymentId, r, pageId)
              setShowReject(false)
              setReason('')
            })
          }}
        >
          <textarea
            name="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            rows={3}
            maxLength={500}
            placeholder="Reason for rejection…"
            className="w-full rounded-md border p-2 text-[13px] outline-none"
            style={{ borderColor: PALETTE.line, color: PALETTE.ink }}
          />
          <button
            type="submit"
            disabled={pending || !reason.trim()}
            className="rounded-md px-3 py-2 text-[13px] font-medium text-white disabled:opacity-50"
            style={{ background: PALETTE.accent }}
          >
            Submit rejection
          </button>
        </form>
      )}
    </div>
  )
}

function Timeline({ row }: { row: SalesSubmissionRow }) {
  type Item = { kind: 'default' | 'success' | 'warning'; text: string; time: string }
  const items: Item[] = []
  items.push({
    kind: 'default',
    text: 'Submitted form on sales page',
    time: fullTime(row.created_at),
  })
  if (row.payment) {
    items.push({
      kind: 'default',
      text: `Attached payment proof · ${row.payment.method_name}`,
      time: fullTime(row.payment.created_at),
    })
    if (row.payment.status === 'verified' && row.payment.verified_at) {
      items.push({
        kind: 'success',
        text: 'Payment verified',
        time: fullTime(row.payment.verified_at),
      })
    } else if (row.payment.status === 'rejected') {
      items.push({
        kind: 'warning',
        text: 'Payment rejected',
        time: fullTime(row.payment.updated_at),
      })
    } else {
      items.push({
        kind: 'warning',
        text: 'Awaiting your verification',
        time: '—',
      })
    }
  }

  return (
    <div className="pl-1">
      {items.map((it, i) => {
        const last = i === items.length - 1
        const dotBg =
          it.kind === 'success'
            ? PALETTE.success
            : it.kind === 'warning'
              ? PALETTE.warning
              : PALETTE.paper
        const dotInk =
          it.kind === 'default' ? PALETTE.ink3 : PALETTE.paper
        return (
          <div
            key={i}
            className="relative grid gap-3 py-2"
            style={{ gridTemplateColumns: '24px 1fr' }}
          >
            {!last && (
              <span
                aria-hidden
                className="absolute"
                style={{
                  left: 11,
                  top: 26,
                  width: 2,
                  height: 'calc(100% - 12px)',
                  background: PALETTE.line,
                }}
              />
            )}
            <span
              className="relative z-[1] grid h-6 w-6 place-items-center rounded-full border"
              style={{
                background: dotBg,
                color: dotInk,
                borderColor:
                  it.kind === 'default' ? PALETTE.ink4 : 'transparent',
              }}
            >
              {it.kind === 'success' ? (
                <CheckIcon size={12} />
              ) : it.kind === 'warning' ? (
                <DotIcon />
              ) : (
                <DotIcon />
              )}
            </span>
            <div className="pt-[3px]">
              <div
                className="text-[13.5px] leading-[1.4]"
                style={{ color: PALETTE.ink2 }}
              >
                {it.text}
              </div>
              <div
                className="mt-0.5 text-[10.5px] tracking-[0.04em]"
                style={{
                  color: PALETTE.ink3,
                  fontFamily: 'ui-monospace, monospace',
                }}
              >
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
/*  Pills, badges, avatars                                       */
/* ============================================================ */

function KindPill({ kind }: { kind: string }) {
  const meta = KIND_META[kind] ?? {
    bg: PALETTE.lineSoft,
    ink: PALETTE.ink3,
    label: kind,
  }
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.08em]"
      style={{
        background: meta.bg,
        color: meta.ink,
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      {meta.label}
    </span>
  )
}

const KIND_META: Record<string, { bg: string; ink: string; label: string }> = {
  sales: { bg: 'rgba(201,100,66,0.10)', ink: '#7A3A22', label: 'Sales' },
  form: { bg: '#E1E8F0', ink: '#2B4A6F', label: 'Form' },
  booking: { bg: '#E8E1F0', ink: '#4A2B6F', label: 'Booking' },
  qualification: { bg: '#F0EBDF', ink: '#6F4A2B', label: 'Qualification' },
  catalog: { bg: '#DFEAE0', ink: '#2B6F38', label: 'Catalog' },
}

function StatusPill({
  status,
}: {
  status: 'paid' | 'pending' | 'rejected'
}) {
  const meta =
    status === 'paid'
      ? { bg: PALETTE.successSoft, ink: PALETTE.success, label: 'Paid' }
      : status === 'pending'
        ? {
            bg: PALETTE.warningSoft,
            ink: PALETTE.warning,
            label: 'Pending',
          }
        : { bg: PALETTE.accentSoft, ink: PALETTE.accent, label: 'Rejected' }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10.5px] uppercase tracking-[0.06em]"
      style={{
        background: meta.bg,
        color: meta.ink,
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: 'currentColor' }}
      />
      {meta.label}
    </span>
  )
}

function FBAvatar({
  name,
  pictureUrl,
  size,
}: {
  name: string
  pictureUrl: string | null
  size: number
}) {
  const initial =
    name && name !== '—' ? name.trim()[0]?.toUpperCase() ?? '?' : '?'
  const fontSize = size === 56 ? 26 : size === 44 ? 20 : 14
  return (
    <div
      className="relative shrink-0 overflow-visible rounded-full"
      style={{ width: size, height: size }}
    >
      {pictureUrl ? (
        <span
          className="block h-full w-full overflow-hidden rounded-full"
          style={{ background: PALETTE.lineSoft }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pictureUrl}
            alt={name}
            width={size}
            height={size}
            className="h-full w-full object-cover"
          />
        </span>
      ) : (
        <span
          className="grid h-full w-full place-items-center rounded-full text-white"
          style={{
            background: 'linear-gradient(135deg, #1877F2 0%, #0a66c2 100%)',
            fontFamily: "'Instrument Serif', Georgia, serif",
            fontStyle: 'italic',
            fontSize,
          }}
        >
          {initial}
        </span>
      )}
      <span
        className="absolute grid place-items-center rounded-full font-extrabold text-white"
        style={{
          right: -2,
          bottom: -2,
          width: size === 56 ? 20 : 18,
          height: size === 56 ? 20 : 18,
          background: PALETTE.fbBlue,
          border: `2px solid ${PALETTE.paper}`,
          fontFamily: 'Helvetica, Arial, sans-serif',
          fontSize: size === 56 ? 12 : 11,
        }}
      >
        f
      </span>
    </div>
  )
}

/* ============================================================ */
/*  Icons                                                        */
/* ============================================================ */

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

function MailIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </svg>
  )
}
function PhoneIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" {...stroke}>
      <path d="M22 16.92v3a2 2 0 01-2.18 2A19.79 19.79 0 012 4.18 2 2 0 014 2h3a2 2 0 012 1.72 12.86 12.86 0 00.7 2.81 2 2 0 01-.45 2.11L8 10a16 16 0 006 6l1.36-1.27a2 2 0 012.11-.45 12.86 12.86 0 002.81.7A2 2 0 0122 16.92z" />
    </svg>
  )
}
function PinIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" {...stroke}>
      <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 1118 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}
function ClockIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}
function AlertIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" {...stroke}>
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
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
function FBMark() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22 12a10 10 0 10-11.56 9.88V14.9H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.47h-1.27c-1.24 0-1.63.77-1.63 1.56V12h2.77l-.44 2.9h-2.33v6.98A10 10 0 0022 12z" />
    </svg>
  )
}

/* ============================================================ */
/*  Helpers                                                      */
/* ============================================================ */

function paymentDisplayStatus(
  p: OrderPayment | null,
): 'paid' | 'pending' | 'rejected' | null {
  if (!p) return null
  if (p.status === 'verified') return 'paid'
  if (p.status === 'rejected') return 'rejected'
  return 'pending'
}

function extractFields(
  data: Record<string, unknown>,
): Array<{ key: string; label: string; value: string; kind?: 'email' | 'phone' | 'text' }> {
  const fields =
    data?.fields && typeof data.fields === 'object'
      ? (data.fields as Record<string, unknown>)
      : null

  const out: Array<{ key: string; label: string; value: string; kind?: 'email' | 'phone' | 'text' }> = []
  const seen = new Set<string>()

  const push = (k: string, v: unknown) => {
    if (seen.has(k)) return
    const value = formatVal(v)
    if (!value || value === '—') return
    seen.add(k)
    out.push({ key: k, label: humanize(k), value })
  }

  if (fields) {
    for (const [k, v] of Object.entries(fields)) push(k, v)
  } else {
    for (const [k, v] of Object.entries(data ?? {})) {
      if (k === 'fields' || k === 'answers' || k === 'score' || k === 'slot_iso') continue
      push(k, v)
    }
  }
  return out
}

function pickField(
  fields: Array<{ key: string; value: string }>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    const m = fields.find((f) => f.key.toLowerCase() === k.toLowerCase())
    if (m) return m.value
  }
  return undefined
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.map(formatVal).join(', ')
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${humanize(k)}: ${formatVal(val)}`)
      .join(' · ')
  }
  return String(v)
}

function humanize(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

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

function currencySymbol(currency: string): string {
  const c = currency.toUpperCase()
  if (c === 'PHP') return '₱'
  if (c === 'USD') return '$'
  if (c === 'EUR') return '€'
  if (c === 'GBP') return '£'
  return c ? c + ' ' : ''
}
