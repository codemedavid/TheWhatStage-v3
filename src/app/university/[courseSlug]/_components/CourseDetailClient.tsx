'use client'

// WhatStage University — course detail (§3.5). Two columns on desktop: prose +
// shared CurriculumList on the left (scrolls), sticky CtaPanel on the right. On
// mobile the CTA collapses to a fixed bottom action bar that expands a sheet.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { CourseDetailVM, LessonRowVM, Viewer } from '@/lib/university/types'
import CurriculumList from '@/app/university/_components/CurriculumList'
import { CtaPanel, type CtaState } from './CtaPanel'
// P1 component (built in parallel). Imported, not recreated.
import { CourseCard } from '@/app/university/_components/CourseCard'

function formatTotal(seconds: number): string {
  if (!seconds || seconds <= 0) return '—'
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rm = m % 60
  return rm ? `${h}h ${rm}m` : `${h}h`
}

const ACCESS_BADGE: Record<CourseDetailVM['accessLevel'], { label: string; cls: string }> = {
  public: { label: '◯ Free', cls: 'uni-badge-free' },
  authenticated: { label: '⊟ Members', cls: 'uni-badge-auth' },
  subscriber: { label: '✦ Pro', cls: 'uni-badge-pro' },
}

type RelatedCourse = {
  course: CourseDetailVM
  href: string
  ctaLabel: string
  locked: boolean
}

type Props = {
  course: CourseDetailVM
  lessons: LessonRowVM[]
  coursePct: number
  resume?: { lessonSlug: string; seconds: number } | null
  ctaState: CtaState
  viewer: Viewer
  previewLessonSlug?: string | null
  firstLessonSlug?: string | null
  nextCourse?: { slug: string; title: string } | null
  related?: RelatedCourse[]
  priceLabel?: string
}

