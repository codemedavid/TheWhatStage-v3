'use client'

// WhatStage University — course-detail CTA panel (the conversion core, §3.6).
//
// Implements the A–F state matrix. CONVERSION SEMANTICS (consistent everywhere):
//   graphite (--uni-locked) = "sign in, it's free"  (access=authenticated)
//   gold     (--uni-gold*)  = "subscribe to Pro"     (access=subscriber)
//   green    (--uni-accent) = progress / start / included
//
// Sticky right column on desktop; the parent collapses it to a fixed bottom
// action bar on mobile. Pure presentational — no data fetching.

import Link from 'next/link'
import type { CourseDetailVM, Viewer } from '@/lib/university/types'

export type CtaState = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'

type Props = {
  state: CtaState
  course: CourseDetailVM
  resume?: { lessonSlug: string; seconds: number } | null
  previewLessonSlug?: string | null
  viewer: Viewer
  /** Slug of lesson 1 (start target). */
  firstLessonSlug?: string | null
  /** Optional cross-sell next course (state F). */
  nextCourse?: { slug: string; title: string } | null
  /** Price copy — placeholder until billing exists. */
  priceLabel?: string
}

const PRICE_FALLBACK = 'Contact us · see plan'

function nextParam(courseSlug: string, lessonSlug?: string | null): string {
  const path = lessonSlug ? `/university/${courseSlug}/${lessonSlug}` : `/university/${courseSlug}`
  return encodeURIComponent(path)
}

function ArrowRight() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} stroke="currentColor" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

function Spark() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} stroke="currentColor" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />
    </svg>
  )
}

function Replay() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} stroke="currentColor" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v3.5h3.5" />
    </svg>
  )
}

function PreviewCallout({ courseSlug, previewLessonSlug }: { courseSlug: string; previewLessonSlug?: string | null }) {
  if (!previewLessonSlug) return null
  return (
    <Link
      href={`/university/${courseSlug}/${previewLessonSlug}`}
      className="uni-focus"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginTop: 14,
        padding: '10px 12px',
        borderRadius: 'var(--uni-r-sm)',
        background: 'var(--uni-accent-softer)',
        color: 'var(--uni-accent-ink)',
        fontSize: 13.5,
        fontWeight: 600,
      }}
    >
      <svg viewBox="0 0 24 24" width={18} height={18} stroke="currentColor" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M10 8.5l5 3.5-5 3.5z" fill="currentColor" stroke="none" />
      </svg>
      Lesson 1 is free — watch the preview
    </Link>
  )
}

function Eyebrow({ children, tone }: { children: React.ReactNode; tone: 'free' | 'auth' | 'pro' | 'progress' | 'completed' }) {
  const color =
    tone === 'pro'
      ? 'var(--uni-gold-ink)'
      : tone === 'completed' || tone === 'progress'
        ? 'var(--uni-accent-ink)'
        : tone === 'auth'
          ? 'var(--uni-ink-2)'
          : 'var(--uni-ink-3)'
  return (
    <p className="uni-eyebrow" style={{ color, marginBottom: 12 }}>
      {children}
    </p>
  )
}

function Checklist({ items }: { items: string[] }) {
  return (
    <ul style={{ listStyle: 'none', margin: '16px 0 0', padding: 0, display: 'grid', gap: 8 }}>
      {items.map((it) => (
        <li key={it} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13.5, color: 'var(--uni-ink-2)' }}>
          <svg viewBox="0 0 24 24" width={16} height={16} stroke="var(--uni-accent)" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0, marginTop: 2 }}>
            <path d="M5 12.5l4.2 4.2L19 7" />
          </svg>
          {it}
        </li>
      ))}
    </ul>
  )
}

