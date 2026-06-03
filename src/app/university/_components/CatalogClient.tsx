'use client'

// WhatStage University — catalog (Screen 1). Editorial hero + sticky filter bar
// (category pills + access segmented + client search) + Continue rail + course
// grid. Filtering is a pure client filter over the server-rendered cards
// (catalog is small); URL syncs ?category=&access=&q= for shareable/back-safe
// views via history.replaceState (no server round-trip).

import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import type { CategoryVM, CourseCardVM, ResumeVM, Viewer } from '@/lib/university/types'
import { CourseCard } from './CourseCard'
import { ContinueRail } from './ContinueRail'

const SVG = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

type AccessFilter = 'all' | 'public' | 'authenticated' | 'subscriber'

const ACCESS_SEGMENTS: { value: AccessFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'public', label: 'Free' },
  { value: 'authenticated', label: 'Members' },
  { value: 'subscriber', label: 'Pro' },
]

const CSS = `
.uni-hero {
  background: var(--uni-bg-deep);
  border-bottom: 1px solid var(--uni-border);
}
.uni-hero-inner {
  max-width: var(--uni-maxw); margin: 0 auto; padding: 72px 24px 56px;
  display: flex; flex-direction: column; gap: 14px;
}
.uni-hero h1 {
  font-family: var(--uni-serif); font-weight: 400;
  font-size: clamp(38px, 6vw, 66px); line-height: 1.04;
  letter-spacing: -0.02em; color: var(--uni-ink); max-width: 16ch;
}
.uni-hero p {
  font-size: 17px; line-height: 1.6; color: var(--uni-ink-3); max-width: 52ch;
}
.uni-hero-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 8px; }
.uni-hero-stat {
  font-family: var(--uni-mono); font-size: 12px; letter-spacing: 0.04em;
  color: var(--uni-ink-3); margin-left: 4px;
}

.uni-filterbar {
  position: sticky; top: 64px; z-index: 30;
  background: color-mix(in srgb, var(--uni-bg) 90%, transparent);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--uni-border);
}
.uni-filterbar.is-pending { opacity: .6; pointer-events: none; }
.uni-filter-inner {
  max-width: var(--uni-maxw); margin: 0 auto; padding: 14px 24px;
  display: flex; flex-wrap: wrap; align-items: center; gap: 12px 18px;
}
.uni-cat-row { display: flex; flex-wrap: wrap; gap: 8px; flex: 1 1 auto; }
.uni-pill {
  height: 32px; padding: 0 14px; border-radius: 999px;
  border: 1px solid var(--uni-border-strong); background: var(--uni-surface);
  font-size: 13px; font-weight: 500; color: var(--uni-ink-2);
  cursor: pointer; transition: all .15s ease; white-space: nowrap;
}
.uni-pill:hover { background: var(--uni-surface-2); }
.uni-pill.is-active {
  background: var(--uni-accent); border-color: var(--uni-accent); color: #fff;
}
.uni-seg {
  display: inline-flex; padding: 3px; gap: 2px;
  background: var(--uni-surface-2); border: 1px solid var(--uni-border);
  border-radius: var(--uni-r-md);
}
.uni-seg-btn {
  height: 28px; padding: 0 12px; border-radius: 8px; border: 0; background: transparent;
  font-size: 12.5px; font-weight: 500; color: var(--uni-ink-3); cursor: pointer;
}
.uni-seg-btn.is-active { background: var(--uni-surface); color: var(--uni-ink); box-shadow: var(--uni-shadow-sm); }
.uni-search {
  position: relative; display: inline-flex; align-items: center; min-width: 220px;
}
.uni-search svg { position: absolute; left: 11px; color: var(--uni-ink-4); }
.uni-search input {
  height: 36px; width: 100%; padding: 0 12px 0 34px; border-radius: var(--uni-r-md);
  border: 1px solid var(--uni-border-strong); background: var(--uni-surface);
  font-size: 14px; color: var(--uni-ink); outline: none;
}
.uni-search input:focus { border-color: var(--uni-accent); box-shadow: 0 0 0 3px var(--uni-accent-ring); }

.uni-catalog-body { max-width: var(--uni-maxw); margin: 0 auto; padding: 40px 24px 8px; }
.uni-section { margin-top: 40px; }
.uni-section:first-child { margin-top: 0; }
.uni-h2 { font-size: 26px; letter-spacing: -0.01em; color: var(--uni-ink); margin-bottom: 18px; }
.uni-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }

.uni-course-card { display: flex; flex-direction: column; overflow: hidden; transition: box-shadow .18s ease, transform .18s ease; }
.uni-course-card:hover { box-shadow: var(--uni-shadow-card-hover); transform: translateY(-2px); }
.uni-course-thumb { position: relative; aspect-ratio: 16 / 9; background: var(--uni-surface-2); }
.uni-course-thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.uni-course-badge { position: absolute; top: 10px; left: 10px; z-index: 2; }
.uni-course-scrim {
  position: absolute; inset: 0; display: grid; place-items: center;
  background: rgba(23,21,16,0.08); z-index: 1;
}
.uni-course-scrim > span { opacity: .55; }
.uni-course-hairline { position: absolute; left: 0; right: 0; bottom: 0; height: 4px; background: var(--uni-surface-3); z-index: 2; }
.uni-course-hairline > span { display: block; height: 100%; background: linear-gradient(90deg, var(--uni-progress-from), var(--uni-progress-to)); }
.uni-course-body { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px 12px; flex: 1; }
.uni-course-cat { color: var(--uni-ink-4); }
.uni-course-title { font-size: 16px; font-weight: 600; letter-spacing: -0.005em; color: var(--uni-ink); line-height: 1.3; }
.uni-course-sub { font-size: 13.5px; line-height: 1.45; color: var(--uni-ink-3); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.uni-course-meta { margin-top: auto; padding-top: 6px; font-family: var(--uni-mono); font-size: 11.5px; letter-spacing: 0.03em; color: var(--uni-ink-3); }
.uni-course-cta {
  padding: 11px 16px; border-top: 1px solid var(--uni-border);
  font-size: 13.5px; font-weight: 600; display: flex; align-items: center;
}
.uni-course-cta.is-go { color: var(--uni-accent-ink); background: var(--uni-accent-softer); }
.uni-course-cta.is-auth { color: var(--uni-ink-2); background: var(--uni-locked-soft); }
.uni-course-cta.is-gold { color: var(--uni-gold-ink); background: var(--uni-gold-soft); }

.uni-rail { display: flex; gap: 18px; overflow-x: auto; scroll-snap-type: x mandatory; padding-bottom: 6px; }
.uni-rail.has-overflow { -webkit-mask-image: linear-gradient(90deg, #000 92%, transparent); mask-image: linear-gradient(90deg, #000 92%, transparent); }
.uni-resume-card { display: grid; grid-template-columns: 132px 1fr; gap: 0; min-width: 420px; max-width: 460px; scroll-snap-align: start; overflow: hidden; }
.uni-resume-thumb { position: relative; background: var(--uni-surface-2); }
.uni-resume-thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.uni-resume-thumb-fallback { position: absolute; inset: 0; display: grid; place-items: center; color: var(--uni-ink-4); }
.uni-resume-marker { position: absolute; left: 8px; bottom: 8px; font-family: var(--uni-mono); font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 999px; background: var(--uni-resume); color: #fff; }
.uni-resume-body { display: flex; flex-direction: column; gap: 6px; padding: 14px 16px; }
.uni-resume-title { font-size: 15px; font-weight: 600; color: var(--uni-ink); }
.uni-resume-lesson { font-size: 12.5px; color: var(--uni-ink-3); }
.uni-resume-cta { margin-top: 4px; display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--uni-accent-ink); }

.uni-band {
  margin: 48px auto 0; max-width: var(--uni-maxw);
  border-radius: var(--uni-r-lg);
  background: var(--uni-bg-deep); border: 1px solid var(--uni-border);
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between;
  gap: 16px; padding: 22px 28px;
}
.uni-band span { font-size: 15.5px; color: var(--uni-ink-2); }
.uni-band-pro { background: var(--uni-gold-soft); border-color: var(--uni-gold-border); }

.uni-empty, .uni-error {
  display: flex; flex-direction: column; align-items: center; text-align: center;
  gap: 12px; padding: 56px 24px; margin: 8px auto; max-width: 520px;
}
.uni-empty .uni-card-pad, .uni-error .uni-card-pad { padding: 40px 28px; width: 100%; }
.uni-empty-glyph { color: var(--uni-ink-4); margin-bottom: 4px; }
.uni-empty h3 { font-family: var(--uni-serif); font-size: 26px; color: var(--uni-ink); }
.uni-empty p { font-size: 15px; color: var(--uni-ink-3); }
.uni-error-banner {
  margin: 24px auto 0; max-width: var(--uni-maxw);
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px;
  padding: 16px 20px; border-radius: var(--uni-r-md);
  background: var(--uni-danger-soft); border: 1px solid color-mix(in srgb, var(--uni-danger) 30%, transparent);
  color: var(--uni-danger);
}

@media (max-width: 1023px) { .uni-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 720px) {
  .uni-grid { grid-template-columns: 1fr; }
  .uni-hero-inner { padding: 52px 16px 40px; }
  .uni-filter-inner, .uni-catalog-body { padding-left: 16px; padding-right: 16px; }
  .uni-search { min-width: 0; flex: 1 1 100%; }
  .uni-resume-card { min-width: 300px; grid-template-columns: 100px 1fr; }
}
`

