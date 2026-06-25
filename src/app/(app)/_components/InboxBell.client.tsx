'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, useTransition } from 'react'
import { UnreadBadge } from '../dashboard/_components/UnreadBadge'
import { resolveBadge, timeAgo, type InboxItem } from '../dashboard/inbox/_lib/rows'
import { markAllThreadsRead } from '../dashboard/inbox/actions'

function InboxIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 13h5l1.5 3h5L21 13" />
      <path d="M5 5h14l2 8v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5z" />
    </svg>
  )
}

function BellRow({ item, onNavigate }: { item: InboxItem; onNavigate: () => void }) {
  const badge = resolveBadge(item.unreadCount, item.missedCount)
  const initial = item.name.trim().charAt(0).toUpperCase() || '?'
  const inner = (
    <div className="flex items-center gap-2.5 px-3 py-2 hover:bg-[#F6F5F1]">
      {item.pictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- FB CDN avatar
        <img src={item.pictureUrl} alt="" className="h-7 w-7 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
      ) : (
        <div className="h-7 w-7 rounded-full bg-[#EEF0F3] flex items-center justify-center text-[11px] font-semibold text-[#6B6960] shrink-0">
          {initial}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[12.5px] font-medium text-[#1F2937] truncate">{item.name}</span>
          {item.projectTitle && <span className="text-[10.5px] text-[#9CA3AF] truncate">· {item.projectTitle}</span>}
        </div>
        {item.preview && <div className="text-[11.5px] text-[#6B7280] truncate">{item.preview}</div>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {item.timestamp && <span className="text-[10.5px] tabular-nums text-[#9CA3AF]">{timeAgo(item.timestamp)}</span>}
        {badge && <UnreadBadge count={badge.count} variant={badge.variant} />}
      </div>
    </div>
  )
  if (!item.leadId) return inner
  return (
    <Link href={`/dashboard/leads?lead=${item.leadId}`} onClick={onNavigate} className="block">
      {inner}
    </Link>
  )
}

type Props = {
  count: number
  items: InboxItem[]
}

// Always-visible header inbox bell with a live "waiting on a reply" badge and a
// dropdown preview of the latest waiting conversations + a one-click
// "Mark all read". "View all" links to the full /dashboard/inbox hub.
export function InboxBell({ count, items }: Props) {
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function handleReadAll() {
    startTransition(async () => {
      await markAllThreadsRead()
      setOpen(false)
    })
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={count > 0 ? `Inbox, ${count} waiting on a reply` : 'Inbox'}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Inbox"
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-[#3F3D36] hover:bg-[#F6F5F1]"
      >
        <InboxIcon />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-[#E8E6DE] bg-white shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-[#F0EEE8] px-3 py-2">
            <span className="text-[13px] font-semibold text-[#1F2937]">Inbox</span>
            <button
              type="button"
              onClick={handleReadAll}
              disabled={isPending || count === 0}
              className="text-[12px] font-medium text-[#2563eb] hover:underline disabled:text-[#9CA3AF] disabled:no-underline"
            >
              {isPending ? 'Reading…' : 'Mark all read'}
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-3 py-8 text-center text-[12.5px] text-[#9CA3AF]">
                You&apos;re all caught up.
              </div>
            ) : (
              items.map((item) => <BellRow key={item.key} item={item} onNavigate={() => setOpen(false)} />)
            )}
          </div>

          <Link
            href="/dashboard/inbox"
            onClick={() => setOpen(false)}
            className="block border-t border-[#F0EEE8] px-3 py-2 text-center text-[12.5px] font-medium text-[#3F3D36] hover:bg-[#F6F5F1]"
          >
            View all →
          </Link>
        </div>
      )}
    </div>
  )
}
