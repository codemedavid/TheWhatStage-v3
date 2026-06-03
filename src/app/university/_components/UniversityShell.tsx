'use client'

// WhatStage University — public top bar + footer chrome. Slim, sticky, light.
// NOT the app sidebar — /university is public. Right slot swaps by viewer:
//   guest      → ghost "Log in" + primary "Get started"
//   member/sub → "My learning" + avatar (+ ✦ Pro chip for subscribers)

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import type { Viewer } from '@/lib/university/types'

type NavItem = { href: string; label: string }

const SVG = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const CSS = `
.uni-shell-bar {
  position: sticky; top: 0; z-index: 40;
  height: 64px; display: flex; align-items: center;
  background: color-mix(in srgb, var(--uni-bg) 88%, transparent);
  -webkit-backdrop-filter: saturate(1.1) blur(8px);
  backdrop-filter: saturate(1.1) blur(8px);
  border-bottom: 1px solid var(--uni-border);
}
.uni-shell-inner {
  max-width: var(--uni-maxw); margin: 0 auto; width: 100%;
  padding: 0 24px; display: flex; align-items: center; gap: 28px;
}
.uni-shell-brand {
  display: inline-flex; align-items: center; gap: 10px;
  font-family: var(--uni-serif); font-size: 19px; letter-spacing: -0.01em;
  color: var(--uni-ink); white-space: nowrap;
}
.uni-shell-mark {
  display: grid; place-items: center; height: 30px; width: 30px;
  border-radius: 8px; background: var(--uni-ink); color: var(--uni-ink-invert);
  font-family: var(--uni-serif); font-style: italic; font-size: 17px;
  line-height: 1; padding-bottom: 2px;
}
.uni-shell-brand b { font-weight: 400; color: var(--uni-ink-3); }
.uni-shell-nav { display: flex; align-items: center; gap: 22px; margin-left: 6px; }
.uni-shell-nav a {
  font-size: 14px; font-weight: 500; color: var(--uni-ink-3);
  transition: color .15s ease;
}
.uni-shell-nav a:hover { color: var(--uni-ink); }
.uni-shell-nav a.is-active { color: var(--uni-ink); }
.uni-shell-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
.uni-shell-avatar {
  display: grid; place-items: center; height: 34px; width: 34px;
  border-radius: 999px; background: var(--uni-accent-soft);
  color: var(--uni-accent-ink); font-size: 12.5px; font-weight: 600;
  font-family: var(--uni-mono); letter-spacing: 0.02em;
}
.uni-shell-pro {
  display: inline-flex; align-items: center; gap: 5px;
  height: 26px; padding: 0 9px; border-radius: 999px;
  background: var(--uni-gold-soft); color: var(--uni-gold-ink);
  border: 1px solid var(--uni-gold-border);
  font-family: var(--uni-mono); font-size: 11px; letter-spacing: 0.04em;
  text-transform: uppercase; font-weight: 500;
}
.uni-shell-mylearning {
  display: inline-flex; align-items: center; gap: 7px;
  height: 38px; padding: 0 14px; border-radius: var(--uni-r-md);
  font-size: 14px; font-weight: 500; color: var(--uni-ink-2);
  border: 1px solid var(--uni-border-strong); background: var(--uni-surface);
}
.uni-shell-mylearning:hover { background: var(--uni-surface-2); }

.uni-footer {
  margin-top: 64px; border-top: 1px solid var(--uni-border);
  background: var(--uni-bg-deep);
}
.uni-footer-inner {
  max-width: var(--uni-maxw); margin: 0 auto; width: 100%;
  padding: 28px 24px; display: flex; flex-wrap: wrap; align-items: center;
  gap: 16px; justify-content: space-between;
}
.uni-footer-brand {
  font-family: var(--uni-serif); font-size: 16px; color: var(--uni-ink-2);
}
.uni-footer-links {
  display: flex; gap: 20px; font-family: var(--uni-mono);
  font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--uni-ink-3);
}
.uni-footer-links a:hover { color: var(--uni-ink); }

@media (max-width: 680px) {
  .uni-shell-inner { gap: 14px; }
  .uni-shell-nav { display: none; }
  .uni-shell-brand b { display: none; }
}
`

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const active =
    item.href === '/university'
      ? pathname === '/university'
      : pathname.startsWith(item.href)
  return (
    <Link href={item.href} className={active ? 'is-active uni-focus' : 'uni-focus'}>
      {item.label}
    </Link>
  )
}

export function UniversityShell({
  viewer,
  user,
  nav,
}: {
  viewer: Viewer
  user?: { name: string; initials: string }
  nav: NavItem[]
}) {
  const pathname = usePathname() ?? '/university'
  const isGuest = viewer === 'guest'

  return (
    <>
      <style>{CSS}</style>
      <header className="uni-shell-bar">
        <div className="uni-shell-inner">
          <Link href="/university" className="uni-shell-brand uni-focus">
            <span className="uni-shell-mark" aria-hidden>
              W
            </span>
            <span>
              WhatStage <b>· University</b>
            </span>
          </Link>

          <nav className="uni-shell-nav" aria-label="University">
            {nav.map((item) => (
              <NavLink key={item.href} item={item} pathname={pathname} />
            ))}
          </nav>

          <div className="uni-shell-right">
            {isGuest ? (
              <>
                <Link href="/login" className="uni-btn uni-btn-ghost uni-btn-sm uni-focus">
                  Log in
                </Link>
                <Link
                  href="/signup"
                  className="uni-btn uni-btn-primary uni-btn-sm uni-focus"
                >
                  Get started →
                </Link>
              </>
            ) : (
              <>
                {viewer === 'subscriber' ? (
                  <span className="uni-shell-pro" title="Pro subscriber">
                    ✦ Pro
                  </span>
                ) : null}
                <Link href="/dashboard" className="uni-shell-mylearning uni-focus">
                  <svg width={15} height={15} {...SVG} aria-hidden>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                  My learning
                </Link>
                <span
                  className="uni-shell-avatar"
                  aria-label={user?.name ?? 'Account'}
                  title={user?.name ?? undefined}
                >
                  {user?.initials ?? '–'}
                </span>
              </>
            )}
          </div>
        </div>
      </header>
    </>
  )
}

/** Footer chrome — rendered by the layout after children. Shares the shell CSS. */
export function UniversityFooter() {
  return (
    <>
      <style>{CSS}</style>
      <footer className="uni-footer">
        <div className="uni-footer-inner">
          <span className="uni-footer-brand">WhatStage · University</span>
          <nav className="uni-footer-links" aria-label="Footer">
            <span>© 2026 WhatStage</span>
            <Link href="/privacy" className="uni-focus">
              Privacy
            </Link>
            <Link href="/terms" className="uni-focus">
              Terms
            </Link>
            <Link href="/university/pricing" className="uni-focus">
              Pricing
            </Link>
          </nav>
        </div>
      </footer>
    </>
  )
}

export default UniversityShell