export function CtaPanel({
  state,
  course,
  resume,
  previewLessonSlug,
  viewer,
  firstLessonSlug,
  nextCourse,
  priceLabel,
}: Props) {
  const courseSlug = course.slug
  const startSlug = firstLessonSlug ?? previewLessonSlug ?? null
  const startHref = startSlug ? `/university/${courseSlug}/${startSlug}` : `/university/${courseSlug}`
  const next = nextParam(courseSlug, startSlug)
  const price = priceLabel || PRICE_FALLBACK

  // ── State A — guest, public course ──
  if (state === 'A') {
    return (
      <Shell>
        <Eyebrow tone="free">◯ Free course</Eyebrow>
        <Link href={startHref} className="uni-btn uni-btn-primary uni-focus" style={{ width: '100%' }}>
          Start course <ArrowRight />
        </Link>
        <p style={{ marginTop: 14, fontSize: 13, color: 'var(--uni-ink-3)' }}>
          Want to save your progress?{' '}
          <Link href={`/signup?next=${next}`} className="uni-focus" style={{ color: 'var(--uni-accent-ink)', fontWeight: 600 }}>
            Create a free account
          </Link>
        </p>
      </Shell>
    )
  }

  // ── State B — guest, authenticated course (LOG-IN conversion, graphite) ──
  if (state === 'B') {
    return (
      <Shell>
        <Eyebrow tone="auth">⊟ Members course</Eyebrow>
        <p style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 600, color: 'var(--uni-ink)' }}>
          Sign in to start — it&rsquo;s free.
        </p>
        <p style={{ margin: '0 0 16px', fontSize: 13.5, color: 'var(--uni-ink-3)' }}>
          Included with any free WhatStage account.
        </p>
        <Link
          href={`/signup?next=${next}`}
          className="uni-btn uni-focus"
          style={{ width: '100%', background: 'var(--uni-locked)', color: '#fff' }}
        >
          Create free account <ArrowRight />
        </Link>
        <Link href={`/login?next=${next}`} className="uni-btn uni-btn-ghost uni-focus" style={{ width: '100%', marginTop: 8 }}>
          Log in
        </Link>
        <PreviewCallout courseSlug={courseSlug} previewLessonSlug={previewLessonSlug} />
      </Shell>
    )
  }

  // ── State C — guest OR member, subscriber course (PAY conversion, gold) ──
  if (state === 'C') {
    return (
      <Shell accent="gold">
        <div
          style={{
            margin: '-22px -22px 18px',
            padding: '18px 22px',
            background: 'var(--uni-gold-grad)',
            color: '#fff',
            borderTopLeftRadius: 'var(--uni-r-lg)',
            borderTopRightRadius: 'var(--uni-r-lg)',
          }}
        >
          <p className="uni-eyebrow" style={{ color: 'rgba(255,255,255,0.85)', marginBottom: 6 }}>
            ✦ Pro course
          </p>
          <p className="uni-serif" style={{ margin: 0, fontSize: 21, lineHeight: 1.2, color: '#fff' }}>
            Unlock the full Pro library
          </p>
        </div>
        <p style={{ margin: '0 0 4px', fontSize: 14, color: 'var(--uni-ink-2)' }}>
          This course and the entire Pro track.
        </p>
        <p style={{ margin: '0 0 16px', fontSize: 13.5, fontWeight: 600, color: 'var(--uni-gold-ink)' }}>
          {price} · cancel anytime
        </p>
        <Link href="/university/pricing" className="uni-btn uni-btn-upgrade uni-focus" style={{ width: '100%' }}>
          <Spark /> Subscribe to unlock <ArrowRight />
        </Link>
        <Checklist items={['Every Pro course', 'New lessons monthly', 'Cancel anytime']} />
        <PreviewCallout courseSlug={courseSlug} previewLessonSlug={previewLessonSlug} />
        {viewer === 'guest' ? (
          <p style={{ marginTop: 14, fontSize: 13, color: 'var(--uni-ink-3)' }}>
            Already Pro?{' '}
            <Link href={`/login?next=${next}`} className="uni-focus" style={{ color: 'var(--uni-accent-ink)', fontWeight: 600 }}>
              Log in
            </Link>
          </p>
        ) : null}
      </Shell>
    )
  }

  // ── State D — member, authenticated course, not started ──
  if (state === 'D') {
    return (
      <Shell>
        <Eyebrow tone="completed">◯ Included in your plan</Eyebrow>
        <Link href={startHref} className="uni-btn uni-btn-primary uni-focus" style={{ width: '100%' }}>
          Start course <ArrowRight />
        </Link>
      </Shell>
    )
  }

  // ── State E — entitled + in progress ──
  if (state === 'E') {
    const pct = course.progressPct ?? 0
    const resumeHref = resume ? `/university/${courseSlug}/${resume.lessonSlug}` : startHref
    return (
      <Shell>
        <Eyebrow tone="progress">◐ In progress · {pct}%</Eyebrow>
        <span className="uni-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Course progress" style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ width: `${pct}%` }} />
        </span>
        <Link href={resumeHref} className="uni-btn uni-btn-primary uni-focus" style={{ width: '100%' }}>
          Resume course <ArrowRight />
        </Link>
        <Link href={startHref} className="uni-btn uni-btn-ghost uni-focus" style={{ width: '100%', marginTop: 8 }}>
          <Replay /> Start over
        </Link>
      </Shell>
    )
  }

  // ── State F — entitled + completed ──
  return (
    <Shell>
      <Eyebrow tone="completed">✓ Completed</Eyebrow>
      <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--uni-ink-2)' }}>
        🎉 You finished this course.
      </p>
      <Link href={startHref} className="uni-btn uni-btn-secondary uni-focus" style={{ width: '100%' }}>
        <Replay /> Rewatch
      </Link>
      {nextCourse ? (
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--uni-border)' }}>
          <p className="uni-eyebrow" style={{ marginBottom: 8 }}>
            Up next
          </p>
          <Link
            href={`/university/${nextCourse.slug}`}
            className="uni-focus"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--uni-ink)',
            }}
          >
            {nextCourse.title}
            <ArrowRight />
          </Link>
        </div>
      ) : null}
    </Shell>
  )
}

function Shell({ children, accent }: { children: React.ReactNode; accent?: 'gold' }) {
  return (
    <div
      className="uni-card"
      style={{
        padding: 22,
        borderColor: accent === 'gold' ? 'var(--uni-gold-border)' : 'var(--uni-border)',
        boxShadow: 'var(--uni-shadow-md)',
      }}
    >
      {children}
    </div>
  )
}

export default CtaPanel
