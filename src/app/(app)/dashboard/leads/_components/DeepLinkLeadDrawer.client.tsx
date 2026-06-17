'use client'
import { useCallback, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { LeadDrawer } from './LeadDrawer'
import type { LeadRow, StageRow, FieldDefRow, CampaignOption } from '../_lib/queries'

type Props = {
  // null when the `?lead=<id>` target does not exist or is not owned by the
  // user — the wrapper then just strips the stale param.
  lead: LeadRow | null
  stages: StageRow[]
  fieldDefs: FieldDefRow[]
  campaigns: CampaignOption[]
}

// Opens the lead drawer for a `?lead=<id>` deep link (e.g. "View lead" links
// from submissions, orders, and reminders).
//
// Closing is driven by local state, NOT by the URL round-trip: stripping the
// `lead` param re-renders the server component asynchronously, and until that
// completes (and through any Suspense re-render in between) `lead` is still
// truthy — so relying on it alone leaves the drawer up and it appears to
// "reopen". We dismiss instantly on the client, then strip the param so a
// refresh/back doesn't bring it back. `dismissedId` is reset whenever a new
// lead id arrives so a fresh deep link still opens.
export function DeepLinkLeadDrawer({ lead, stages, fieldDefs, campaigns }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const [dismissedId, setDismissedId] = useState<string | null>(null)
  // Reset dismissal when the target changes (a different deep link). This is
  // the supported "adjust state during render on prop change" pattern.
  const [trackedId, setTrackedId] = useState<string | null>(lead?.id ?? null)
  if ((lead?.id ?? null) !== trackedId) {
    setTrackedId(lead?.id ?? null)
    setDismissedId(null)
  }

  const stripParam = useCallback(() => {
    const next = new URLSearchParams(sp.toString())
    next.delete('lead')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [router, pathname, sp])

  const handleClose = useCallback(() => {
    if (lead) setDismissedId(lead.id)
    stripParam()
  }, [lead, stripParam])

  // Unresolved target: clear the stale param so the list shows without a
  // dangling `?lead=` and a refresh doesn't keep retrying.
  useEffect(() => {
    if (!lead) stripParam()
  }, [lead, stripParam])

  if (!lead || lead.id === dismissedId) return null

  return (
    <LeadDrawer
      key={lead.id}
      mode="edit"
      lead={lead}
      stages={stages}
      fieldDefs={fieldDefs}
      campaigns={campaigns}
      onClose={handleClose}
    />
  )
}
