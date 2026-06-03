'use client'

// WhatStage University — single course card for the catalog / related rails.
// The WHOLE card is one <a>; the footer CTA is a visual affordance only (no
// nested interactive). Locked cards stay fully legible — only the thumbnail
// gets a soft scrim + lock glyph. Conversion semantics: gold = Pro, graphite =
// sign-in, green = progress/completed.

import Link from 'next/link'
import type { CourseCardVM, Viewer } from '@/lib/university/types'
import { AccessBadge } from './AccessBadge'

const SVG = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function formatDuration(totalSeconds: number): string {
  if (!totalSeconds || totalSeconds <= 0) return ''
  const mins = Math.round(totalSeconds / 60)
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

/** access × viewer → footer CTA label (the §3.1 table). */
export function ctaLabelFor(
  course: Pick<CourseCardVM, 'accessLevel' | 'progressPct'>,
  viewer: Viewer,
): string {
  const started = (course.progressPct ?? 0) > 0
  if (course.accessLevel === 'public') {
    if (viewer === 'guest') return 'Start free →'
    return started ? 'Continue →' : 'Start →'
  }
  if (course.accessLevel === 'authenticated') {
    if (viewer === 'guest') return 'Sign in to start →'
    return started ? 'Continue →' : 'Start →'
  }
  // subscriber-only
  if (viewer === 'subscriber') return started ? 'Continue →' : 'Start →'
  if (viewer === 'member') return 'Upgrade to unlock →'
  return 'Unlock with Pro →'
}

/** Is the card gated for this viewer (drives scrim + CTA tone)? */
export function isLockedFor(course: Pick<CourseCardVM, 'accessLevel'>, viewer: Viewer): boolean {
  if (course.accessLevel === 'public') return false
  if (course.accessLevel === 'authenticated') return viewer === 'guest'
  return viewer !== 'subscriber'
}

function ThumbFallback() {
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background:
          'linear-gradient(135deg, var(--uni-surface-2), var(--uni-surface-3))',
        color: 'var(--uni-ink-4)',
      }}
    >
      <svg width={34} height={34} {...SVG}>
        <path d="M4 6h16v12H4zM4 10h16M9 6v12" />
      </svg>
    </span>
  )
}

export interface CourseCardProps {
  course: CourseCardVM
  viewer: Viewer
  /** Optional overrides — when omitted the card derives them from the §3.1 table. */
  href?: string
  ctaLabel?: string
  locked?: boolean
  progressPct?: number | null
  completed?: boolean
}

export function CourseCard({
  course,
  viewer,
  href,
  ctaLabel,
  locked,
  progressPct,
  completed,
}: CourseCardProps) {
  const link = href ?? `/university/${course.slug}`
  const pct = progressPct ?? course.progressPct
  const isCompleted = completed ?? course.completed
  const isLocked = locked ?? isLockedFor(course, viewer)
  const cta = ctaLabel ?? ctaLabelFor(course, viewer)
  const goldCta = course.accessLevel === 'subscriber' && isLocked
  const duration = formatDuration(course.durationSeconds)

  const badgeKind = isCompleted
    ? ('completed' as const)
    : pct && pct > 0
      ? ('in-progress' as const)
      : course.accessLevel === 'subscriber'
        ? ('pro' as const)
        : course.accessLevel === 'authenticated'
          ? ('auth' as const)
          : ('free' as const)

  return (
    <Link
      href={link}
      className="uni-card uni-focus uni-course-card"
      aria-label={course.title}
    >
      {/* thumbnail */}
      <div className="uni-course-thumb">
        {course.coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={course.coverImageUrl} alt="" loading="lazy" />
        ) : (
          <ThumbFallback />
        )}
        <span className="uni-course-badge">
          <AccessBadge kind={badgeKind} pct={pct ?? undefined} />
        </span>
        {isLocked ? (
          <span className="uni-course-scrim" aria-hidden>
            <span className={goldCta ? 'uni-glyph-lock-pro' : 'uni-glyph-lock-auth'}>
              <svg width={26} height={26} {...SVG}>
                <rect x="4" y="11" width="16" height="9" rx="2" />
                {goldCta ? (
                  <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                ) : (
                  <path d="M8 11V7a4 4 0 0 1 7.4-2.1" />
                )}
              </svg>
            </span>
          </span>
        ) : null}
        {pct && pct > 0 && !isCompleted ? (
          <span className="uni-course-hairline" aria-hidden>
            <span style={{ width: `${Math.min(100, pct)}%` }} />
          </span>
        ) : null}
      </div>

      {/* body */}
      <div className="uni-course-body">
        {course.category ? (
          <span className="uni-eyebrow uni-course-cat">{course.category.name}</span>
        ) : null}
        <span className="uni-course-title">{course.title}</span>
        {course.subtitle ? (
          <span className="uni-course-sub">{course.subtitle}</span>
        ) : null}
        <span className="uni-course-meta">
          {course.lessonCount} {course.lessonCount === 1 ? 'lesson' : 'lessons'}
          {duration ? ` · ${duration}` : ''}
        </span>
      </div>

      {/* footer CTA (visual only) */}
      <span
        className={
          'uni-course-cta' +
          (goldCta ? ' is-gold' : isLocked ? ' is-auth' : ' is-go')
        }
      >
        {isCompleted ? '✓ Completed — Rewatch →' : cta}
      </span>
    </Link>
  )
}

export default CourseCard
