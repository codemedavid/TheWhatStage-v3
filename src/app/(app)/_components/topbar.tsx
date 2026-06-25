import { InboxBell } from './InboxBell.client'
import type { InboxItem } from '../dashboard/inbox/_lib/rows'

export function Topbar({
  fullName,
  inboxCount = 0,
  inboxItems = [],
}: {
  fullName: string
  inboxCount?: number
  inboxItems?: InboxItem[]
}) {
  return (
    <header className="ws-topbar flex items-center justify-between border-b border-[#E8E6DE] bg-[var(--ws-bg)] px-6 py-3">
      <div className="text-[13px] text-[#6B6960]">Welcome back</div>
      <div className="flex items-center gap-3">
        <InboxBell count={inboxCount} items={inboxItems} />
        <span className="text-[13.5px] font-medium text-[#1A1915]">
          {fullName || 'Account'}
        </span>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-full border border-[#E8E6DE] bg-white px-4 py-1.5 text-[12.5px] font-medium text-[#3F3D36] hover:bg-[#F6F5F1]"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  )
}
