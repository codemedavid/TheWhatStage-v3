'use client'

import Link from 'next/link'
import { InboxRow } from './InboxRow'
import { INBOX_TABS, type InboxTab, type InboxItem } from '../_lib/rows'

const TAB_LABELS: Record<InboxTab, string> = {
  'needs-reply': 'Needs reply',
  important: 'Important',
  submissions: 'Submissions',
  projects: 'Projects',
}

const EMPTY_COPY: Record<InboxTab, string> = {
  'needs-reply': "You're all caught up — no one's waiting on a reply.",
  important: 'No pinned conversations yet. Tap the star on any row to mark it important.',
  submissions: 'No action-page submissions yet.',
  projects: 'No active projects yet.',
}

function hrefFor(tab: InboxTab): string {
  return tab === 'needs-reply' ? '/dashboard/inbox' : `/dashboard/inbox?tab=${tab}`
}

type Props = {
  activeTab: InboxTab
  items: InboxItem[]
  needsReplyCount: number
  importantCount: number
}

export function InboxClient({ activeTab, items, needsReplyCount, importantCount }: Props) {
  const countFor = (tab: InboxTab): number | null => {
    if (tab === 'needs-reply') return needsReplyCount
    if (tab === 'important') return importantCount
    return null
  }

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-4">
        <h1 className="text-[20px] font-semibold text-[#1F2937]">Inbox</h1>
        <p className="text-[13px] text-[#6B7280]">
          Everyone waiting on you — across messages, submissions, and projects.
        </p>
      </header>

      <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Inbox filters">
        {INBOX_TABS.map((tab) => {
          const active = tab === activeTab
          const count = countFor(tab)
          return (
            <Link
              key={tab}
              href={hrefFor(tab)}
              aria-current={active ? 'page' : undefined}
              className={
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ' +
                (active ? 'bg-[#1F2937] text-white' : 'bg-[#F3F4F6] text-[#374151] hover:bg-[#E5E7EB]')
              }
            >
              {TAB_LABELS[tab]}
              {count != null && count > 0 && (
                <span
                  className={
                    'rounded-full px-1.5 text-[11px] tabular-nums ' +
                    (active ? 'bg-white/20 text-white' : 'bg-white text-[#6B7280]')
                  }
                >
                  {count > 99 ? '99+' : count}
                </span>
              )}
            </Link>
          )
        })}
      </nav>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#E5E7EB] bg-white px-6 py-12 text-center text-[13px] text-[#9CA3AF]">
          {EMPTY_COPY[activeTab]}
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <InboxRow key={item.key} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}
