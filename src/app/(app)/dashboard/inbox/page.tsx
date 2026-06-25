import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { coerceTab } from './_lib/rows'
import { fetchInboxItems, countNeedsReply, countImportant } from './_lib/queries'
import { InboxClient } from './_components/InboxClient'

// Counters move on every inbound webhook, so the inbox is always per-request.
export const dynamic = 'force-dynamic'

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const tab = coerceTab(typeof sp.tab === 'string' ? sp.tab : undefined)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [items, needsReplyCount, importantCount] = await Promise.all([
    fetchInboxItems(supabase, user.id, tab),
    countNeedsReply(supabase, user.id),
    countImportant(supabase, user.id),
  ])

  return (
    <InboxClient
      activeTab={tab}
      items={items}
      needsReplyCount={needsReplyCount}
      importantCount={importantCount}
    />
  )
}
