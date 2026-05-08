'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface CatalogOrderItem {
  title: string
  quantity: number
  unitAmount: number
  lineTotalAmount: number
  currency: string
}

export interface CatalogOrderEntry {
  id: string
  shortId: string
  createdAt: string
  dateKey: string
  paymentStatus: 'unpaid' | 'pending' | 'paid' | 'failed' | 'refunded'
  currency: string
  subtotalAmount: number
  customerName: string | null
  customerEmail: string | null
  customerPhone: string | null
  customerNotes: string | null
  items: CatalogOrderItem[]
  source: 'Messenger' | 'Web'
  leadId: string | null
}

interface Props {
  orders: CatalogOrderEntry[]
  pageTitle: string
  pageStatus: 'draft' | 'published' | 'archived'
  pageId: string
}

type FilterTab = 'all' | 'paid' | 'pending' | 'refunded'

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

const CURRENCY_SYMBOLS: Record<string, string> = {
  PHP: '₱', USD: '$', EUR: '€', GBP: '£', JPY: '¥', SGD: 'S$',
}

function currencySymbol(code: string) {
  return CURRENCY_SYMBOLS[code.toUpperCase()] ?? code + ' '
}

function fmtMoney(amount: number, currency: string) {
  const sym = currencySymbol(currency)
  if (amount >= 1000) {
    return `${sym}${(amount / 1000).toFixed(1)}k`
  }
  return `${sym}${amount.toLocaleString()}`
}