function formatDuration(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds <= 0) return ''
  const mins = Math.round(totalSeconds / 60)
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

const BookGlyph = ({ size = 40 }: { size?: number }) => (
  <svg width={size} height={size} {...SVG}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5V5.5Z" />
    <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5Z" />
  </svg>
)

export interface CatalogClientProps {
  courses: CourseCardVM[]
  categories: CategoryVM[]
  continueItems: ResumeVM[]
  viewer: Viewer
  initialFilters: { category: string; access: string; q: string }
  /** True when the server read failed; render the graceful-degradation banner. */
  loadError?: boolean
}

export function CatalogClient({
  courses,
  categories,
  continueItems,
  viewer,
  initialFilters,
  loadError = false,
}: CatalogClientProps) {
  const [category, setCategory] = useState(initialFilters.category || 'all')
  const [access, setAccess] = useState<AccessFilter>(() =>
    ACCESS_SEGMENTS.some((s) => s.value === initialFilters.access)
      ? (initialFilters.access as AccessFilter)
      : 'all',
  )
  const [q, setQ] = useState(initialFilters.q || '')
  const [, startTransition] = useTransition()
  const [isPending, setPending] = useState(false)

  function syncUrl(next: { category: string; access: AccessFilter; q: string }) {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams()
    if (next.category && next.category !== 'all') params.set('category', next.category)
    if (next.access && next.access !== 'all') params.set('access', next.access)
    if (next.q.trim()) params.set('q', next.q.trim())
    const qs = params.toString()
    window.history.replaceState(null, '', qs ? `/university?${qs}` : '/university')
  }

  function update(partial: { category?: string; access?: AccessFilter; q?: string }) {
    const next = {
      category: partial.category ?? category,
      access: partial.access ?? access,
      q: partial.q ?? q,
    }
    setPending(true)
    if (partial.category !== undefined) setCategory(partial.category)
    if (partial.access !== undefined) setAccess(partial.access)
    if (partial.q !== undefined) setQ(partial.q)
    startTransition(() => {
      syncUrl(next)
      setPending(false)
    })
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return courses.filter((c) => {
      if (category !== 'all' && c.category?.slug !== category) return false
      if (access !== 'all' && c.accessLevel !== access) return false
      if (needle) {
        const hay = `${c.title} ${c.subtitle ?? ''} ${c.category?.name ?? ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
  }, [courses, category, access, q])

  const totalDuration = formatDuration(
    courses.reduce((sum, c) => sum + (c.durationSeconds || 0), 0),
  )

  function clearFilters() {
    setCategory('all')
    setAccess('all')
    setQ('')
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/university')
    }
  }

  return (
    <>
      <style>{CSS}</style>

      {/* HERO */}
      <section className="uni-hero">
        <div className="uni-hero-inner">
          <span className="uni-eyebrow">✦ WhatStage University</span>
          <h1 className="uni-serif">Learn to turn every conversation into a customer.</h1>
          <p>
            Free courses on chatbots, action pages, and Messenger growth — plus a Pro
            track for the full playbook.
          </p>
          <div className="uni-hero-actions">
            <a href="#all-courses" className="uni-btn uni-btn-primary uni-focus">
              Browse free courses
            </a>
            <Link href="/university/pricing" className="uni-btn uni-btn-secondary uni-focus">
              See Pro plan →
            </Link>
            {courses.length > 0 ? (
              <span className="uni-hero-stat">
                {courses.length} {courses.length === 1 ? 'course' : 'courses'}
                {totalDuration ? ` · ${totalDuration}` : ''}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      {/* FILTER BAR */}
      <div className={'uni-filterbar' + (isPending ? ' is-pending' : '')} role="search">
        <div className="uni-filter-inner">
          <div className="uni-cat-row" role="group" aria-label="Category">
            <button
              type="button"
              className={'uni-pill uni-focus' + (category === 'all' ? ' is-active' : '')}
              onClick={() => update({ category: 'all' })}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat.slug}
                type="button"
                className={
                  'uni-pill uni-focus' + (category === cat.slug ? ' is-active' : '')
                }
                onClick={() => update({ category: cat.slug })}
              >
                {cat.name}
              </button>
            ))}
          </div>

          <div className="uni-seg" role="group" aria-label="Access level">
            {ACCESS_SEGMENTS.map((seg) => (
              <button
                key={seg.value}
                type="button"
                className={'uni-seg-btn uni-focus' + (access === seg.value ? ' is-active' : '')}
                aria-pressed={access === seg.value}
                onClick={() => update({ access: seg.value })}
              >
                {seg.label}
              </button>
            ))}
          </div>

          <div className="uni-search">
            <svg width={16} height={16} {...SVG} aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              type="search"
              value={q}
              placeholder="Search courses…"
              aria-label="Search courses"
              onChange={(e) => update({ q: e.target.value })}
            />
          </div>
        </div>
      </div>

      {/* ERROR (graceful degradation — hero + filters still rendered above) */}
      {loadError ? (
        <div className="uni-error-banner" role="alert">
          <span>We couldn&rsquo;t load the course library.</span>
          <button
            type="button"
            className="uni-btn uni-btn-secondary uni-btn-sm uni-focus"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </div>
      ) : null}

      {/* BODY */}
      <div className="uni-catalog-body">
        {continueItems.length > 0 ? <ContinueRail items={continueItems} /> : null}

        <section className="uni-section" id="all-courses" aria-labelledby="uni-all-h">
          <h2 id="uni-all-h" className="uni-serif uni-h2">
            All courses
          </h2>

          {courses.length === 0 && !loadError ? (
            <div className="uni-empty">
              <div className="uni-card uni-card-pad">
                <span className="uni-empty-glyph" aria-hidden>
                  <BookGlyph />
                </span>
                <h3 className="uni-serif">The library is being written.</h3>
                <p>New courses on chatbots, action pages, and Messenger growth are on the way.</p>
                <div style={{ marginTop: 8 }}>
                  {viewer === 'guest' ? (
                    <Link href="/signup" className="uni-btn uni-btn-primary uni-focus">
                      Get started →
                    </Link>
                  ) : (
                    <Link href="/dashboard" className="uni-btn uni-btn-secondary uni-focus">
                      Go to dashboard →
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="uni-empty">
              <div className="uni-card uni-card-pad">
                <span className="uni-empty-glyph" aria-hidden>
                  <BookGlyph size={34} />
                </span>
                <h3 className="uni-serif">No courses match your filters.</h3>
                <p>Try a different category or access level.</p>
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="uni-btn uni-btn-ghost uni-focus"
                    onClick={clearFilters}
                  >
                    Clear filters
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="uni-grid">
              {filtered.map((course) => (
                <CourseCard key={course.slug} course={course} viewer={viewer} />
              ))}
            </div>
          )}
        </section>

        {/* CONVERSION BAND */}
        {viewer === 'guest' && courses.length > 0 ? (
          <div className="uni-band">
            <span>✦ Create a free account to track your progress.</span>
            <Link href="/signup" className="uni-btn uni-btn-primary uni-focus">
              Create account →
            </Link>
          </div>
        ) : null}

        {viewer === 'member' && courses.some((c) => c.accessLevel === 'subscriber') ? (
          <div className="uni-band uni-band-pro">
            <span style={{ color: 'var(--uni-gold-ink)' }}>
              ✦ Go further with the full Pro library.
            </span>
            <Link href="/university/pricing" className="uni-btn uni-btn-upgrade uni-focus">
              See Pro plan →
            </Link>
          </div>
        ) : null}
      </div>
    </>
  )
}

export default CatalogClient
