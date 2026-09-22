// Pure helpers for the "who can we actually call?" view of a lead.
//
// A lead's official `phone` / `email` columns are what an operator typed in.
// `phones[]` / `emails[]` are everything we ever saw them send — form fields,
// catalog checkouts, and phone numbers typed mid-conversation. The call list
// cares about the second set, so these helpers work off it.

import type { LeadContactValue, LeadRow } from '@/data/types'

/** Latest phone and email we hold for one lead, plus when either last landed. */
export interface LatestContacts {
  phone: LeadContactValue | null
  email: LeadContactValue | null
  latestAt: string | null
}

const EMPTY: LatestContacts = { phone: null, email: null, latestAt: null }

export function hasContact(lead: Pick<LeadRow, 'phones' | 'emails' | 'phone' | 'email'>): boolean {
  return (
    (lead.phones?.length ?? 0) > 0 ||
    (lead.emails?.length ?? 0) > 0 ||
    !!lead.phone?.trim() ||
    !!lead.email?.trim()
  )
}

export function hasPhone(lead: Pick<LeadRow, 'phones' | 'phone'>): boolean {
  return (lead.phones?.length ?? 0) > 0 || !!lead.phone?.trim()
}

/**
 * Collapse a `collected_at desc` stream of contact rows into one entry per lead.
 * Relies on the caller's ordering rather than re-sorting: the query already
 * returns newest first, so the first row seen per (lead, kind) is the latest.
 */
export function indexLatestContacts(
  rows: readonly LeadContactValue[],
): Map<string, LatestContacts> {
  const index = new Map<string, LatestContacts>()
  for (const row of rows) {
    const current = index.get(row.lead_id) ?? EMPTY
    if (row.kind === 'phone' && current.phone) continue
    if (row.kind === 'email' && current.email) continue
    const next: LatestContacts = {
      phone: row.kind === 'phone' ? row : current.phone,
      email: row.kind === 'email' ? row : current.email,
      latestAt: current.latestAt ?? row.collected_at,
    }
    index.set(row.lead_id, next)
  }
  return index
}

/** Latest-contact timestamp, falling back to plain lead activity. */
function contactRank(lead: LeadRow, index: Map<string, LatestContacts>): string {
  return index.get(lead.id)?.latestAt ?? lead.last_activity_at ?? ''
}

/**
 * Newest-contact-first ordering: the lead who handed over a number most
 * recently sits at the top of the call list. Returns a new array.
 *
 * Compares the ISO timestamps as plain strings — they sort chronologically
 * byte-for-byte, and `localeCompare` would apply collation rules that ignore
 * the `-` and `:` separators.
 */
export function sortByLatestContact(
  leads: readonly LeadRow[],
  index: Map<string, LatestContacts>,
): LeadRow[] {
  return [...leads].sort((a, b) => {
    const left = contactRank(a, index)
    const right = contactRank(b, index)
    if (left === right) return 0
    return left > right ? -1 : 1
  })
}

/** First value with something in it, or null. */
export function firstFilled(...values: (string | null | undefined)[]): string | null {
  for (const v of values) {
    const trimmed = v?.trim()
    if (trimmed) return trimmed
  }
  return null
}

const SOURCE_LABELS: Record<string, string> = {
  messenger: 'Sent in chat',
  form: 'Form',
  booking: 'Booking',
  catalog: 'Order',
  manual: 'Added by you',
}

export function contactSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source
}

/** `tel:` rejects spaces and separators; keep digits and a leading `+`. */
export function dialable(value: string): string {
  const trimmed = value.trim()
  const digits = trimmed.replace(/[^0-9]/g, '')
  return trimmed.startsWith('+') ? `+${digits}` : digits
}
