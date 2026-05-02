'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type IconName =
  | 'overview'
  | 'leads'
  | 'knowledge'
  | 'chatbot'
  | 'funnels'
  | 'business'
  | 'actions'
  | 'activity'
  | 'settings'
  | 'help'
  | 'signout'

const items: { href: string; label: string; icon: IconName }[] = [
  { href: '/dashboard', label: 'Overview', icon: 'overview' },
  { href: '/dashboard/leads', label: 'Leads', icon: 'leads' },
  { href: '/dashboard/knowledge', label: 'Knowledge', icon: 'knowledge' },
  { href: '/dashboard/chatbot', label: 'Chatbot', icon: 'chatbot' },
  { href: '/dashboard/funnels', label: 'Funnels', icon: 'funnels' },
  { href: '/dashboard/business', label: 'My Business', icon: 'business' },
  { href: '/dashboard/action-pages', label: 'Action Pages', icon: 'actions' },
  { href: '/dashboard/activity', label: 'Activity', icon: 'activity' },
  { href: '/dashboard/settings', label: 'Settings', icon: 'settings' },
]

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    overview: (
      <>
        <path d="M3 12L12 3l9 9" />
        <path d="M5 10v10h14V10" />
      </>
    ),
    leads: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.5 20c0-3.5 3-6 6.5-6s6.5 2.5 6.5 6" />
        <circle cx="17" cy="9" r="2.5" />
        <path d="M16 14c2.5 0 5 1.5 5 5" />
      </>
    ),
    knowledge: (
      <>
        <path d="M4 4h12a3 3 0 013 3v13a2 2 0 00-2-2H4z" />
        <path d="M4 4v15" />
        <path d="M8 8h7M8 11h7" />
      </>
    ),
    chatbot: (
      <>
        <rect x="3" y="5" width="18" height="13" rx="3" />
        <path d="M9 18l-2 3v-3" />
        <circle cx="9" cy="11" r="1" fill="currentColor" />
        <circle cx="15" cy="11" r="1" fill="currentColor" />
      </>
    ),
    funnels: (
      <>
        <rect x="3" y="5" width="5" height="5" rx="1.2" />
        <rect x="16" y="3" width="5" height="5" rx="1.2" />
        <rect x="16" y="16" width="5" height="5" rx="1.2" />
        <path d="M8 7.5h3.5a4 4 0 014 4V18" />
        <path d="M8 7.5h3.5a4 4 0 004-4V5" />
      </>
    ),
    business: (
      <>
        <path d="M3 21V8l9-5 9 5v13" />
        <path d="M9 21v-7h6v7" />
      </>
    ),
    actions: (
      <>
        <path d="M4 5h16M4 12h10M4 19h16" />
        <circle cx="18" cy="12" r="2.5" fill="currentColor" stroke="none" />
      </>
    ),
    activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 00.34 1.87l.06.06a2 2 0 11-2.83 2.83l-.06-.06A1.7 1.7 0 0015 19.4a1.7 1.7 0 00-1 1.55V21a2 2 0 11-4 0v-.1A1.7 1.7 0 009 19.4a1.7 1.7 0 00-1.87.34l-.06.06A2 2 0 114.24 16.97l.06-.06A1.7 1.7 0 004.6 15a1.7 1.7 0 00-1.55-1H3a2 2 0 110-4h.1A1.7 1.7 0 004.6 9a1.7 1.7 0 00-.34-1.87l-.06-.06a2 2 0 112.83-2.83l.06.06A1.7 1.7 0 009 4.6a1.7 1.7 0 001-1.55V3a2 2 0 114 0v.1A1.7 1.7 0 0015 4.6a1.7 1.7 0 001.87-.34l.06-.06a2 2 0 112.83 2.83l-.06.06A1.7 1.7 0 0019.4 9c.18.42.55.74 1 .85.16.04.34.06.5.06H21a2 2 0 110 4h-.1c-.42 0-.81.17-1.1.46" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 4" />
        <circle cx="12" cy="17" r=".8" fill="currentColor" />
      </>
    ),
    signout: <path d="M15 18l-6-6 6-6" />,
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}

export function Sidebar({ userInitial = 'D', userName = 'David' }: { userInitial?: string; userName?: string } = {}) {
  const pathname = usePathname() ?? '/dashboard'
  return (
    <aside className="ws-sidebar">
      <div className="ws-brand">
        <div className="ws-brand-logo">W</div>
        <div className="ws-brand-name">WhatStage</div>
      </div>

      <div className="ws-nav-section-label">Workspace</div>
      <nav className="ws-nav">
        {items.map((item) => {
          const active =
            item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              className={'ws-nav-item' + (active ? ' active' : '')}
              title={item.label}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="ws-sidebar-bottom">
        <button type="button" className="ws-nav-item" title="Help & docs">
          <Icon name="help" />
          <span>Help &amp; docs</span>
        </button>
        <div className="ws-user-chip">
          <div className="ws-user-avatar">{userInitial}</div>
          <div className="ws-user-meta">
            <div className="ws-user-name">Welcome back</div>
            <div className="ws-user-email">{userName}</div>
          </div>
          <form action="/auth/signout" method="post">
            <button type="submit" className="ws-user-signout" title="Sign out" aria-label="Sign out">
              <Icon name="signout" size={14} />
            </button>
          </form>
        </div>
      </div>
    </aside>
  )
}
