'use client'

// WhatStage University — "Continue learning" rail (the resume-first spine from
// Direction B). Horizontal scroll-snap of resume cards; each deep-links to the
// exact lesson the viewer left off on. Renders nothing when empty.

import Link from 'next/link'
import type { ResumeVM } from '@/lib/university/types'
import { ProgressBar } from './ProgressBar'

const SVG = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function ContinueRail({ items }: { items: ResumeVM[] }) {
  if (!items || items.length === 0) return null

  return (
    <section aria-labelledby="uni-continue-h" className="uni-section">
      <h2 id="uni-continue-h" className="uni-serif uni-h2">
        Continue learning
      </h2>
      <div
        className={'uni-rail' + (items.length > 1 ? ' has-overflow' : '')}
        role="list"
      >
        {items.map((item) => {
          const href = `/university/${item.courseSlug}/${item.lessonSlug}`
          return (
            <Link
              key={`${item.courseSlug}/${item.lessonSlug}`}
              href={href}
              role="listitem"
              className="uni-card uni-focus uni-resume-card"
            >
              <div className="uni-resume-thumb">
                {item.coverImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.coverImageUrl} alt="" loading="lazy" />
                ) : (
                  <span aria-hidden className="uni-resume-thumb-fallback">
                    <svg width={28} height={28} {...SVG}>
                      <path d="M4 6h16v12H4zM4 10h16M9 6v12" />
                    </svg>
                  </span>
                )}
                <span className="uni-resume-marker" aria-hidden>
                  {item.progressPct}%
                </span>
              </div>
              <div className="uni-resume-body">
                <span className="uni-resume-title">{item.courseTitle}</span>
                <span className="uni-resume-lesson">
                  Lesson {item.lessonNumber} of {item.lessonCount}
                  {item.lessonTitle ? ` · ${item.lessonTitle}` : ''}
                </span>
                <ProgressBar
                  pct={item.progressPct}
                  label={`${item.courseTitle} progress`}
                  small
                />
                <span className="uni-resume-cta">
                  <svg width={14} height={14} {...SVG}>
                    <path d="M8 5l11 7-11 7V5Z" />
                  </svg>
                  Resume
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

export default ContinueRail
