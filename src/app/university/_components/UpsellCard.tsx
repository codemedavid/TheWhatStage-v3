'use client'

// WhatStage University — "Unlock Pro" upsell modal. Custom fixed-overlay (NO
// shadcn). Esc closes; backdrop click closes; focus is trapped lightly by
// autofocusing the primary CTA. Gold framing (= "pay to unlock").

import { useEffect, useRef } from 'react'
import Link from 'next/link'

const SVG = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const BENEFITS = [
  'The full Pro course library',
  'New courses added every month',
  'Advanced funnels, scripts & playbooks',
  'Cancel anytime',
]

export function UpsellCard({ onClose, href }: { onClose: () => void; href: string }) {
  const primaryRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    primaryRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  return (
    <div
      className="uni-modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="uni-modal uni-upsell"
        role="dialog"
        aria-modal="true"
        aria-labelledby="uni-upsell-title"
      >
        <button
          type="button"
          className="uni-modal-close uni-focus"
          aria-label="Close"
          onClick={onClose}
        >
          <svg width={18} height={18} {...SVG}>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>

        <span className="uni-upsell-spark" aria-hidden>
          <svg width={22} height={22} {...SVG}>
            <path d="M12 3v18M3 12h18M6 6l12 12M18 6 6 18" />
          </svg>
        </span>

        <span className="uni-eyebrow" style={{ color: 'var(--uni-gold-ink)' }}>
          ✦ WhatStage Pro
        </span>
        <h2 id="uni-upsell-title" className="uni-serif uni-upsell-title">
          Unlock the full Pro library
        </h2>
        <p className="uni-upsell-sub">
          This is a Pro course. Subscribe to unlock it and every other Pro track —
          cancel whenever you like.
        </p>

        <ul className="uni-upsell-list">
          {BENEFITS.map((b) => (
            <li key={b}>
              <span aria-hidden className="uni-glyph-complete">
                <svg width={16} height={16} {...SVG}>
                  <path d="M5 12.5 10 17.5 19 7" />
                </svg>
              </span>
              {b}
            </li>
          ))}
        </ul>

        <div className="uni-upsell-actions">
          <Link
            ref={primaryRef}
            href={href}
            className="uni-btn uni-btn-upgrade uni-focus"
          >
            ✦ Subscribe to unlock →
          </Link>
          <button
            type="button"
            className="uni-btn uni-btn-ghost uni-focus"
            onClick={onClose}
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  )
}

export default UpsellCard
