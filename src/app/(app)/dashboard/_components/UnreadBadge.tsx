import { formatBadgeCount } from '@/lib/messenger/unread'

type Props = {
  count: number
  /** 'unread' = solid red "waiting on us"; 'missed' = muted "we missed". */
  variant?: 'unread' | 'missed'
  title?: string
}

// Small count pill shown on cards / rows when a client has messaged. Renders
// nothing when the count is zero, so callers can drop it in unconditionally.
export function UnreadBadge({ count, variant = 'unread', title }: Props) {
  const label = formatBadgeCount(count)
  if (!label) return null
  const isUnread = variant === 'unread'
  return (
    <span
      title={title ?? (isUnread ? `${count} unread` : `${count} missed`)}
      className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-semibold tabular-nums leading-none"
      style={
        isUnread
          ? { background: '#dc2626', color: '#ffffff' }
          : { background: 'var(--lead-surface-2, #f1efe8)', color: '#b45309', border: '1px solid #fcd34d' }
      }
    >
      {label}
    </span>
  )
}
