'use client'

import Link from 'next/link'
import { useTransition } from 'react'
import { UnreadBadge } from '../../_components/UnreadBadge'
import { resolveBadge, type InboxItem } from '../_lib/rows'
import { toggleThreadImportant, markInboxThreadRead } from '../actions'

// Relative-time label for the row. Display-only; recomputed each render.
function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const min = Math.floor((Date.now() - then) / 60000)
  if (min < 1) return 'now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  return new Date(iso).toLocaleDateString()
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 24 24"
      fill={filled ? '#f59e0b' : 'none'}
      stroke={filled ? '#f59e0b' : 'currentColor'}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17.8 6.8 19.2l1-5.8L3.5 9.2l5.9-.9z" />
    </svg>
  )
}

type Props = { item: InboxItem }

export function InboxRow({ item }: Props) {
  const [isPending, startTransition] = useTransition()
  const badge = resolveBadge(item.unreadCount, item.missedCount)
  const href = item.leadId ? `/dashboard/leads?lead=${item.leadId}` : null
  const canAct = Boolean(item.leadId)
  const initial = item.name.trim().charAt(0).toUpperCase() || '?'

  function handleTogglePin() {
    const leadId = item.leadId
    if (!leadId) return
    startTransition(async () => {
      await toggleThreadImportant({ leadId, important: !item.isImportant })
    })
  }

  function handleMarkRead() {
    const leadId = item.leadId
    if (!leadId) return
    startTransition(async () => {
      await markInboxThreadRead(leadId)
    })
  }

  const main = (
    <div className="flex items-center gap-3 min-w-0">
      {item.pictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- FB CDN avatar, not a static asset
        <img
          src={item.pictureUrl}
          alt=""
          className="h-9 w-9 rounded-full object-cover shrink-0"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="h-9 w-9 rounded-full bg-[#EEF0F3] flex items-center justify-center text-[12px] font-semibold text-[#6B6960] shrink-0">
          {initial}
        </div>
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[13.5px] font-semibold text-[#1F2937] truncate">{item.name}</span>
          {item.projectTitle && (
            <span className="text-[11px] text-[#6B7280] truncate">· {item.projectTitle}</span>
          )}
          {item.tag && (
            <span className="text-[10px] uppercase tracking-wide rounded bg-[#EEF0F3] px-1.5 py-0.5 text-[#6B7280] shrink-0">
              {item.tag}
            </span>
          )}
        </div>
        {item.preview && <div className="text-[12px] text-[#6B7280] truncate">{item.preview}</div>}
      </div>
    </div>
  )

  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 transition-colors hover:border-[#D1D5DB]">
      {href ? (
        <Link href={href} className="min-w-0 flex-1" title="Open conversation">
          {main}
        </Link>
      ) : (
        <div className="min-w-0 flex-1">{main}</div>
      )}

      <div className="ml-auto flex items-center gap-2 shrink-0">
        {item.timestamp && (
          <span className="text-[11px] tabular-nums text-[#9CA3AF]">{timeAgo(item.timestamp)}</span>
        )}
        {badge && <UnreadBadge count={badge.count} variant={badge.variant} />}
        {canAct && badge && (
          <button
            type="button"
            onClick={handleMarkRead}
            disabled={isPending}
            title="Mark as read"
            aria-label="Mark as read"
            className="rounded-md p-1 text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-[#16a34a] disabled:opacity-50"
          >
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </button>
        )}
        {canAct && (
          <button
            type="button"
            onClick={handleTogglePin}
            disabled={isPending}
            title={item.isImportant ? 'Unpin' : 'Mark important'}
            aria-label={item.isImportant ? 'Unpin' : 'Mark important'}
            aria-pressed={item.isImportant}
            className="rounded-md p-1 text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-[#f59e0b] disabled:opacity-50"
          >
            <StarIcon filled={item.isImportant} />
          </button>
        )}
      </div>
    </div>
  )
}
