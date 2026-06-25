'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect, useTransition } from 'react'

type IconName =
  | 'overview'
  | 'inbox'
  | 'analytics'
  | 'leads'
  | 'projects'
  | 'knowledge'
  | 'chatbot'
  | 'funnels'
  | 'business'
  | 'actions'
  | 'media'
  | 'activity'
  | 'settings'
  | 'help'
  | 'signout'
  | 'menu'
  | 'x'
  | 'chevron-left'
  | 'chevron-right'
  | 'agent'
  | 'reminders'
  | 'templates'
  | 'payments'
  | 'university'

type NavItem = {
  href: string
  label: string
  icon: IconName
  requiresFacebookPage?: boolean
  requiresSuperadmin?: boolean
}

const items: NavItem[] = [
  { href: '/dashboard', label: 'Overview', icon: 'overview' },
  { href: '/dashboard/inbox', label: 'Inbox', icon: 'inbox' },
  { href: '/dashboard/analytics', label: 'Analytics', icon: 'analytics' },
  { href: '/dashboard/leads', label: 'Leads', icon: 'leads' },
  { href: '/dashboard/projects', label: 'Projects', icon: 'projects' },
  { href: '/dashboard/knowledge', label: 'Knowledge', icon: 'knowledge' },
  { href: '/dashboard/chatbot', label: 'Chatbot', icon: 'chatbot' },
  { href: '/dashboard/action-pages', label: 'Action Pages', icon: 'actions' },
  { href: '/dashboard/agent', label: 'Agent', icon: 'agent', requiresFacebookPage: true },
  { href: '/dashboard/templates', label: 'Templates', icon: 'templates', requiresFacebookPage: true },
  { href: '/dashboard/payment-methods', label: 'Payment methods', icon: 'payments' },
  { href: '/dashboard/reminders', label: 'Reminders', icon: 'reminders' },
  { href: '/dashboard/media', label: 'Media', icon: 'media' },
  { href: '/dashboard/university', label: 'University', icon: 'university', requiresSuperadmin: true },
  { href: '/dashboard/settings', label: 'Settings', icon: 'settings' },
]

