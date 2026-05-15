'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export interface BookingEntry {
  id: string
  slotIso: string | null      // original ISO string or null
  dateKey: string             // 'YYYY-MM-DD' derived from slotIso or createdAt
  timeShort: string           // e.g. '10' or '10:30'
  meridiem: string            // 'AM' or 'PM'
  name: string                // display name
  initials: string            // 1–2 char initials
  phone: string
  source: 'Messenger' | 'Web'
  status: 'upcoming' | 'completed' | 'no-show' | 'failed'
  createdAt: string           // ISO string of submission created_at
  leadId: string | null
  outcome: string | null
  messengerName: string | null
}

interface Props {
  entries: BookingEntry[]
  pageTitle: string
  pageStatus: 'draft' | 'published' | 'archived'
  pageId: string
}

type ViewMode = 'calendar' | 'timeline' | 'table'
type FilterTab = 'all' | 'upcoming' | 'completed' | 'no-show'

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function BookingSubmissionsView({ entries, pageTitle, pageStatus, pageId }: Props) {
  const now = new Date()
  const todayKey = toDateKey(now)
  const todayY = now.getFullYear()
  const todayM = now.getMonth()

  const [filter, setFilter] = useState<FilterTab>('all')
  const [query, setQuery] = useState('')
  const [view, setView] = useState<ViewMode>('calendar')
  const [selectedEntry, setSelectedEntry] = useState<BookingEntry | null>(null)
  const [viewMonth, setViewMonth] = useState<Date>(new Date(todayY, todayM, 1))
  const [pickedDay, setPickedDay] = useState<string>(todayKey)

  /* ---- Derived counts ---- */
  const counts = useMemo(() => ({
    all: entries.length,
    upcoming: entries.filter(e => e.status === 'upcoming').length,
    completed: entries.filter(e => e.status === 'completed').length,
    'no-show': entries.filter(e => e.status === 'no-show').length,
  }), [entries])

  /* ---- Stats ---- */
  const stats = useMemo(() => {
    const n = new Date()
    const todK = toDateKey(n)
    const weekAgo = new Date(n.getTime() - 7 * 24 * 60 * 60 * 1000)
    const monthStart = new Date(n.getFullYear(), n.getMonth(), 1)

    const booked = entries.filter(e => e.outcome === 'booked' || e.status === 'upcoming' || e.status === 'completed')
    const todayCount = entries.filter(e => e.dateKey === todK).length
    const weekCount = entries.filter(e => e.slotIso ? new Date(e.slotIso) >= weekAgo : new Date(e.createdAt) >= weekAgo).length
    const monthCount = entries.filter(e => e.slotIso ? new Date(e.slotIso) >= monthStart : new Date(e.createdAt) >= monthStart).length
    const noShows = entries.filter(e => e.status === 'no-show').length
    const completedCount = entries.filter(e => e.status === 'completed').length
    const showRate = completedCount + noShows > 0
      ? Math.round((completedCount / (completedCount + noShows)) * 100)
      : null

    return { todayCount, weekCount, monthCount, showRate, bookedTotal: booked.length }
  }, [entries])

  /* ---- Filtered entries ---- */
  const filtered = useMemo(() => {
    let list = entries
    if (filter !== 'all') list = list.filter(e => e.status === filter)
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter(e =>
        e.name.toLowerCase().includes(q) ||
        e.phone.toLowerCase().includes(q) ||
        e.dateKey.includes(q)
      )
    }
    return list
  }, [entries, filter, query])

  /* ---- Calendar data ---- */
  const calYear = viewMonth.getFullYear()
  const calMonth = viewMonth.getMonth()

  const calCells = useMemo(() => {
    const firstDay = new Date(calYear, calMonth, 1)
    const lastDay = new Date(calYear, calMonth + 1, 0)
    const startDow = firstDay.getDay()
    const cells: { dateKey: string; day: number; inMonth: boolean }[] = []

    // Days from prev month
    for (let i = 0; i < startDow; i++) {
      const d = new Date(calYear, calMonth, -startDow + 1 + i)
      cells.push({ dateKey: toDateKey(d), day: d.getDate(), inMonth: false })
    }
    // Days in month
    for (let d = 1; d <= lastDay.getDate(); d++) {
      cells.push({ dateKey: toDateKey(new Date(calYear, calMonth, d)), day: d, inMonth: true })
    }
    // Days from next month
    const remaining = 42 - cells.length
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(calYear, calMonth + 1, i)
      cells.push({ dateKey: toDateKey(d), day: d.getDate(), inMonth: false })
    }
    return cells
  }, [calYear, calMonth])

  const byDateKey = useMemo(() => {
    const map = new Map<string, BookingEntry[]>()
    for (const e of filtered) {
      const arr = map.get(e.dateKey) ?? []
      arr.push(e)
      map.set(e.dateKey, arr)
    }
    return map
  }, [filtered])

  const pickedEntries = byDateKey.get(pickedDay) ?? []

  /* ---- Timeline grouped days ---- */
  const timelineDays = useMemo(() => {
    const map = new Map<string, BookingEntry[]>()
    for (const e of filtered) {
      const arr = map.get(e.dateKey) ?? []
      arr.push(e)
      map.set(e.dateKey, arr)
    }
    return [...map.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([dk, items]) => ({
        dateKey: dk,
        items: items.sort((a, b) => (a.slotIso ?? a.createdAt).localeCompare(b.slotIso ?? b.createdAt)),
      }))
  }, [filtered])

  /* ---- Sorted table entries ---- */
  const tableEntries = useMemo(() =>
    [...filtered].sort((a, b) => (b.slotIso ?? b.createdAt).localeCompare(a.slotIso ?? a.createdAt)),
    [filtered])

  /* ---- Export CSV ---- */
  function handleExport() {
    const rows: string[] = [
      ['ID', 'Name', 'Phone', 'Date', 'Time', 'Source', 'Status', 'Lead ID', 'Created At'].join(','),
    ]
    for (const e of entries) {
      rows.push([
        csv(e.id), csv(e.name), csv(e.phone),
        csv(e.dateKey), csv(`${e.timeShort} ${e.meridiem}`),
        csv(e.source), csv(e.status), csv(e.leadId ?? ''),
        csv(e.createdAt),
      ].join(','))
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `bookings-${pageId}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  /* ---- Month label ---- */
  const monthLabel = viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const tomorrowKey = toDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000))

  return (
    <div data-subs-booking="">
      <div className="bsv-wrap">

        {/* ---- Topbar ---- */}
        <div className="bsv-topbar">
          <Link href="/dashboard/action-pages" className="bsv-back">
            <ChevronLeftIcon size={14} />
            Back
          </Link>
          <div className="bsv-crumbs">
            <span>/</span>
            <Link href="/dashboard/action-pages">Action Pages</Link>
            <span>/</span>
            <Link href={`/dashboard/action-pages/${pageId}`}>{pageTitle}</Link>
            <span>/</span>
            <span className="bsv-crumbs-current">Submissions</span>
          </div>
          <div className="bsv-topbar-spacer" />
          <div className="bsv-topbar-actions">
            <button onClick={handleExport} className="bsv-btn">
              <DownloadIcon size={13} />
              Export CSV
            </button>
            <Link href={`/dashboard/action-pages/${pageId}`} className="bsv-btn">
              <PencilIcon size={12} />
              Edit page
            </Link>
          </div>
        </div>

        {/* ---- Hero ---- */}
        <div className="bsv-hero">
          <div className="bsv-eyebrow">
            <CalendarIcon size={13} />
            {pageTitle}
            <span>&nbsp;·&nbsp;</span>
            {pageStatus === 'published' ? (
              <>
                <span className="bsv-eyebrow-dot" />
                Live
              </>
            ) : (
              <span style={{ textTransform: 'capitalize' }}>{pageStatus}</span>
            )}
          </div>
          <h1>Bookings</h1>
          <p className="bsv-hero-sub">
            {entries.length === 0
              ? 'No bookings yet. Submissions will appear once leads book a slot.'
              : `${entries.length} total booking${entries.length !== 1 ? 's' : ''} across all time.`}
          </p>
        </div>

        {/* ---- Stats strip ---- */}
        <div className="bsv-stats">
          <div className="bsv-stat-card bsv-stat-accent">
            <div className="bsv-stat-label">Today</div>
            <div className="bsv-stat-value">{stats.todayCount}</div>
            <div className="bsv-stat-foot">bookings on {formatShortDate(new Date())}</div>
          </div>
          <div className="bsv-stat-card">
            <div className="bsv-stat-label">This week</div>
            <div className="bsv-stat-value">{stats.weekCount}</div>
            <div className="bsv-stat-foot">last 7 days</div>
          </div>
          <div className="bsv-stat-card">
            <div className="bsv-stat-label">This month</div>
            <div className="bsv-stat-value">{stats.monthCount}</div>
            <div className="bsv-stat-foot">{new Date().toLocaleDateString(undefined, { month: 'long' })}</div>
          </div>
          <div className="bsv-stat-card">
            <div className="bsv-stat-label">Show rate</div>
            <div className="bsv-stat-value">{stats.showRate !== null ? `${stats.showRate}%` : '—'}</div>
            <div className="bsv-stat-foot">completed vs no-shows</div>
          </div>
        </div>

        {/* ---- Toolbar ---- */}
        <div className="bsv-toolbar">
          <div className="bsv-filter-tabs">
            {(['all', 'upcoming', 'completed', 'no-show'] as FilterTab[]).map(tab => (
              <button
                key={tab}
                className={`bsv-filter-tab${filter === tab ? ' active' : ''}`}
                onClick={() => setFilter(tab)}
              >
                {TAB_LABELS[tab]}
                <span className="bsv-filter-count">{counts[tab]}</span>
              </button>
            ))}
          </div>
          <div className="bsv-toolbar-spacer" />
          <div className="bsv-search">
            <SearchIcon size={14} />
            <input
              placeholder="Search name or phone…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
          <div className="bsv-view-toggle">
            <button
              className={`bsv-vt-btn${view === 'calendar' ? ' active' : ''}`}
              onClick={() => setView('calendar')}
              title="Calendar view"
            >
              <CalendarIcon size={14} />
            </button>
            <button
              className={`bsv-vt-btn${view === 'timeline' ? ' active' : ''}`}
              onClick={() => setView('timeline')}
              title="Timeline view"
            >
              <TimelineIcon size={14} />
            </button>
            <button
              className={`bsv-vt-btn${view === 'table' ? ' active' : ''}`}
              onClick={() => setView('table')}
              title="Table view"
            >
              <TableIcon size={14} />
            </button>
          </div>
        </div>

        {/* ---- Views ---- */}
        {entries.length === 0 ? (
          <div className="bsv-empty">
            <div className="bsv-empty-icon">
              <CalendarIcon size={24} />
            </div>
            <h3>No bookings yet</h3>
            <p>Appointments will appear here once leads book a slot through your action page.</p>
          </div>
        ) : (
          <>
            {/* CALENDAR */}
            {view === 'calendar' && (
              <div className="bsv-cal">
                <div className="bsv-cal-head">
                  <span className="bsv-cal-month">{monthLabel}</span>
                  <div className="bsv-cal-nav">
                    <button
                      className="bsv-cal-nav-btn"
                      onClick={() => setViewMonth(new Date(calYear, calMonth - 1, 1))}
                    >
                      <ChevronLeftIcon size={14} />
                    </button>
                    <button
                      className="bsv-cal-today-btn"
                      onClick={() => {
                        const n = new Date()
                        setViewMonth(new Date(n.getFullYear(), n.getMonth(), 1))
                        setPickedDay(toDateKey(n))
                      }}
                    >
                      Today
                    </button>
                    <button
                      className="bsv-cal-nav-btn"
                      onClick={() => setViewMonth(new Date(calYear, calMonth + 1, 1))}
                    >
                      <ChevronRightIcon size={14} />
                    </button>
                  </div>
                </div>
                <div className="bsv-cal-grid-wrap">
                  {/* Grid */}
                  <div className="bsv-cal-grid">
                    <div className="bsv-cal-dow-row">
                      {DOW.map(d => (
                        <div key={d} className="bsv-cal-dow">{d}</div>
                      ))}
                    </div>
                    <div className="bsv-cal-cells">
                      {calCells.map(cell => {
                        const cellEntries = byDateKey.get(cell.dateKey) ?? []
                        const hasBk = cellEntries.length > 0
                        const isToday = cell.dateKey === todayKey
                        const isPicked = cell.dateKey === pickedDay
                        const cls = [
                          'bsv-cal-cell',
                          !cell.inMonth ? 'other-month' : '',
                          isToday ? 'today' : '',
                          isPicked ? 'picked' : '',
                          hasBk ? 'has' : '',
                        ].filter(Boolean).join(' ')

                        // Source dots
                        const messengerCount = cellEntries.filter(e => e.source === 'Messenger').length
                        const webCount = cellEntries.filter(e => e.source === 'Web').length

                        return (
                          <div
                            key={cell.dateKey}
                            className={cls}
                            onClick={() => {
                              setPickedDay(cell.dateKey)
                            }}
                          >
                            <div className="bsv-cell-num">{cell.day}</div>
                            {hasBk && (
                              <div className="bsv-cell-inner">
                                <div className="bsv-cell-count">{cellEntries.length}</div>
                                <div className="bsv-cell-count-label">
                                  booking{cellEntries.length !== 1 ? 's' : ''}
                                </div>
                                <div className="bsv-cell-dots">
                                  {messengerCount > 0 && (
                                    <span className="bsv-cell-dot" style={{ background: SOURCE_COLOR.Messenger }} />
                                  )}
                                  {webCount > 0 && (
                                    <span className="bsv-cell-dot" style={{ background: SOURCE_COLOR.Web }} />
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  {/* Side panel */}
                  <div className="bsv-cal-side">
                    <div className="bsv-cal-side-head">
                      <div className="bsv-cal-side-day">
                        {formatSideDay(pickedDay, todayKey, tomorrowKey)}
                      </div>
                      <div className="bsv-cal-side-count">
                        {pickedEntries.length === 0
                          ? 'No bookings'
                          : `${pickedEntries.length} booking${pickedEntries.length !== 1 ? 's' : ''}`}
                      </div>
                    </div>
                    <div className="bsv-cal-side-list">
                      {pickedEntries.length === 0 ? (
                        <div className="bsv-cal-empty">No bookings on this day</div>
                      ) : (
                        pickedEntries
                          .sort((a, b) => (a.slotIso ?? a.createdAt).localeCompare(b.slotIso ?? b.createdAt))
                          .map(e => (
                            <div
                              key={e.id}
                              className="bsv-side-row"
                              onClick={() => setSelectedEntry(e)}
                            >
                              <div className="bsv-side-time">
                                <div className="bsv-side-time-h">{e.timeShort || '—'}</div>
                                {e.meridiem && <div className="bsv-side-time-ap">{e.meridiem}</div>}
                              </div>
                              <div className={`bsv-side-avatar${e.name === 'Anonymous' ? ' anon' : ''}`}>
                                {e.initials}
                              </div>
                              <div className="bsv-side-meta">
                                <div className="bsv-side-name">{e.name}</div>
                                {e.phone && <div className="bsv-side-phone">{e.phone}</div>}
                              </div>
                              <StatusPill status={e.status} />
                            </div>
                          ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TIMELINE */}
            {view === 'timeline' && (
              <div className="bsv-timeline">
                {filtered.length === 0 ? (
                  <div className="bsv-empty">
                    <div className="bsv-empty-icon"><CalendarIcon size={24} /></div>
                    <h3>No results</h3>
                    <p>Try adjusting the filter or search query.</p>
                  </div>
                ) : (
                  timelineDays.map(({ dateKey, items }) => {
                    const isToday = dateKey === todayKey
                    const isTomorrow = dateKey === tomorrowKey
                    const label = formatDateLabel(dateKey)
                    return (
                      <div key={dateKey} className="bsv-tl-day">
                        <div className="bsv-tl-day-head">
                          {(isToday || isTomorrow) && (
                            <span className={`bsv-tl-tag${isToday ? ' today' : ' tomorrow'}`}>
                              {isToday ? 'TODAY' : 'TOMORROW'}
                            </span>
                          )}
                          <span className="bsv-tl-label">{label}</span>
                          <div className="bsv-tl-divider" />
                          <span className="bsv-tl-count">
                            {items.length} booking{items.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <div className="bsv-tl-list">
                          {items.map(e => (
                            <div key={e.id} className="bsv-bk-row" onClick={() => setSelectedEntry(e)}>
                              <div className="bsv-bk-time">
                                <div className="bsv-bk-time-h">{e.timeShort || '—'}</div>
                                {e.meridiem && <div className="bsv-bk-time-ap">{e.meridiem}</div>}
                              </div>
                              <div className={`bsv-bk-avatar${e.name === 'Anonymous' ? ' anon' : ''}`}>
                                {e.initials}
                              </div>
                              <div className="bsv-bk-meta">
                                <div className="bsv-bk-name">
                                  {e.name}
                                  <SourcePill source={e.source} />
                                </div>
                                {e.phone && <div className="bsv-bk-phone">{e.phone}</div>}
                              </div>
                              <div className="bsv-bk-tail">
                                <StatusPill status={e.status} />
                                <span style={{ fontSize: 11, color: 'var(--ws-ink-4)' }}>
                                  {relTime(new Date(e.createdAt))}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )}

            {/* TABLE */}
            {view === 'table' && (
              tableEntries.length === 0 ? (
                <div className="bsv-empty">
                  <div className="bsv-empty-icon"><TableIcon size={24} /></div>
                  <h3>No results</h3>
                  <p>Try adjusting the filter or search query.</p>
                </div>
              ) : (
                <div className="bsv-table">
                  <div className="bsv-table-head">
                    <span>When</span>
                    <span>Person</span>
                    <span>Phone</span>
                    <span>Source</span>
                    <span>Status</span>
                  </div>
                  {tableEntries.map(e => (
                    <div key={e.id} className="bsv-table-row" onClick={() => setSelectedEntry(e)}>
                      <div className="bsv-table-when">
                        <div className="bsv-table-date">{formatShortDate(new Date(e.dateKey + 'T12:00:00Z'))}</div>
                        {e.timeShort && (
                          <div className="bsv-table-time">{e.timeShort} {e.meridiem}</div>
                        )}
                      </div>
                      <div className="bsv-table-person">
                        <div className={`bsv-table-avatar${e.name === 'Anonymous' ? ' anon' : ''}`}>
                          {e.initials}
                        </div>
                        <span className="bsv-table-name">{e.name}</span>
                      </div>
                      <div className="bsv-table-phone">{e.phone || '—'}</div>
                      <div><SourcePill source={e.source} /></div>
                      <div><StatusPill status={e.status} /></div>
                    </div>
                  ))}
                </div>
              )
            )}
          </>
        )}
      </div>

      {/* ---- Detail Drawer ---- */}
      {selectedEntry && (
        <Drawer entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Drawer                                                              */
/* ------------------------------------------------------------------ */

function Drawer({ entry: e, onClose }: { entry: BookingEntry; onClose: () => void }) {
  const slotDate = e.slotIso ? new Date(e.slotIso) : null
  const fullDateStr = slotDate
    ? slotDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : 'No slot set'
  const timeStr = slotDate
    ? slotDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : null

  return (
    <>
      <div className="bsv-drawer-overlay" onClick={onClose} />
      <div className="bsv-drawer" data-subs-booking="">
        {/* Head */}
        <div className="bsv-drawer-head">
          <div className={`bsv-drawer-avatar${e.name === 'Anonymous' ? ' anon' : ''}`}>
            {e.initials}
          </div>
          <div className="bsv-drawer-head-meta">
            <div className="bsv-drawer-name">{e.name}</div>
            <div className="bsv-drawer-sub">
              <SourcePill source={e.source} /> &nbsp;
              <StatusPill status={e.status} />
            </div>
          </div>
          <button className="bsv-drawer-close" onClick={onClose}>
            <CloseIcon size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="bsv-drawer-body">
          {/* Time card */}
          <div className="bsv-drawer-card">
            {timeStr ? (
              <div className="bsv-drawer-card-time">{timeStr}</div>
            ) : null}
            <div className="bsv-drawer-card-date">{fullDateStr}</div>
            {!slotDate && (
              <div className="bsv-drawer-card-sub">No slot time recorded</div>
            )}
          </div>

          {/* Contact */}
          <div className="bsv-drawer-section">
            <div className="bsv-drawer-section-title">Contact</div>
            <DrawerRow label="Full name" value={e.name} />
            {e.messengerName && e.messengerName !== e.name ? (
              <DrawerRow label="Facebook name" value={e.messengerName} />
            ) : null}
            <DrawerRow label="Phone" value={e.phone || '—'} />
            <DrawerRow label="Source" value={e.source} />
            <DrawerRow label="Status" value={STATUS_LABELS[e.status] ?? e.status} />
            <DrawerRow label="Booked at" value={relTime(new Date(e.createdAt))} />
          </div>

          {/* Notes */}
          <div className="bsv-drawer-section">
            <div className="bsv-drawer-section-title">Notes</div>
            <div className="bsv-drawer-notes" style={{ color: 'var(--ws-ink-4)', fontStyle: 'italic' }}>
              No notes available for this booking.
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="bsv-drawer-actions">
          {e.leadId ? (
            <Link href={`/dashboard/leads?lead=${e.leadId}`} className="bsv-btn bsv-btn-primary">
              <MessengerIcon size={13} />
              Message
            </Link>
          ) : (
            <button className="bsv-btn" disabled style={{ opacity: 0.4 }}>
              <MessengerIcon size={13} />
              Message
            </button>
          )}
          <button className="bsv-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="bsv-btn" onClick={onClose}>
            Reschedule
          </button>
        </div>
      </div>
    </>
  )
}

function DrawerRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bsv-drawer-row">
      <span className="bsv-drawer-row-label">{label}</span>
      <span className="bsv-drawer-row-value">{value}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Small components                                                    */
/* ------------------------------------------------------------------ */

function StatusPill({ status }: { status: BookingEntry['status'] }) {
  return (
    <span className={`bsv-status-pill ${status}`}>
      {STATUS_LABELS[status]}
    </span>
  )
}

function SourcePill({ source }: { source: BookingEntry['source'] }) {
  return (
    <span className="bsv-source-pill">
      <span className="bsv-source-dot" style={{ background: SOURCE_COLOR[source] }} />
      {source}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const TAB_LABELS: Record<FilterTab, string> = {
  all: 'All',
  upcoming: 'Upcoming',
  completed: 'Completed',
  'no-show': 'No-show',
}

const STATUS_LABELS: Record<string, string> = {
  upcoming: 'Upcoming',
  completed: 'Completed',
  'no-show': 'No-show',
  failed: 'Failed',
}

const SOURCE_COLOR: Record<string, string> = {
  Messenger: '#2563EB',
  Web: '#9C9A90',
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatDateLabel(dateKey: string): string {
  const d = new Date(dateKey + 'T12:00:00Z')
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
}

function formatSideDay(dateKey: string, todayKey: string, tomorrowKey: string): string {
  if (dateKey === todayKey) return 'Today'
  if (dateKey === tomorrowKey) return 'Tomorrow'
  const d = new Date(dateKey + 'T12:00:00Z')
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
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
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(day / 365)}y ago`
}

function csv(val: string): string {
  const s = String(val)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/* ------------------------------------------------------------------ */
/*  Icons                                                               */
/* ------------------------------------------------------------------ */

function CalendarIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  )
}

function ChevronLeftIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="15 6 9 12 15 18" />
    </svg>
  )
}

function ChevronRightIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  )
}

function PencilIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function DownloadIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function SearchIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function TimelineIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  )
}

function TableIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18" />
    </svg>
  )
}

function MessengerIcon({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.145 2 11.243c0 2.908 1.437 5.51 3.687 7.21V22l3.37-1.852C10.077 20.374 11.02 20.5 12 20.5c5.523 0 10-4.145 10-9.257C22 6.145 17.523 2 12 2zm1.05 12.47l-2.55-2.72-4.98 2.72 5.48-5.82 2.6 2.72 4.93-2.72-5.48 5.82z" />
    </svg>
  )
}

function CloseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}
