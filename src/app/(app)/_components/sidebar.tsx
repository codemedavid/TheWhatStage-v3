import Link from 'next/link'

const items = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/activity', label: 'Activity' },
  { href: '/dashboard/settings', label: 'Settings' },
]

export function Sidebar({ activeHref }: { activeHref: string }) {
  return (
    <aside className="w-60 shrink-0 border-r border-[#E5E7EB] bg-white px-4 py-6">
      <div className="px-2 mb-6 text-[14px] font-semibold text-[#111827]">
        WhatStage
      </div>
      <nav className="space-y-1">
        {items.map((item) => {
          const active = item.href === activeHref
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                'block rounded-md px-3 py-2 text-[14px] ' +
                (active
                  ? 'font-semibold text-[#059669] bg-[rgba(5,150,105,0.08)]'
                  : 'font-medium text-[#374151] hover:bg-[#F3F4F6]')
              }
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
