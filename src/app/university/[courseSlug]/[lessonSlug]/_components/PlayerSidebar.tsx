'use client'

// WhatStage University — player lesson sidebar (§3.8). Course title + overall
// progress bar + the shared CurriculumList (variant='player'). On mobile it
// collapses to a "Lessons (n/m)" disclosure / bottom sheet.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { LessonRowVM } from '@/lib/university/types'
import CurriculumList from '@/app/university/_components/CurriculumList'

type Props = {
  courseSlug: string
  courseTitle: string
  lessons: LessonRowVM[]
  activeLessonSlug: string
  coursePct: number
  completedCount: number
  entitlementChip: 'pro' | 'upsell' | null
  courseAccessLevel?: 'public' | 'authenticated' | 'subscriber'
  viewerSignedIn?: boolean
}

export function PlayerSidebar({
  courseSlug,
  courseTitle,
  lessons,
  activeLessonSlug,
  coursePct,
  completedCount,
  entitlementChip,
  courseAccessLevel,
  viewerSignedIn,
}: Props) {
  const [open, setOpen] = useState(false)
  const total = lessons.length

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const header = (
    <div style={{ padding: '16px 16px 12px' }}>
      <Link href={`/university/${courseSlug}`} className="uni-focus" style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--uni-ink)', display: 'block', lineHeight: 1.3 }}>
        {courseTitle}
      </Link>
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span
          className="uni-progress uni-progress-sm"
          role="progressbar"
          aria-valuenow={coursePct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Course progress"
          style={{ display: 'block', flex: 1 }}
        >
          <span style={{ width: `${coursePct}%` }} />
        </span>
        <span style={{ fontFamily: 'var(--uni-mono)', fontSize: 11.5, color: 'var(--uni-ink-3)', whiteSpace: 'nowrap' }}>
          {completedCount}/{total} · {coursePct}%
        </span>
      </div>
    </div>
  )

  const list = (
    <div style={{ padding: '0 10px 12px' }}>
      <CurriculumList
        courseSlug={courseSlug}
        lessons={lessons}
        activeLessonSlug={activeLessonSlug}
        variant="player"
        courseAccessLevel={courseAccessLevel}
        viewerSignedIn={viewerSignedIn}
        onLockedClick={() => {
          // In the player, a locked sibling lesson navigates to it (the target
          // page renders its own LockScreen). Use the link semantics instead.
        }}
      />
    </div>
  )

  const chip =
    entitlementChip === 'pro' ? (
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--uni-border)' }}>
        <span className="uni-badge uni-badge-pro">✦ You&rsquo;re on Pro</span>
      </div>
    ) : entitlementChip === 'upsell' ? (
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--uni-border)' }}>
        <Link href="/university/pricing" className="uni-btn uni-btn-upgrade uni-btn-sm uni-focus" style={{ width: '100%' }}>
          ✦ Go further with Pro
        </Link>
      </div>
    ) : null

  return (
    <>
      {/* desktop sidebar */}
      <aside className="uni-player-sidebar">
        <div className="uni-card" style={{ position: 'sticky', top: 16, maxHeight: 'calc(100vh - 32px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {header}
          <div style={{ borderTop: '1px solid var(--uni-border)', overflowY: 'auto', flex: 1 }}>{list}</div>
          {chip}
        </div>
      </aside>

      {/* mobile disclosure button */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="uni-btn uni-btn-secondary uni-focus uni-player-disclosure"
        style={{ width: '100%' }}
      >
        <svg viewBox="0 0 24 24" width={18} height={18} stroke="currentColor" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
        </svg>
        Lessons ({completedCount}/{total})
      </button>

      {/* mobile bottom sheet */}
      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Lessons"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false)
          }}
          style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(20,18,12,0.42)', display: 'flex', alignItems: 'flex-end' }}
        >
          <div style={{ width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: 'var(--uni-bg)', borderTopLeftRadius: 'var(--uni-r-xl)', borderTopRightRadius: 'var(--uni-r-xl)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px 0' }}>
              {header}
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="uni-focus" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--uni-ink-3)', padding: 4, alignSelf: 'flex-start' }}>
                <svg viewBox="0 0 24 24" width={22} height={22} stroke="currentColor" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <div style={{ overflowY: 'auto', borderTop: '1px solid var(--uni-border)' }}>{list}</div>
          </div>
        </div>
      ) : null}

      <style>{`
        .uni-player-sidebar { display: none; }
        .uni-player-disclosure { display: inline-flex; }
        @media (min-width: 1024px) {
          .uni-player-sidebar { display: block; }
          .uni-player-disclosure { display: none !important; }
        }
      `}</style>
    </>
  )
}

export default PlayerSidebar