const mobileItems: { href: string; label: string; icon: IconName }[] = [
  { href: '/dashboard', label: 'Overview', icon: 'overview' },
  { href: '/dashboard/inbox', label: 'Inbox', icon: 'inbox' },
  { href: '/dashboard/leads', label: 'Leads', icon: 'leads' },
  { href: '/dashboard/projects', label: 'Projects', icon: 'projects' },
  { href: '/dashboard/chatbot', label: 'Chatbot', icon: 'chatbot' },
  { href: '/dashboard/action-pages', label: 'Actions', icon: 'actions' },
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
    inbox: (
      <>
        <path d="M3 13h5l1.5 3h5L21 13" />
        <path d="M5 5h14l2 8v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5z" />
      </>
    ),
    analytics: (
      <>
        <path d="M4 20V10" />
        <path d="M10 20V4" />
        <path d="M16 20v-6" />
        <path d="M3 20h18" />
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
    projects: (
      <>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2" />
        <path d="M3 13h18" />
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
    media: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="8" cy="10" r="1.5" />
        <path d="M21 16l-5-5-4 4-2-2-5 5" />
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
    menu: (
      <>
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </>
    ),
    x: (
      <>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </>
    ),
    'chevron-left': <path d="M15 18l-6-6 6-6" />,
    'chevron-right': <path d="M9 18l6-6-6-6" />,
    agent: (
      <>
        <path d="M12 2a4 4 0 014 4v1h1a2 2 0 012 2v3a2 2 0 01-2 2h-1v1a4 4 0 01-8 0v-1H7a2 2 0 01-2-2V9a2 2 0 012-2h1V6a4 4 0 014-4z" />
        <circle cx="9.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
        <circle cx="14.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
        <path d="M9.5 14.5s.8 1 2.5 1 2.5-1 2.5-1" />
      </>
    ),
    reminders: (
      <>
        <path d="M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6z" />
        <path d="M10 19a2 2 0 004 0" />
      </>
    ),
    templates: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M4 9h16" />
        <path d="M9 9v11" />
      </>
    ),
    payments: (
      <>
        <rect x="3" y="6" width="18" height="13" rx="2" />
        <path d="M3 10h18" />
        <path d="M7 15h4" />
      </>
    ),
    university: (
      <>
        <path d="M12 4 2 9l10 5 10-5-10-5Z" />
        <path d="M6 11.5V16c0 1.5 2.7 3 6 3s6-1.5 6-3v-4.5" />
        <path d="M21 9v5" />
      </>
    ),
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

export function Sidebar({
  userInitial = 'D',
  userName = 'David',
  hasFacebookPage = false,
  isSuperadmin = false,
  pendingSuggestionCount = 0,
  projectUnreadCount = 0,
  needsReplyCount = 0,
}: {
  userInitial?: string
  userName?: string
  hasFacebookPage?: boolean
  isSuperadmin?: boolean
  pendingSuggestionCount?: number
  projectUnreadCount?: number
  needsReplyCount?: number
} = {}) {
  const visibleItems = items.filter(
    (item) =>
      (!item.requiresFacebookPage || hasFacebookPage) &&
      (!item.requiresSuperadmin || isSuperadmin),
  )
  const pathname = usePathname() ?? '/dashboard'
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [, startTransition] = useTransition()

  useEffect(() => {
    const stored = localStorage.getItem('ws-sidebar-collapsed')
    if (stored !== null) startTransition(() => setCollapsed(stored === 'true'))
  }, [startTransition])

  function toggleCollapse() {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem('ws-sidebar-collapsed', String(next))
  }

  function closeMobile() {
    setMobileOpen(false)
  }

  return (
    <>
      {mobileOpen && (
        <div className="ws-sidebar-backdrop" onClick={closeMobile} aria-hidden="true" />
      )}

      <button
        type="button"
        className="ws-mobile-menu-btn"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
      >
        <Icon name="menu" size={20} />
      </button>

      <aside
        className={'ws-sidebar' + (collapsed ? ' collapsed' : '') + (mobileOpen ? ' mobile-open' : '')}
        aria-label="Sidebar navigation"
      >
        <div className="ws-brand">
          <div className="ws-brand-logo">W</div>
          <div className="ws-brand-name">WhatStage</div>
          <button
            type="button"
            className="ws-mobile-close-btn"
            onClick={closeMobile}
            aria-label="Close navigation"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="ws-nav-section-label">Workspace</div>
        <nav className="ws-nav">
          {visibleItems.map((item) => {
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
                onClick={closeMobile}
              >
                <Icon name={item.icon} />
                <span className="ws-nav-label flex items-center gap-1.5">
                  {item.label}
                  {item.href === '/dashboard/leads' && pendingSuggestionCount > 0 && (
                    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold text-white">
                      {pendingSuggestionCount}
                    </span>
                  )}
                  {item.href === '/dashboard/projects' && projectUnreadCount > 0 && (
                    <span
                      title={`${projectUnreadCount} unread client message(s) across your projects`}
                      className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white"
                    >
                      {projectUnreadCount > 99 ? '99+' : projectUnreadCount}
                    </span>
                  )}
                  {item.href === '/dashboard/inbox' && needsReplyCount > 0 && (
                    <span
                      title={`${needsReplyCount} conversation(s) waiting on a reply`}
                      className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold text-white"
                    >
                      {needsReplyCount > 99 ? '99+' : needsReplyCount}
                    </span>
                  )}
                </span>
              </Link>
            )
          })}
        </nav>

        <div className="ws-sidebar-bottom">
          <button type="button" className="ws-nav-item" title="Help & docs">
            <Icon name="help" />
            <span className="ws-nav-label">Help &amp; docs</span>
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

        <button
          type="button"
          className="ws-collapse-toggle"
          onClick={toggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={14} />
        </button>
      </aside>

      <nav className="ws-mobile-nav" aria-label="Mobile navigation">
        {mobileItems.map((item) => {
          const active =
            item.href === '/dashboard'
              ? pathname === '/dashboard'
              : pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              className={'ws-mobile-nav-item' + (active ? ' active' : '')}
            >
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