export function CourseDetailClient({
  course,
  lessons,
  // coursePct is accepted for API parity (§4); the CTA panel reads course.progressPct.
  resume,
  ctaState,
  viewer,
  previewLessonSlug,
  firstLessonSlug,
  nextCourse,
  related = [],
  priceLabel,
}: Props) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [pulse, setPulse] = useState(false)
  const ctaRef = useRef<HTMLDivElement | null>(null)
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isGated = ctaState === 'B' || ctaState === 'C'

  // Locked curriculum rows pulse/scroll the CTA on desktop; open the sheet on mobile.
  const onLockedClick = useCallback(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      setSheetOpen(true)
      return
    }
    ctaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setPulse(true)
    if (pulseTimer.current) clearTimeout(pulseTimer.current)
    pulseTimer.current = setTimeout(() => setPulse(false), 1200)
  }, [])

  useEffect(() => () => {
    if (pulseTimer.current) clearTimeout(pulseTimer.current)
  }, [])

  // Esc closes the mobile sheet.
  useEffect(() => {
    if (!sheetOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheetOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheetOpen])

  const badge = ACCESS_BADGE[course.accessLevel]
  const ctaPanel = (
    <CtaPanel
      state={ctaState}
      course={course}
      resume={resume}
      previewLessonSlug={previewLessonSlug}
      viewer={viewer}
      firstLessonSlug={firstLessonSlug}
      nextCourse={nextCourse}
      priceLabel={priceLabel}
    />
  )

  const hasLessons = lessons.length > 0

  return (
    <main style={{ paddingBottom: 96 }}>
      {/* breadcrumb */}
      <div className="uni-wrap" style={{ paddingTop: 20, paddingBottom: 4 }}>
        <Link href="/university" className="uni-focus" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--uni-ink-3)' }}>
          <svg viewBox="0 0 24 24" width={15} height={15} stroke="currentColor" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M19 12H5M11 6l-6 6 6 6" />
          </svg>
          All courses
        </Link>
      </div>

      {/* header band */}
      <header style={{ background: 'var(--uni-bg-deep)', borderTop: '1px solid var(--uni-border)', borderBottom: '1px solid var(--uni-border)' }}>
        <div className="uni-wrap" style={{ paddingTop: 36, paddingBottom: 36 }}>
          <p className="uni-eyebrow" style={{ marginBottom: 12 }}>
            {course.category?.name ? `${course.category.name} · ` : ''}
            {course.lessonCount} {course.lessonCount === 1 ? 'lesson' : 'lessons'} · {formatTotal(course.durationSeconds)}
            {course.accessLevel === 'subscriber' ? ' · ✦ Pro' : ''}
          </p>
          <h1 className="uni-serif" style={{ fontSize: 'clamp(30px, 4vw, 46px)', lineHeight: 1.08, letterSpacing: '-0.018em', color: 'var(--uni-ink)', margin: 0, maxWidth: 760 }}>
            {course.title}
          </h1>
          {course.subtitle ? (
            <p style={{ marginTop: 14, fontSize: 17, lineHeight: 1.55, color: 'var(--uni-ink-3)', maxWidth: 640 }}>
              {course.subtitle}
            </p>
          ) : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 20, alignItems: 'center' }}>
            <span className={`uni-badge ${badge.cls}`}>{badge.label}</span>
            <Meta icon="clock">{formatTotal(course.durationSeconds)}</Meta>
            <Meta icon="list">{course.lessonCount} lessons</Meta>
            <Meta icon="self">Self-paced</Meta>
          </div>
        </div>
      </header>

      {/* two-column body */}
      <div className="uni-wrap uni-detail-grid" style={{ paddingTop: 36 }}>
        <div style={{ minWidth: 0 }}>
          {/* description prose */}
          {course.description ? (
            <section style={{ maxWidth: 'var(--uni-maxw-read)', marginBottom: 36 }}>
              <h2 className="uni-eyebrow" style={{ marginBottom: 12 }}>
                About this course
              </h2>
              <div style={{ fontSize: 16, lineHeight: 1.7, color: 'var(--uni-ink-2)', whiteSpace: 'pre-wrap' }}>
                {course.description}
              </div>
            </section>
          ) : null}

          {/* curriculum */}
          <section>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14, gap: 12 }}>
              <h2 className="uni-serif" style={{ fontSize: 24, letterSpacing: '-0.01em', color: 'var(--uni-ink)', margin: 0 }}>
                Curriculum
              </h2>
              <span style={{ fontFamily: 'var(--uni-mono)', fontSize: 12, color: 'var(--uni-ink-3)' }}>
                {course.lessonCount} {course.lessonCount === 1 ? 'lesson' : 'lessons'} · {formatTotal(course.durationSeconds)}
              </span>
            </div>
            {hasLessons ? (
              <div className="uni-card" style={{ padding: 6 }}>
                <CurriculumList
                  courseSlug={course.slug}
                  lessons={lessons}
                  variant="detail"
                  courseAccessLevel={course.accessLevel}
                  viewerSignedIn={viewer !== 'guest'}
                  onLockedClick={onLockedClick}
                />
              </div>
            ) : (
              <div className="uni-card" style={{ padding: '28px 22px', textAlign: 'center', color: 'var(--uni-ink-3)', fontSize: 14.5 }}>
                Lessons are being added to this course.
              </div>
            )}
          </section>
        </div>

        {/* sticky CTA (desktop) */}
        <aside className="uni-detail-aside">
          <div
            ref={ctaRef}
            style={{
              position: 'sticky',
              top: 80,
              transition: 'box-shadow .3s, transform .3s',
              boxShadow: pulse ? '0 0 0 3px var(--uni-accent-ring)' : undefined,
              borderRadius: 'var(--uni-r-lg)',
            }}
          >
            {hasLessons ? (
              ctaPanel
            ) : (
              <div className="uni-card" style={{ padding: 22 }}>
                <p className="uni-eyebrow" style={{ marginBottom: 12 }}>
                  Coming soon
                </p>
                <button type="button" disabled className="uni-btn uni-btn-secondary" style={{ width: '100%' }}>
                  Coming soon
                </button>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* related rail */}
      {related.length > 0 ? (
        <section className="uni-wrap" style={{ marginTop: 56 }}>
          <h2 className="uni-serif" style={{ fontSize: 24, letterSpacing: '-0.01em', color: 'var(--uni-ink)', marginBottom: 18 }}>
            Related courses
          </h2>
          <div className="uni-related-grid">
            {related.map((r) => (
              <CourseCard
                key={r.course.slug}
                course={r.course}
                viewer={viewer}
                href={r.href}
                ctaLabel={r.ctaLabel}
                locked={r.locked}
                progressPct={r.course.progressPct}
                completed={r.course.completed}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* mobile fixed bottom action bar */}
      {hasLessons ? (
        <MobileBar
          ctaState={ctaState}
          isGated={isGated}
          onExpand={() => setSheetOpen(true)}
          course={course}
          resume={resume}
          firstLessonSlug={firstLessonSlug ?? previewLessonSlug ?? null}
        />
      ) : null}

      {/* mobile CTA sheet */}
      {sheetOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Course access"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSheetOpen(false)
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            background: 'rgba(20,18,12,0.42)',
            display: 'flex',
            alignItems: 'flex-end',
          }}
        >
          <div
            style={{
              width: '100%',
              maxHeight: '88vh',
              overflowY: 'auto',
              background: 'var(--uni-bg)',
              borderTopLeftRadius: 'var(--uni-r-xl)',
              borderTopRightRadius: 'var(--uni-r-xl)',
              padding: '14px 16px calc(20px + env(safe-area-inset-bottom))',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
              <button type="button" onClick={() => setSheetOpen(false)} aria-label="Close" className="uni-focus" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--uni-ink-3)', padding: 4 }}>
                <svg viewBox="0 0 24 24" width={22} height={22} stroke="currentColor" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            {ctaPanel}
          </div>
        </div>
      ) : null}

      <style>{`
        .uni-detail-grid { display: grid; grid-template-columns: 1fr; gap: 36px; }
        .uni-detail-aside { display: none; }
        .uni-related-grid { display: grid; grid-template-columns: 1fr; gap: 20px; }
        .uni-detail-mobilebar { display: flex; }
        @media (min-width: 768px) {
          .uni-related-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (min-width: 1024px) {
          .uni-detail-grid { grid-template-columns: minmax(0, 1fr) 340px; gap: 48px; align-items: start; }
          .uni-detail-aside { display: block; }
          .uni-related-grid { grid-template-columns: repeat(3, 1fr); }
          .uni-detail-mobilebar { display: none !important; }
        }
      `}</style>
    </main>
  )
}

function Meta({ icon, children }: { icon: 'clock' | 'list' | 'self'; children: React.ReactNode }) {
  const path =
    icon === 'clock' ? (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ) : icon === 'list' ? (
      <>
        <path d="M8 6h12M8 12h12M8 18h12" />
        <path d="M4 6h.01M4 12h.01M4 18h.01" />
      </>
    ) : (
      <>
        <path d="M12 3v6l4 2" />
        <circle cx="12" cy="12" r="9" />
      </>
    )
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--uni-ink-3)' }}>
      <svg viewBox="0 0 24 24" width={15} height={15} stroke="currentColor" strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {path}
      </svg>
      {children}
    </span>
  )
}

