'use client'

// WhatStage University — access / progress badge.
// kind drives the conversion semantics: 'free' (neutral), 'auth' (graphite open
// padlock = "just log in"), 'pro' (gold closed padlock = "pay to unlock"),
// 'completed' / 'in-progress' (green). Uses the .uni-badge* classes in globals.css.

type Kind = 'free' | 'auth' | 'pro' | 'completed' | 'in-progress'

const SVG = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

/** Open padlock → "sign in, it's free" (graphite). */
function OpenPadlock({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...SVG} aria-hidden>
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.4-2.1" />
    </svg>
  )
}

function Spark({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...SVG} aria-hidden>
      <path d="M12 3v18M3 12h18M6 6l12 12M18 6 6 18" />
    </svg>
  )
}

function Check({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} {...SVG} aria-hidden>
      <path d="M5 12.5 10 17.5 19 7" />
    </svg>
  )
}

const PROGRESS_GLYPH = (
  <svg width={12} height={12} {...SVG} aria-hidden>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 12V7" />
  </svg>
)

export function AccessBadge({ kind, pct }: { kind: Kind; pct?: number }) {
  switch (kind) {
    case 'completed':
      return (
        <span className="uni-badge uni-badge-completed">
          <Check />
          Completed
        </span>
      )
    case 'in-progress':
      return (
        <span className="uni-badge uni-badge-progress">
          {PROGRESS_GLYPH}
          {typeof pct === 'number' ? `${pct}%` : 'In progress'}
        </span>
      )
    case 'pro':
      return (
        <span className="uni-badge uni-badge-pro">
          <Spark />
          Pro
        </span>
      )
    case 'auth':
      return (
        <span className="uni-badge uni-badge-auth">
          <OpenPadlock />
          Members
        </span>
      )
    case 'free':
    default:
      return (
        <span className="uni-badge uni-badge-free">
          ◯ Free
        </span>
      )
  }
}

/** Standalone lock badge (re-exported for callers that only need the padlock). */
export function LockBadge({ kind }: { kind: 'auth' | 'pro' }) {
  return <AccessBadge kind={kind} />
}

export default AccessBadge
