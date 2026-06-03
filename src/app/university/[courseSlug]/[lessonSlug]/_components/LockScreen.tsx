'use client'

// WhatStage University — in-player locked interstitial (§3.10). Rendered in
// place of the embed when the server denies entitlement (the source RPC is
// never called). The surrounding chrome (sidebar, breadcrumb) stays intact —
// "inside the academy at a locked door," never a dead end.
//
//   needs_login        → graphite, "sign in, it's free"
//   needs_subscription → gold,     "subscribe to Pro"

import Link from 'next/link'
import { useRouter } from 'next/navigation'

type Props = {
  // 'unavailable' = the viewer IS entitled but the source failed to resolve
  // (RPC error / unset source / signing failure) — NOT a paywall.
  reason: 'needs_login' | 'needs_subscription' | 'unavailable'
  courseSlug: string
  previewLessonSlug?: string | null
  /** Encoded path to return to after auth (this lesson). */
  nextUrl: string
  priceLabel?: string
}

const PRICE_FALLBACK = 'Contact us · see plan'

function ArrowRight() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} stroke="currentColor" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

export function LockScreen({ reason, courseSlug, previewLessonSlug, nextUrl, priceLabel }: Props) {
  const router = useRouter()

  // Entitled but the source didn't resolve — a transient/config problem, never a paywall.
  if (reason === 'unavailable') {
    return (
      <div className="uni-stage" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24 }}>
        <div
          aria-hidden
          style={{ position: 'absolute', inset: 0, background: 'radial-gradient(120% 100% at 50% 0%, rgba(107,105,96,0.24), rgba(20,18,12,0.9))' }}
        />
        <div style={{ position: 'relative', maxWidth: 420, color: 'var(--uni-ink-invert)' }}>
          <span
            aria-hidden
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 56, height: 56, borderRadius: 16, background: 'rgba(255,255,255,0.12)', color: '#fff', marginBottom: 18 }}
          >
            <svg viewBox="0 0 24 24" width={26} height={26} stroke="currentColor" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round">
              <path d="m2 2 20 20" />
              <path d="M10.7 5.1A9 9 0 0 1 21 12M4 7.6A8.9 8.9 0 0 0 3 12a9 9 0 0 0 9 9 8.9 8.9 0 0 0 4.4-1.2" />
            </svg>
          </span>
          <h2 className="uni-serif" style={{ fontSize: 26, lineHeight: 1.15, color: '#fff', margin: 0 }}>
            This video isn’t available right now
          </h2>
          <p style={{ marginTop: 10, marginBottom: 20, fontSize: 14.5, lineHeight: 1.55, color: 'rgba(251,250,246,0.82)' }}>
            We couldn’t load this lesson’s video. Please try again in a moment.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 280, margin: '0 auto' }}>
            <button type="button" onClick={() => router.refresh()} className="uni-btn uni-focus" style={{ width: '100%', background: 'rgba(255,255,255,0.14)', color: '#fff' }}>
              Try again
            </button>
            <Link href={`/university/${courseSlug}`} className="uni-focus" style={{ fontSize: 13, fontWeight: 600, color: 'rgba(251,250,246,0.92)' }}>
              Back to course
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const isPro = reason === 'needs_subscription'
  const next = encodeURIComponent(nextUrl)
  const price = priceLabel || PRICE_FALLBACK

  return (
    <div
      className="uni-stage"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '24px',
      }}
    >
      {/* tinted scrim over the dark stage */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          background: isPro
            ? 'radial-gradient(120% 100% at 50% 0%, rgba(169,121,43,0.32), rgba(20,18,12,0.86))'
            : 'radial-gradient(120% 100% at 50% 0%, rgba(107,105,96,0.3), rgba(20,18,12,0.88))',
        }}
      />
      <div style={{ position: 'relative', maxWidth: 420, color: 'var(--uni-ink-invert)' }}>
        <span
          aria-hidden
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 56,
            height: 56,
            borderRadius: 16,
            background: isPro ? 'var(--uni-gold-grad)' : 'rgba(255,255,255,0.12)',
            color: '#fff',
            marginBottom: 18,
          }}
        >
          {isPro ? (
            <svg viewBox="0 0 24 24" width={26} height={26} stroke="currentColor" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width={26} height={26} stroke="currentColor" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 7.5-1.9" />
            </svg>
          )}
        </span>

        <h2 className="uni-serif" style={{ fontSize: 26, lineHeight: 1.15, color: '#fff', margin: 0 }}>
          {isPro ? 'This is a Pro lesson' : 'Sign in to watch this lesson'}
        </h2>
        <p style={{ marginTop: 10, marginBottom: 20, fontSize: 14.5, lineHeight: 1.55, color: 'rgba(251,250,246,0.82)' }}>
          {isPro ? `Unlock the full Pro library. ${price} · cancel anytime.` : 'It’s free with any WhatStage account.'}
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 280, margin: '0 auto' }}>
          {isPro ? (
            <Link href="/university/pricing" className="uni-btn uni-btn-upgrade uni-focus" style={{ width: '100%' }}>
              ✦ Subscribe to unlock <ArrowRight />
            </Link>
          ) : (
            <>
              <Link href={`/signup?next=${next}`} className="uni-btn uni-focus" style={{ width: '100%', background: 'var(--uni-locked)', color: '#fff' }}>
                Create free account <ArrowRight />
              </Link>
              <Link
                href={`/login?next=${next}`}
                className="uni-btn uni-focus"
                style={{ width: '100%', background: 'rgba(255,255,255,0.1)', color: '#fff' }}
              >
                Log in
              </Link>
            </>
          )}
          {previewLessonSlug ? (
            <Link
              href={`/university/${courseSlug}/${previewLessonSlug}`}
              className="uni-focus"
              style={{ marginTop: 4, fontSize: 13, fontWeight: 600, color: 'rgba(251,250,246,0.92)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
            >
              <svg viewBox="0 0 24 24" width={16} height={16} stroke="currentColor" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="12" cy="12" r="9" />
                <path d="M10 8.5l5 3.5-5 3.5z" fill="currentColor" stroke="none" />
              </svg>
              Watch a free preview
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default LockScreen
