'use client'
import { useCallback, useEffect } from 'react'
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
// from submissions, orders, and reminders). On close it strips the `lead` param
// so the drawer does not reopen on back/refresh.
export function DeepLinkLeadDrawer({ lead, stages, fieldDefs, campaigns }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const handleClose = useCallback(() => {
    const next = new URLSearchParams(sp.toString())
    next.delete('lead')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }, [router, pathname, sp])

  // Unresolved target: clear the stale param so the list shows without a
  // dangling `?lead=` and a refresh doesn't keep retrying.
  useEffect(() => {
    if (!lead) handleClose()
  }, [lead, handleClose])

  if (!lead) return null

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