function fmtMoneyFull(amount: number, currency: string) {
  return `${currencySymbol(currency)}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function relTime(isoStr: string) {
  const ms = Date.now() - new Date(isoStr).getTime()
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

function formatDateLabel(dateKey: string) {
  return new Date(dateKey + 'T12:00:00Z').toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  })
}

function initials(name: string | null) {
  if (!name) return '?'
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('')
}

function normalizeStatus(s: CatalogOrderEntry['paymentStatus']): FilterTab {
  if (s === 'paid') return 'paid'
  if (s === 'refunded') return 'refunded'
  return 'pending'
}

/* ------------------------------------------------------------------ */
/*  Status meta                                                         */
/* ------------------------------------------------------------------ */

const STATUS_META: Record<string, { label: string; dot: string; bg: string; ink: string }> = {
  paid:     { label: 'Paid',     dot: '#1F7A4D', bg: 'rgba(31,122,77,0.10)',  ink: '#1F5C3A' },
  pending:  { label: 'Pending',  dot: '#B57614', bg: 'rgba(181,118,20,0.10)', ink: '#825414' },
  refunded: { label: 'Refunded', dot: '#6B6960', bg: 'rgba(107,105,96,0.10)', ink: '#4A4843' },
  failed:   { label: 'Failed',   dot: '#B23A2B', bg: 'rgba(178,58,43,0.10)',  ink: '#7A1E14' },
  unpaid:   { label: 'Pending',  dot: '#B57614', bg: 'rgba(181,118,20,0.10)', ink: '#825414' },
}

const SOURCE_META: Record<string, { color: string }> = {
  Messenger: { color: '#2563EB' },
  Web:       { color: '#6B6960' },
}

/* ------------------------------------------------------------------ */
/*  Main component                                                      */
/* ------------------------------------------------------------------ */

export default function CatalogOrdersView({ orders, pageTitle, pageStatus, pageId }: Props) {
  const [filter, setFilter] = useState<FilterTab>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<CatalogOrderEntry | null>(null)

  /* ---- Counts ---- */
  const counts = useMemo(() => ({
    all: orders.length,
    paid: orders.filter(o => o.paymentStatus === 'paid').length,
    pending: orders.filter(o => normalizeStatus(o.paymentStatus) === 'pending').length,
    refunded: orders.filter(o => o.paymentStatus === 'refunded').length,
  }), [orders])

  /* ---- Stats ---- */
  const stats = useMemo(() => {
    const now = new Date()
    const todayKey = now.toISOString().slice(0, 10)
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const todayCount = orders.filter(o => o.dateKey === todayKey && o.paymentStatus !== 'refunded').length
    const paidOrders = orders.filter(o => o.paymentStatus === 'paid')
    const weekRev = paidOrders.filter(o => new Date(o.createdAt) >= weekAgo).reduce((s, o) => s + o.subtotalAmount, 0)
    const monthRev = paidOrders.filter(o => new Date(o.createdAt) >= monthStart).reduce((s, o) => s + o.subtotalAmount, 0)
    const aov = paidOrders.length ? Math.round(paidOrders.reduce((s, o) => s + o.subtotalAmount, 0) / paidOrders.length) : 0
    const currency = orders[0]?.currency ?? 'PHP'

    return { todayCount, weekRev, monthRev, aov, currency }
  }, [orders])

  /* ---- Filtered + searched ---- */
  const filtered = useMemo(() => {
    let list = orders
    if (filter !== 'all') {
      list = list.filter(o => normalizeStatus(o.paymentStatus) === filter)
    }
    if (query) {
      const q = query.toLowerCase()
      list = list.filter(o => [
        o.customerName ?? '',
        o.customerEmail ?? '',
        o.customerPhone ?? '',
        o.shortId,
        ...o.items.map(i => i.title),
      ].join(' ').toLowerCase().includes(q))
    }
    return list
  }, [orders, filter, query])

  /* ---- Grouped by date ---- */
  const grouped = useMemo(() => {
    const map = new Map<string, CatalogOrderEntry[]>()
    for (const o of filtered) {
      if (!map.has(o.dateKey)) map.set(o.dateKey, [])
      map.get(o.dateKey)!.push(o)
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [filtered])

  const todayKey = new Date().toISOString().slice(0, 10)

  return (
    <div className="min-h-screen pb-16" style={{ background: '#FAFAF7' }}>
      {/* ── Topbar ── */}
      <div
        className="sticky top-0 z-10 flex items-center gap-4 border-b px-7 py-3.5"
        style={{ background: '#FAFAF7', borderColor: '#E8E6DE' }}
      >
        <Link
          href={`/dashboard/action-pages/${pageId}`}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors"
          style={{ color: '#6B6960' }}
        >
          <ChevronLeftIcon size={14} />
          Back
        </Link>
        <nav className="flex items-center gap-1.5 text-[13px]" style={{ color: '#6B6960' }}>
          <Link href="/dashboard/action-pages" className="hover:underline" style={{ color: '#6B6960' }}>
            Action Pages
          </Link>
          <ChevronRightIcon size={12} />
          <Link href={`/dashboard/action-pages/${pageId}`} className="hover:underline" style={{ color: '#6B6960' }}>
            {pageTitle}
          </Link>
          <ChevronRightIcon size={12} />
          <span style={{ color: '#1A1915', fontWeight: 500 }}>Orders</span>
        </nav>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-white"
            style={{ borderColor: '#D9D6CC', color: '#3F3D36', background: 'transparent' }}
          >
            <DownloadIcon size={13} />
            Export CSV
          </button>
          <Link
            href={`/dashboard/action-pages/${pageId}`}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors hover:opacity-80"
            style={{ borderColor: '#D9D6CC', color: '#3F3D36', background: '#FFFFFF' }}
          >
            <PencilIcon size={13} />
            Edit page
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-7">
        {/* ── Hero ── */}
        <div className="pb-2 pt-8">
          <div className="mb-3 flex items-center gap-1.5 text-[12px] font-medium" style={{ color: '#6B6960' }}>
            <LayersIcon size={13} />
            <span>
              Products ·{' '}
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                style={{
                  background: pageStatus === 'published' ? 'rgba(31,122,77,0.10)' : '#EFEEE8',
                  color: pageStatus === 'published' ? '#1F5C3A' : '#6B6960',
                }}
              >
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ background: pageStatus === 'published' ? '#1F7A4D' : '#9C9A90' }}
                />
                {pageStatus === 'published' ? 'Live' : pageStatus === 'draft' ? 'Draft' : 'Archived'}
              </span>
            </span>
          </div>
          <h1
            className="mb-1 text-[32px] leading-tight tracking-tight"
            style={{ fontFamily: 'var(--font-instrument-serif, serif)', color: '#1A1915' }}
          >
            Orders
          </h1>
          <p className="text-[14px]" style={{ color: '#6B6960' }}>
            Every checkout from your Products page, with revenue and customer details.
          </p>
        </div>

        {/* ── Stats ── */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Today"
            value={String(stats.todayCount)}
            foot={`order${stats.todayCount !== 1 ? 's' : ''}`}
            accent
          />
          <StatCard
            label="Revenue · this week"
            value={fmtMoney(stats.weekRev, stats.currency)}
            foot="paid orders only"
          />
          <StatCard
            label="Revenue · this month"
            value={fmtMoney(stats.monthRev, stats.currency)}
            foot={orders.length > 0 ? 'paid orders only' : '—'}
          />
          <StatCard
            label="Avg order value"
            value={`${currencySymbol(stats.currency)}${stats.aov.toLocaleString()}`}
            foot="across paid orders"
          />
        </div>

        {/* ── Toolbar ── */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-0.5 rounded-lg border p-1" style={{ borderColor: '#E8E6DE', background: '#FFFFFF' }}>
            {([
              { id: 'all', label: 'All' },
              { id: 'paid', label: 'Paid' },
              { id: 'pending', label: 'Pending' },
              { id: 'refunded', label: 'Refunded' },
            ] as { id: FilterTab; label: string }[]).map(t => (
              <button
                key={t.id}
                onClick={() => setFilter(t.id)}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-all"
                style={filter === t.id
                  ? { background: '#FAFAF7', color: '#1A1915', boxShadow: '0 0 0 1px #E8E6DE, 0 1px 2px rgba(0,0,0,0.04)' }
                  : { color: '#6B6960', background: 'transparent' }
                }
              >
                {t.label}
                <span
                  className="rounded-full px-1.5 py-0 text-[11px] font-semibold tabular-nums"
                  style={{ background: filter === t.id ? '#EFEEE8' : '#F6F5F1', color: '#6B6960' }}
                >
                  {counts[t.id]}
                </span>
              </button>
            ))}
          </div>
          <div
            className="flex flex-1 items-center gap-2 rounded-lg border px-3 py-2 sm:max-w-xs"
            style={{ borderColor: '#E8E6DE', background: '#FFFFFF' }}
          >
            <SearchIcon size={14} color="#9C9A90" />
            <input
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-[#9C9A90]"
              placeholder="Search by customer, product, or order ID…"
              value={query}
              onChange={e => setQuery(e.target.value)}
              style={{ color: '#1A1915' }}
            />
          </div>
        </div>

        {/* ── Timeline ── */}
        <div className="mt-6">
          {grouped.length === 0 ? (
            <EmptyState hasOrders={orders.length > 0} />
          ) : (
            <div className="space-y-8">
              {grouped.map(([date, dayOrders]) => {
                const isToday = date === todayKey
                const dayRev = dayOrders.filter(o => o.paymentStatus === 'paid').reduce((s, o) => s + o.subtotalAmount, 0)
                const currency = dayOrders[0]?.currency ?? 'PHP'
                return (
                  <div key={date}>
                    {/* Day header */}
                    <div className="mb-3 flex items-center gap-3">
                      <div className="flex items-center gap-2">
                        {isToday && (
                          <span
                            className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                            style={{ background: '#1F7A4D', color: '#FFFFFF' }}
                          >
                            TODAY
                          </span>
                        )}
                        <span className="text-[14px] font-semibold" style={{ color: '#1A1915' }}>
                          {formatDateLabel(date)}
                        </span>
                      </div>
                      <div className="flex-1 border-t" style={{ borderColor: '#E8E6DE' }} />
                      <div className="flex items-center gap-1.5 text-[12px]" style={{ color: '#9C9A90' }}>
                        <span>{dayOrders.length} order{dayOrders.length !== 1 ? 's' : ''}</span>
                        {dayRev > 0 && (
                          <>
                            <span>·</span>
                            <span style={{ color: '#6B6960' }}>
                              {currencySymbol(currency)}{dayRev.toLocaleString()}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Order rows */}
                    <div className="space-y-2">
                      {dayOrders.map(o => (
                        <OrderRow key={o.id} order={o} onClick={() => setSelected(o)} />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Drawer ── */}
      {selected && (
        <OrderDrawer order={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Stat Card                                                           */
/* ------------------------------------------------------------------ */

function StatCard({ label, value, foot, accent }: { label: string; value: string; foot: string; accent?: boolean }) {
  return (
    <div
      className="rounded-xl px-4 py-3.5"
      style={{
        background: accent ? 'rgba(31,122,77,0.08)' : '#FFFFFF',
        border: '1px solid',
        borderColor: accent ? 'rgba(31,122,77,0.12)' : '#E8E6DE',
      }}
    >
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide" style={{ color: accent ? '#1F5C3A' : '#6B6960' }}>
        {label}
      </div>
      <div className="text-[26px] font-bold leading-none tabular-nums" style={{ color: accent ? '#1F7A4D' : '#1A1915', fontFamily: 'var(--font-geist-mono, monospace)' }}>
        {value}
      </div>
      <div className="mt-1 text-[11px]" style={{ color: accent ? '#2EA86A' : '#9C9A90' }}>
        {foot}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Order Row                                                           */
/* ------------------------------------------------------------------ */

function OrderRow({ order: o, onClick }: { order: CatalogOrderEntry; onClick: () => void }) {
  const sm = STATUS_META[o.paymentStatus] ?? STATUS_META.pending
  const srcMeta = SOURCE_META[o.source] ?? SOURCE_META.Web
  const ini = initials(o.customerName)
  const displayName = o.customerName ?? 'Anonymous'
  const primaryItem = o.items[0]

  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-4 rounded-xl border px-4 py-3.5 text-left transition-all hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
      style={{ background: '#FFFFFF', borderColor: '#E8E6DE' }}
    >
      {/* Avatar */}
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
        style={{ background: 'linear-gradient(135deg, #1F7A4D, #2EA86A)' }}
      >
        {ini}
      </div>

      {/* Center meta */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-semibold" style={{ color: '#1A1915' }}>
            {displayName}
          </span>
          <code
            className="rounded px-1.5 py-0.5 text-[11px] font-medium"
            style={{ background: '#F6F5F1', color: '#6B6960', fontFamily: 'var(--font-geist-mono, monospace)' }}
          >
            {o.shortId}
          </code>
          <span
            className="flex items-center gap-1 text-[11px] font-medium"
            style={{ color: srcMeta.color }}
          >
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{ background: srcMeta.color }}
            />
            {o.source}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-[12px]" style={{ color: '#6B6960' }}>
          {primaryItem && (
            <>
              <span className="truncate max-w-[200px]">{primaryItem.title}</span>
              {o.items.length > 1 && (
                <span style={{ color: '#9C9A90' }}>
                  + {o.items.length - 1} more
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Tail */}
      <div className="flex shrink-0 items-center gap-3">
        {/* Status pill */}
        <span
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium"
          style={{ background: sm.bg, color: sm.ink }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: sm.dot }} />
          {sm.label}
        </span>
        {/* Total */}
        <span className="min-w-[64px] text-right text-[14px] font-semibold" style={{ color: '#1A1915' }}>
          {currencySymbol(o.currency)}{o.subtotalAmount.toLocaleString()}
        </span>
        {/* Time ago */}
        <span className="hidden text-[12px] sm:block" style={{ color: '#9C9A90' }}>
          {relTime(o.createdAt)}
        </span>
        <ChevronRightIcon size={14} color="#D9D6CC" />
      </div>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/*  Order Drawer                                                        */
/* ------------------------------------------------------------------ */

function OrderDrawer({ order: o, onClose }: { order: CatalogOrderEntry; onClose: () => void }) {
  const sm = STATUS_META[o.paymentStatus] ?? STATUS_META.pending
  const ini = initials(o.customerName)
  const displayName = o.customerName ?? 'Anonymous'
  const subtotal = o.subtotalAmount
  const currency = o.currency

  const placedDate = new Date(o.createdAt).toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
  const placedTime = new Date(o.createdAt).toLocaleTimeString(undefined, {
    hour: 'numeric', minute: '2-digit',
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end"
      style={{ background: 'rgba(26,25,21,0.25)' }}
      onClick={onClose}
    >
      <aside
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l"
        style={{ background: '#FAFAF7', borderColor: '#E8E6DE' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Drawer head */}
        <div className="flex items-center gap-3 border-b px-5 py-4" style={{ borderColor: '#E8E6DE' }}>
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #1F7A4D, #2EA86A)' }}
          >
            {ini}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold" style={{ color: '#1A1915' }}>{displayName}</div>
            <div className="text-[12px]" style={{ color: '#9C9A90' }}>
              Order {o.shortId} · {relTime(o.createdAt)}
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[#EFEEE8]"
          >
            <XIcon size={14} />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          {/* Status + Total summary */}
          <div className="flex items-center justify-between">
            <span
              className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium"
              style={{ background: sm.bg, color: sm.ink }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: sm.dot }} />
              {sm.label}
            </span>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-wide" style={{ color: '#9C9A90' }}>Total</div>
              <div className="text-[18px] font-bold" style={{ color: '#1A1915', fontFamily: 'var(--font-instrument-serif, serif)' }}>
                {fmtMoneyFull(subtotal, currency)}
              </div>
            </div>
          </div>

          {/* Date card */}
          <div
            className="flex items-center gap-3 rounded-xl px-4 py-3"
            style={{ background: '#FFFFFF', border: '1px solid #E8E6DE' }}
          >
            <CalendarIcon size={16} color="#6B6960" />
            <div>
              <div className="text-[13px] font-medium" style={{ color: '#1A1915' }}>{placedDate}</div>
              <div className="text-[12px]" style={{ color: '#9C9A90' }}>
                Placed at {placedTime} · via {o.source}
              </div>
            </div>
          </div>

          {/* Line items */}
          <div>
            <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#9C9A90' }}>
              Items
            </h4>
            <div
              className="overflow-hidden rounded-xl border"
              style={{ borderColor: '#E8E6DE' }}
            >
              {o.items.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 px-4 py-3"
                  style={{
                    background: '#FFFFFF',
                    borderBottom: idx < o.items.length - 1 ? '1px solid #F6F5F1' : undefined,
                  }}
                >
                  <div
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white"
                    style={{ background: 'linear-gradient(135deg, #1F7A4D, #2EA86A)' }}
                  >
                    ✦
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium" style={{ color: '#1A1915' }}>
                      {item.title}
                    </div>
                    <div className="text-[11px]" style={{ color: '#9C9A90' }}>
                      {currencySymbol(item.currency)}{item.unitAmount.toLocaleString()} × {item.quantity}
                    </div>
                  </div>
                  <div className="text-[13px] font-semibold" style={{ color: '#1A1915' }}>
                    {currencySymbol(item.currency)}{item.lineTotalAmount.toLocaleString()}
                  </div>
                </div>
              ))}
              {/* Totals */}
              <div className="border-t px-4 py-3" style={{ background: '#FAFAF7', borderColor: '#E8E6DE' }}>
                <div className="flex items-center justify-between text-[12px]" style={{ color: '#6B6960' }}>
                  <span>Subtotal</span>
                  <span>{fmtMoneyFull(subtotal, currency)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between text-[12px]" style={{ color: '#6B6960' }}>
                  <span>Tax</span>
                  <span>—</span>
                </div>
                <div
                  className="mt-2 flex items-center justify-between border-t pt-2 text-[14px] font-semibold"
                  style={{ borderColor: '#E8E6DE', color: '#1A1915' }}
                >
                  <span>Total</span>
                  <span>{fmtMoneyFull(subtotal, currency)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Customer */}
          <div>
            <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#9C9A90' }}>
              Customer
            </h4>
            <div
              className="overflow-hidden rounded-xl border"
              style={{ borderColor: '#E8E6DE', background: '#FFFFFF' }}
            >
              <FieldRow label="Name" value={displayName} />
              {o.customerEmail && <FieldRow label="Email" value={o.customerEmail} />}
              {o.customerPhone && <FieldRow label="Phone" value={o.customerPhone} />}
            </div>
          </div>

          {/* Notes */}
          {o.customerNotes && (
            <div>
              <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide" style={{ color: '#9C9A90' }}>
                Notes
              </h4>
              <div
                className="rounded-xl border px-4 py-3 text-[13px]"
                style={{ borderColor: '#E8E6DE', background: '#FFFFFF', color: '#3F3D36' }}
              >
                {o.customerNotes}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2 border-t pt-4" style={{ borderColor: '#E8E6DE' }}>
            {o.leadId && (
              <Link
                href={`/dashboard/leads?lead=${o.leadId}`}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors hover:bg-[#EFEEE8]"
                style={{ borderColor: '#D9D6CC', color: '#3F3D36' }}
              >
                <PersonIcon size={13} />
                View lead
              </Link>
            )}
            <button
              className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors hover:bg-[#EFEEE8]"
              style={{ borderColor: '#D9D6CC', color: '#3F3D36' }}
              onClick={() => {
                const text = [
                  `Order ${o.shortId}`,
                  `Customer: ${displayName}`,
                  o.customerEmail ? `Email: ${o.customerEmail}` : '',
                  o.customerPhone ? `Phone: ${o.customerPhone}` : '',
                  `Items: ${o.items.map(i => `${i.title} ×${i.quantity}`).join(', ')}`,
                  `Total: ${fmtMoneyFull(o.subtotalAmount, o.currency)}`,
                  `Status: ${STATUS_META[o.paymentStatus]?.label ?? o.paymentStatus}`,
                ].filter(Boolean).join('\n')
                void navigator.clipboard.writeText(text)
              }}
            >
              <CopyIcon size={13} />
              Copy
            </button>
          </div>
        </div>
      </aside>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Field Row (drawer)                                                  */
/* ------------------------------------------------------------------ */

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b px-4 py-2.5 last:border-b-0" style={{ borderColor: '#F6F5F1' }}>
      <span className="w-16 shrink-0 text-[11px] font-medium uppercase tracking-wide" style={{ color: '#9C9A90' }}>
        {label}
      </span>
      <span className="truncate text-[13px]" style={{ color: '#3F3D36' }}>{value}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Empty State                                                         */
/* ------------------------------------------------------------------ */

function EmptyState({ hasOrders }: { hasOrders: boolean }) {
  return (
    <div
      className="rounded-xl border border-dashed px-6 py-16 text-center"
      style={{ borderColor: '#D9D6CC', background: '#FFFFFF' }}
    >
      <div
        className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ background: '#F0FDF4' }}
      >
        <LayersIcon size={26} color="#1F7A4D" />
      </div>
      <h3 className="mb-1 text-[15px] font-semibold" style={{ color: '#1A1915' }}>
        {hasOrders ? 'No orders match' : 'No orders yet'}
      </h3>
      <p className="text-[13px]" style={{ color: '#6B6960' }}>
        {hasOrders
          ? 'Try another filter or clear your search.'
          : 'Checkout submissions will appear once customers place an order.'}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Icons                                                               */
/* ------------------------------------------------------------------ */

function ChevronLeftIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

function ChevronRightIcon({ size = 16, color }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? 'currentColor'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

function LayersIcon({ size = 16, color }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? 'currentColor'} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2l9 5-9 5-9-5 9-5z" />
      <path d="M3 12l9 5 9-5M3 17l9 5 9-5" />
    </svg>
  )
}

function SearchIcon({ size = 16, color }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? 'currentColor'} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function DownloadIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function PencilIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function CalendarIcon({ size = 16, color }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? 'currentColor'} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}

function XIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function PersonIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  )
}

function CopyIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  )
}
