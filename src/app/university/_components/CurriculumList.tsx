'use client'

// WhatStage University — SHARED curriculum list (course detail + player sidebar).
//
// Entitled rows are <Link>s to the lesson; locked rows are <button>s that call
// onLockedClick (the detail page pulses the CTA panel / mobile sheet; the player
// scrolls to the lock screen). Per-row state glyph + duration + an in-progress
// resume mini-bar. Pure presentational — props are serializable (metadata only).

import Link from 'next/link'
import type { LessonRowVM } from '@/lib/university/types'

function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  if (m >= 60) {
    const h = Math.floor(m / 60)
    const rm = m % 60
    return `${h}:${String(rm).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Which state a lesson row is in — drives glyph, color, and interactivity. */
function rowState(lesson: LessonRowVM): 'complete' | 'progress' | 'preview' | 'available' | 'lock-auth' | 'lock-pro' {
  if (lesson.completed) return 'complete'
  if (lesson.inProgress) return 'progress'
  if (lesson.locked) {
    // A locked row is auth-gated unless it's a Pro course (we can't fully know
    // here; the parent passes locked rows already filtered by entitlement). We
    // approximate from preview: a preview is never locked, so any locked row is
    // either auth or pro — the visual distinction is provided via lockKind below.
    return lesson.isPreview ? 'preview' : 'lock-auth'
  }
  if (lesson.isPreview) return 'preview'
  return 'available'
}

const STROKE = { strokeWidth: 1.75, stroke: 'currentColor', fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

function GlyphComplete() {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 26,
        height: 26,
        borderRadius: 999,
        background: 'var(--uni-accent)',
        color: '#fff',
        flexShrink: 0,
      }}
    >
      <svg viewBox="0 0 24 24" width={15} height={15} {...STROKE} strokeWidth={2.2}>
        <path d="M5 12.5l4.2 4.2L19 7" />
      </svg>
    </span>
  )
}

function GlyphProgress() {
  return (
    <span
      aria-hidden
      className="uni-glyph-progress"
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, flexShrink: 0 }}
    >
      <svg viewBox="0 0 24 24" width={22} height={22} {...STROKE}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 3a9 9 0 0 1 0 18" fill="currentColor" stroke="none" />
      </svg>
    </span>
  )
}

function GlyphPlay({ accent }: { accent?: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 26,
        height: 26,
        flexShrink: 0,
        color: accent ? 'var(--uni-accent)' : 'var(--uni-ink-3)',
      }}
    >
      <svg viewBox="0 0 24 24" width={20} height={20} {...STROKE}>
        <circle cx="12" cy="12" r="9" />
        <path d="M10 8.5l5 3.5-5 3.5z" fill="currentColor" stroke="none" />
      </svg>
    </span>
  )
}

function GlyphLockAuth() {
  // graphite OPEN padlock — "sign in, it's free"
  return (
    <span
      aria-hidden
      className="uni-glyph-lock-auth"
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, flexShrink: 0 }}
    >
      <svg viewBox="0 0 24 24" width={18} height={18} {...STROKE}>
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 7.5-1.9" />
      </svg>
    </span>
  )
}

function GlyphLockPro() {
  // gold CLOSED padlock — "subscribe to Pro"
  return (
    <span
      aria-hidden
      className="uni-glyph-lock-pro"
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, flexShrink: 0 }}
    >
      <svg viewBox="0 0 24 24" width={18} height={18} {...STROKE}>
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </svg>
    </span>
  )
}

type Props = {
  courseSlug: string
  lessons: LessonRowVM[]
  activeLessonSlug?: string
  variant: 'detail' | 'player'
  /** When provided, the course access level lets us distinguish the lock glyph. */
  courseAccessLevel?: 'public' | 'authenticated' | 'subscriber'
  /** Whether the viewer is signed in — a locked row for a signed-in viewer on a
   *  subscriber course is a Pro lock; otherwise it's a sign-in lock. */
  viewerSignedIn?: boolean
  onLockedClick?: () => void
}

export function CurriculumList({
  courseSlug,
  lessons,
  activeLessonSlug,
  variant,
  courseAccessLevel,
  viewerSignedIn,
  onLockedClick,
}: Props) {
  return (
    <ol
      style={{ listStyle: 'none', margin: 0, padding: 0 }}
      aria-label="Course lessons"
    >
      {lessons.map((lesson) => {
        const state = rowState(lesson)
        const active = lesson.slug === activeLessonSlug
        const locked = lesson.locked
        // Distinguish lock glyph: a subscriber course locked for a signed-in
        // non-subscriber is a Pro lock; everything else is a sign-in lock.
        const isProLock = locked && courseAccessLevel === 'subscriber' && !!viewerSignedIn

        const number = lesson.position + 1
        const durationLabel = formatDuration(lesson.durationSeconds)

        const glyph = locked ? (
          isProLock ? <GlyphLockPro /> : <GlyphLockAuth />
        ) : state === 'complete' ? (
          <GlyphComplete />
        ) : state === 'progress' ? (
          <GlyphProgress />
        ) : (
          <GlyphPlay accent={state === 'preview' || active} />
        )

        const body = (
          <>
            {glyph}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span
                  style={{
                    fontFamily: 'var(--uni-mono)',
                    fontSize: 11.5,
                    color: 'var(--uni-ink-4)',
                    minWidth: 18,
                  }}
                >
                  {number}
                </span>
                <span
                  style={{
                    fontSize: variant === 'player' ? 13.5 : 14.5,
                    fontWeight: active ? 600 : 500,
                    color: locked ? 'var(--uni-ink-3)' : 'var(--uni-ink)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: variant === 'player' ? 'nowrap' : 'normal',
                  }}
                >
                  {lesson.title}
                </span>
                {lesson.isPreview && !lesson.completed ? (
                  <span
                    style={{
                      fontFamily: 'var(--uni-mono)',
                      fontSize: 10,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: 'var(--uni-accent-ink)',
                      background: 'var(--uni-accent-softer)',
                      borderRadius: 999,
                      padding: '2px 6px',
                      flexShrink: 0,
                    }}
                  >
                    Preview
                  </span>
                ) : null}
                {active ? (
                  <span
                    style={{
                      fontFamily: 'var(--uni-mono)',
                      fontSize: 10,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: 'var(--uni-resume)',
                      flexShrink: 0,
                    }}
                  >
                    ◄ now
                  </span>
                ) : null}
              </span>
              {lesson.inProgress && lesson.resumeSeconds > 0 ? (
                <span style={{ display: 'block', marginTop: 7, marginLeft: 26 }}>
                  <span
                    className="uni-progress uni-progress-sm"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Resume position"
                    style={{ display: 'block' }}
                  >
                    <span style={{ width: '40%' }} />
                  </span>
                </span>
              ) : null}
            </span>
            <span
              style={{
                fontFamily: 'var(--uni-mono)',
                fontSize: 11.5,
                color: 'var(--uni-ink-3)',
                flexShrink: 0,
                marginLeft: 'auto',
              }}
            >
              {durationLabel}
            </span>
          </>
        )

        const rowClass = `uni-lesson-row uni-focus${active ? ' is-active' : ''}${locked ? ' is-locked' : ''}`

        return (
          <li key={lesson.slug}>
            {locked ? (
              <button
                type="button"
                className={rowClass}
                onClick={onLockedClick}
                aria-label={`${lesson.title} — locked. ${isProLock ? 'Subscribe to unlock.' : 'Sign in to unlock.'}`}
                style={{ width: '100%', textAlign: 'left', background: 'transparent', cursor: 'pointer' }}
              >
                {body}
              </button>
            ) : (
              <Link
                href={`/university/${courseSlug}/${lesson.slug}`}
                className={rowClass}
                aria-current={active ? 'page' : undefined}
                style={{ width: '100%' }}
              >
                {body}
              </Link>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export default CurriculumList
