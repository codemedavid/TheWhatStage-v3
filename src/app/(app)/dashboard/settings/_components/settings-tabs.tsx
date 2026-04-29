'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const tabs = [
  { href: '/dashboard/settings/profile', label: 'Profile' },
  { href: '/dashboard/settings/account', label: 'Account' },
  { href: '/dashboard/settings/facebook', label: 'Facebook' },
  { href: '/dashboard/settings/notifications', label: 'Notifications' },
]

export function SettingsTabs() {
  const pathname = usePathname() ?? ''

  return (
    <nav
      role="tablist"
      aria-label="Settings sections"
      className="flex gap-1 border-b border-[#E5E7EB]"
    >
      {tabs.map((tab) => {
        const active =
          pathname === tab.href || pathname.startsWith(tab.href + '/')
        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={active}
            className={
              'relative -mb-px px-4 py-2.5 text-[13px] font-medium transition-colors ' +
              (active
                ? 'text-[#111827] border-b-2 border-[#059669]'
                : 'text-[#6B7280] border-b-2 border-transparent hover:text-[#111827]')
            }
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