function MobileBar({
  ctaState,
  isGated,
  onExpand,
  course,
  resume,
  firstLessonSlug,
}: {
  ctaState: CtaState
  isGated: boolean
  onExpand: () => void
  course: CourseDetailVM
  resume?: { lessonSlug: string; seconds: number } | null
  firstLessonSlug: string | null
}) {
  const startHref = firstLessonSlug ? `/university/${course.slug}/${firstLessonSlug}` : `/university/${course.slug}`
  const resumeHref = resume ? `/university/${course.slug}/${resume.lessonSlug}` : startHref

  let label = 'Start course'
  let href = startHref
  let cls = 'uni-btn-primary'
  if (ctaState === 'B') {
    label = 'Sign in — it’s free'
  } else if (ctaState === 'C') {
    label = '✦ Subscribe to unlock'
    cls = 'uni-btn-upgrade'
  } else if (ctaState === 'E') {
    label = 'Resume course'
    href = resumeHref
  } else if (ctaState === 'F') {
    label = '↺ Rewatch'
    cls = 'uni-btn-secondary'
  }

  return (
    <div
      className="uni-detail-mobilebar"
      style={{
        position: 'fixed',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        background: 'var(--uni-surface)',
        borderTop: '1px solid var(--uni-border)',
        boxShadow: 'var(--uni-shadow-lg)',
        padding: '12px 16px calc(12px + env(safe-area-inset-bottom))',
      }}
    >
      {isGated ? (
        <button type="button" onClick={onExpand} className={`uni-btn ${cls} uni-focus`} style={{ width: '100%' }}>
          {label}
        </button>
      ) : (
        <Link href={href} className={`uni-btn ${cls} uni-focus`} style={{ width: '100%' }}>
          {label}
        </Link>
      )}
    </div>
  )
}

export default CourseDetailClient
