import type { Metadata } from 'next'
import Link from 'next/link'
import { getSession } from '@/lib/auth/get-session'
import { getViewer } from '@/lib/university/access'

export const metadata: Metadata = {
  title: 'Pro plan · WhatStage University',
  description:
    'Unlock the full WhatStage University Pro library — advanced funnels, scripts, and playbooks.',
}

const SVG = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
} as const

const BENEFITS = [
  {
    t: 'The full Pro course library',
    s: 'Every advanced track — not just the free getting-started courses.',
  },
  {
    t: 'New courses every month',
    s: 'Fresh playbooks as Messenger, chatbots, and action pages evolve.',
  },
  {
    t: 'Advanced funnels & scripts',
    s: 'The exact retargeting frameworks and re-open scripts top operators use.',
  },
  {
    t: 'Progress that follows you',
    s: 'Resume any lesson on any device, right where you left off.',
  },
  { t: 'Cancel anytime', s: 'No lock-in. Keep Pro for as long as it pays for itself.' },
]

export default async function UniversityPricingPage() {
  const session = await getSession()
  const viewer = getViewer(session)
  const isSubscriber = viewer === 'subscriber'

  return (
    <div style={{ maxWidth: 'var(--uni-maxw-read)', margin: '0 auto', padding: '64px 24px 24px' }}>
      <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 36 }}>
        <span className="uni-eyebrow" style={{ color: 'var(--uni-gold-ink)' }}>
          ✦ WhatStage Pro
        </span>
        <h1
          className="uni-serif"
          style={{
            fontWeight: 400,
            fontSize: 'clamp(34px, 5vw, 52px)',
            lineHeight: 1.06,
            letterSpacing: '-0.018em',
            color: 'var(--uni-ink)',
          }}
        >
          The full playbook, in one place.
        </h1>
        <p style={{ fontSize: 17, lineHeight: 1.6, color: 'var(--uni-ink-3)', maxWidth: '50ch', margin: '0 auto' }}>
          Free courses get you started. Pro unlocks the advanced funnels, scripts, and
          playbooks that turn conversations into booked customers — at scale.
        </p>
      </div>

      {/* Pricing card */}
      <div
        className="uni-card"
        style={{
          padding: '32px 28px',
          background: 'var(--uni-gold-soft)',
          borderColor: 'var(--uni-gold-border)',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <span
          className="uni-badge uni-badge-pro"
          style={{ alignSelf: 'center' }}
        >
          ✦ Pro plan
        </span>
        <div style={{ fontFamily: 'var(--uni-serif)', fontSize: 38, color: 'var(--uni-gold-ink)', lineHeight: 1.1 }}>
          Pricing coming soon
        </div>
        <p style={{ fontSize: 14.5, color: 'var(--uni-gold-ink)', maxWidth: '42ch' }}>
          We&rsquo;re finalizing Pro pricing and checkout. In the meantime, reach out and
          we&rsquo;ll get you set up.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center', marginTop: 12 }}>
          {isSubscriber ? (
            <Link href="/university" className="uni-btn uni-btn-secondary uni-focus">
              You&rsquo;re on Pro — browse courses →
            </Link>
          ) : (
            <>
              <a
                href="mailto:hello@whatstage.app?subject=WhatStage%20Pro"
                className="uni-btn uni-btn-upgrade uni-focus"
              >
                ✦ Contact us to get Pro
              </a>
              {viewer === 'guest' ? (
                <Link href="/signup" className="uni-btn uni-btn-secondary uni-focus">
                  Create free account →
                </Link>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Benefits */}
      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4, marginTop: 36 }}>
        {BENEFITS.map((b) => (
          <li
            key={b.t}
            style={{
              display: 'flex',
              gap: 14,
              alignItems: 'flex-start',
              padding: '16px 0',
              borderBottom: '1px solid var(--uni-border)',
            }}
          >
            <span className="uni-glyph-complete" aria-hidden style={{ flexShrink: 0, marginTop: 2 }}>
              <svg width={20} height={20} {...SVG}>
                <circle cx="12" cy="12" r="9" />
                <path d="M8 12.5 11 15.5 16 9" />
              </svg>
            </span>
            <span>
              <span style={{ display: 'block', fontSize: 15.5, fontWeight: 600, color: 'var(--uni-ink)' }}>
                {b.t}
              </span>
              <span style={{ display: 'block', fontSize: 14, lineHeight: 1.5, color: 'var(--uni-ink-3)' }}>
                {b.s}
              </span>
            </span>
          </li>
        ))}
      </ul>

      <p
        style={{
          marginTop: 28,
          textAlign: 'center',
          fontFamily: 'var(--uni-mono)',
          fontSize: 11.5,
          letterSpacing: '0.04em',
          color: 'var(--uni-ink-4)',
        }}
      >
        Pricing &amp; self-serve checkout are on the way. Free courses stay free, always.
      </p>
    </div>
  )
}
