'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import type { AdminCourseListRow } from '@/lib/university/admin'
import type { AccessLevel, CourseStatus } from '@/lib/university/types'
import { CourseRowMenu } from './CourseRowMenu'

type StatusFilter = 'all' | 'draft' | 'published' | 'archived'

const ACCESS_META: Record<AccessLevel, { label: string; glyph: string }> = {
  public: { label: 'Public', glyph: '○' },
  authenticated: { label: 'Auth', glyph: '◐' },
  subscriber: { label: 'Subscriber', glyph: '🔒' },
}

export function CourseList({
  courses,
  loadError,
}: {
  courses: AdminCourseListRow[]
  loadError?: string | null
}) {
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [query, setQuery] = useState('')

  const counts = useMemo(
    () => ({
      all: courses.length,
      draft: courses.filter((c) => c.status === 'draft').length,
      published: courses.filter((c) => c.status === 'published').length,
      archived: courses.filter((c) => c.status === 'archived').length,
    }),
    [courses],
  )

  const totalLessons = useMemo(
    () => courses.reduce((s, c) => s + (c.lessonCount ?? 0), 0),
    [courses],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return courses.filter((c) => {
      if (filter !== 'all' && c.status !== filter) return false
      if (!q) return true
      return (
        c.title.toLowerCase().includes(q) ||
        c.slug.toLowerCase().includes(q) ||
        (c.category?.name.toLowerCase().includes(q) ?? false)
      )
    })
  }, [courses, filter, query])

  return (
    <div data-actions-list>
      <div data-university-admin>
        <div className="apl-wrap">
          <div className="apl-hero">
            <div className="apl-hero-meta">
              <div className="apl-eyebrow">
                <MortarboardIcon size={13} /> <span>Superadmin · University</span>
              </div>
              <h1>Courses</h1>
              <p>
                Every course in the library — drafts, live and archived. Add lessons,
                set access, and publish when a course is ready.
              </p>
            </div>
            <div className="apl-hero-actions">
              <Link href="/dashboard/university/new" className="ap-btn ap-btn-primary">
                <PlusIcon /> New course
              </Link>
            </div>
          </div>

          <div className="apl-stats">
            <div className="apl-stat">
              <div className="apl-stat-label">Total courses</div>
              <div className="apl-stat-value">{counts.all}</div>
              <div className="apl-stat-foot">
                {counts.draft} draft{counts.draft === 1 ? '' : 's'}
              </div>
            </div>
            <div className="apl-stat">
              <div className="apl-stat-label">Live</div>
              <div className="apl-stat-value">{counts.published}</div>
              <div className="apl-stat-foot">
                <span className="apl-live-dot" />
                {counts.published > 0 ? 'Published in catalog' : 'Nothing published'}
              </div>
            </div>
            <div className="apl-stat">
              <div className="apl-stat-label">Lessons</div>
              <div className="apl-stat-value">{totalLessons}</div>
              <div className="apl-stat-foot">across all courses</div>
            </div>
          </div>

          <div className="apl-toolbar">
            <div className="apl-filter-tabs" role="tablist">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'draft', label: 'Drafts' },
                  { id: 'published', label: 'Published' },
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
                  placeholder="Search courses…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Search courses"
                />
              </div>
            </div>
          </div>

          {loadError ? (
            <div
              role="alert"
              style={{
                border: '1px solid var(--ws-border)',
                background: 'var(--ws-warn-soft)',
                color: 'var(--ws-warn)',
                borderRadius: 14,
                padding: '14px 18px',
                fontSize: 13.5,
              }}
            >
              We couldn&rsquo;t load the course library. {loadError}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState hasCourses={courses.length > 0} onClear={() => { setFilter('all'); setQuery('') }} />
          ) : (
            <div className="apl-table">
              <div className="apl-th uni-courses-th">
                <div>Course</div>
                <div>Access</div>
                <div>Status</div>
                <div>Lessons</div>
                <div>Updated</div>
                <div />
              </div>
              {filtered.map((c) => (
                <CourseRow key={c.id} course={c} />
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`
        [data-actions-list] .uni-courses-th,
        [data-actions-list] .uni-courses-tr {
          grid-template-columns: 2.6fr 1fr 1fr 0.8fr 1fr 56px;
        }
        [data-actions-list] .uni-courses-tr { cursor: default; }
        [data-actions-list] .uni-courses-tr:hover { background: var(--ws-surface); }
        [data-actions-list] .uni-thumb {
          width: 56px; height: 36px; border-radius: 8px; flex-shrink: 0;
          object-fit: cover; background: var(--ws-surface-3);
          display: grid; place-items: center; color: var(--ws-ink-4);
          overflow: hidden;
        }
        [data-actions-list] .uni-lesson-count {
          font-family: var(--font-geist-mono), ui-monospace, monospace;
          font-size: 13px; font-weight: 600; color: var(--ws-ink);
        }
      `}</style>
    </div>
  )
}

function CourseRow({ course }: { course: AdminCourseListRow }) {
  const access = ACCESS_META[course.accessLevel]
  const updated = new Date(course.updatedAt)
  return (
    <div className="apl-tr uni-courses-tr">
      <div className="apl-col-title">
        <span className="uni-thumb" aria-hidden="true">
          <MortarboardIcon size={18} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="apl-title">{course.title}</div>
          <div className="apl-slug">/university/{course.slug}</div>
        </div>
      </div>
      <div>
        <span className={`uni-access ${course.accessLevel}`}>
          <span aria-hidden="true">{access.glyph}</span>
          {access.label}
        </span>
      </div>
      <div>
        <StatusPill status={course.status} />
      </div>
      <div>
        <span className="uni-lesson-count">{course.lessonCount}</span>
      </div>
      <div>
        <span className="apl-rel">{relTime(updated)}</span>
        <span className="apl-abs">{updated.toLocaleDateString()}</span>
      </div>
      <div className="apl-col-actions">
        <CourseRowMenu
          courseId={course.id}
          slug={course.slug}
          title={course.title}
          status={course.status}
          lessonCount={course.lessonCount}
        />
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: CourseStatus }) {
  const cls = status === 'published' ? ' live' : status === 'archived' ? ' archived' : ''
  const label = status === 'published' ? 'Live' : status === 'draft' ? 'Draft' : 'Archived'
  return (
    <span className={`apl-pill${cls}`}>
      <span className="apl-dot" />
      {label}
    </span>
  )
}

function EmptyState({
  hasCourses,
  onClear,
}: {
  hasCourses: boolean
  onClear: () => void
}) {
  return (
    <div className="apl-empty">
      <MortarboardIcon size={28} />
      <h3>{hasCourses ? 'No courses match' : 'No courses yet'}</h3>
      <p>
        {hasCourses
          ? 'Try another filter or clear your search.'
          : 'Create your first course to start building the WhatStage University library.'}
      </p>
      {hasCourses ? (
        <button type="button" onClick={onClear} className="ap-btn ap-btn-secondary ap-btn-sm">
          Clear filters
        </button>
      ) : (
        <Link href="/dashboard/university/new" className="ap-btn ap-btn-primary ap-btn-sm">
          <PlusIcon /> New course
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

function MortarboardIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 4 2 9l10 5 10-5-10-5Z" />
      <path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5" />
      <path d="M21 9v5" />
    </svg>
  )
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
