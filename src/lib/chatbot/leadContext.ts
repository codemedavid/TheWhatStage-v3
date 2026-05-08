import type { SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_TZ = 'Asia/Manila'
const BOOKINGS_UPCOMING_CAP = 3
const BOOKINGS_PAST_CAP = 1
const ORDERS_CAP = 5
const ORDER_ITEMS_PREVIEW_CAP = 4
const FORM_SUBMISSIONS_CAP = 3
const SUBMISSION_FETCH_CAP = 30

interface BookingRow {
  id: string
  submission_id: string | null
  event_at: string
  timezone: string | null
  duration_minutes: number | null
  status: string
}

interface OrderItemRow {
  title_snapshot: string | null
  quantity: number | null
  unit_amount: number | null
}

interface OrderRow {
  id: string
  status: string
  payment_status: string
  currency: string | null
  subtotal_amount: number | null
  created_at: string
  business_order_items: OrderItemRow[] | null
}

interface SubmissionRow {
  id: string
  action_page_id: string
  outcome: string | null
  data: Record<string, unknown> | null
  created_at: string
  action_pages: { kind: string; title: string | null } | null
}

export interface LeadContextSnapshot {
  block: string
  isEmpty: boolean
}

export async function loadLeadContext(
  admin: SupabaseClient,
  leadId: string,
): Promise<LeadContextSnapshot> {
  const [bookings, orders, submissions] = await Promise.all([
    fetchBookings(admin, leadId),
    fetchOrders(admin, leadId),
    fetchSubmissions(admin, leadId),
  ])

  const submissionTitleById = new Map(
    submissions.map((s) => [s.id, s.action_pages?.title ?? null]),
  )

  const bookingLines = formatBookings(bookings, submissionTitleById)
  const orderLines = formatOrders(orders)

  const qualificationSub = submissions.find(
    (s) => s.action_pages?.kind === 'qualification',
  )
  const qualificationLines = qualificationSub ? formatQualification(qualificationSub) : []

  const formSubs = submissions
    .filter((s) => {
      const k = s.action_pages?.kind
      return k === 'form' || k === 'sales' || k === 'realestate'
    })
    .slice(0, FORM_SUBMISSIONS_CAP)
  const formLines = formatForms(formSubs)

  const isEmpty =
    bookingLines.length === 0 &&
    orderLines.length === 0 &&
    qualificationLines.length === 0 &&
    formLines.length === 0
  if (isEmpty) return { block: '', isEmpty: true }

  return { block: renderBlock({ bookingLines, orderLines, qualificationLines, formLines }), isEmpty: false }
}

async function fetchBookings(admin: SupabaseClient, leadId: string): Promise<BookingRow[]> {
  const nowIso = new Date().toISOString()
  const [upcomingRes, pastRes] = await Promise.all([
    admin
      .from('booking_events')
      .select('id, submission_id, event_at, timezone, duration_minutes, status')
      .eq('lead_id', leadId)
      .eq('status', 'scheduled')
      .gte('event_at', nowIso)
      .order('event_at', { ascending: true })
      .limit(BOOKINGS_UPCOMING_CAP),
    admin
      .from('booking_events')
      .select('id, submission_id, event_at, timezone, duration_minutes, status')
      .eq('lead_id', leadId)
      .in('status', ['completed', 'scheduled'])
      .lt('event_at', nowIso)
      .order('event_at', { ascending: false })
      .limit(BOOKINGS_PAST_CAP),
  ])
  const upcoming = (upcomingRes.data ?? []) as BookingRow[]
  const past = (pastRes.data ?? []) as BookingRow[]
  return [...upcoming, ...past]
}

async function fetchOrders(admin: SupabaseClient, leadId: string): Promise<OrderRow[]> {
  const { data } = await admin
    .from('business_orders')
    .select(
      'id, status, payment_status, currency, subtotal_amount, created_at, business_order_items(title_snapshot, quantity, unit_amount)',
    )
    .eq('lead_id', leadId)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(ORDERS_CAP)
  return (data ?? []) as OrderRow[]
}

async function fetchSubmissions(admin: SupabaseClient, leadId: string): Promise<SubmissionRow[]> {
  const { data } = await admin
    .from('action_page_submissions')
    .select('id, action_page_id, outcome, data, created_at, action_pages(kind, title)')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(SUBMISSION_FETCH_CAP)
  return (data ?? []) as unknown as SubmissionRow[]
}

export function formatBookings(
  rows: BookingRow[],
  submissionTitleById: Map<string, string | null>,
): string[] {
  if (rows.length === 0) return []
  const nowMs = Date.now()
  return rows.map((b) => {
    const tz = b.timezone || DEFAULT_TZ
    const when = formatDateTimeInTz(b.event_at, tz)
    const tzAbbr = tzShortName(b.event_at, tz)
    const isPast = new Date(b.event_at).getTime() < nowMs
    const tense = isPast ? 'Past' : 'Upcoming'
    const title = (b.submission_id && submissionTitleById.get(b.submission_id)) || 'appointment'
    const dur = b.duration_minutes ? ` (${b.duration_minutes} min)` : ''
    return `- ${tense}: ${when} ${tzAbbr} — "${title}"${dur} — status: ${b.status}`
  })
}

export function formatOrders(rows: OrderRow[]): string[] {
  if (rows.length === 0) return []
  return rows.map((o) => {
    const date = formatDateOnly(o.created_at)
    const total = formatMoney(o.subtotal_amount, o.currency)
    const items = (o.business_order_items ?? []).slice(0, ORDER_ITEMS_PREVIEW_CAP)
    const itemSummary = items.length
      ? items
          .map((it) => {
            const qty = it.quantity ?? 1
            const t = (it.title_snapshot || 'item').trim()
            return `${qty}× ${t}`
          })
          .join(', ')
      : 'no item details on file'
    const moreItems =
      (o.business_order_items?.length ?? 0) > ORDER_ITEMS_PREVIEW_CAP
        ? `, +${(o.business_order_items?.length ?? 0) - ORDER_ITEMS_PREVIEW_CAP} more`
        : ''
    return `- placed ${date} — total ${total} — payment: ${o.payment_status} — fulfillment: ${o.status} — items: ${itemSummary}${moreItems}`
  })
}

export function formatQualification(sub: SubmissionRow): string[] {
  const date = formatDateOnly(sub.created_at)
  const outcome = (sub.outcome || 'submitted').trim()
  const title = (sub.action_pages?.title || 'qualification form').trim()
  const answers = extractQualificationDisplay(sub.data)
  const answersSuffix = answers.length ? ` — answered ${answers.length} questions` : ''
  return [`- ${outcome} on ${date} (page: "${title}")${answersSuffix}`]
}

export function formatForms(subs: SubmissionRow[]): string[] {
  if (subs.length === 0) return []
  return subs.map((s) => {
    const date = formatDateOnly(s.created_at)
    const title = (s.action_pages?.title || 'form').trim()
    const kind = s.action_pages?.kind ?? 'form'
    return `- ${date} — submitted "${title}" (${kind})`
  })
}

export interface RenderInput {
  bookingLines: string[]
  orderLines: string[]
  qualificationLines: string[]
  formLines: string[]
}

export function renderBlock(input: RenderInput): string {
  const sections: string[] = []
  sections.push('Bookings:')
  sections.push(input.bookingLines.length ? input.bookingLines.join('\n') : '- none on file.')
  sections.push('')
  sections.push('Orders:')
  sections.push(input.orderLines.length ? input.orderLines.join('\n') : '- none on file.')
  sections.push('')
  sections.push('Qualification:')
  sections.push(
    input.qualificationLines.length ? input.qualificationLines.join('\n') : '- none on file.',
  )
  sections.push('')
  sections.push('Form submissions:')
  sections.push(input.formLines.length ? input.formLines.join('\n') : '- none on file.')

  return (
    'LEAD CONTEXT — closed-world record (the COMPLETE list of this lead\'s records on file):\n\n' +
    sections.join('\n') +
    '\n\n' +
    'Rules for using LEAD CONTEXT:\n' +
    '- Treat this block as the only source of truth about the lead\'s bookings, orders, qualification, and form submissions. If the lead asks about a record not listed here, say you don\'t see it on file and offer to check — never invent IDs, dates, totals, items, or statuses.\n' +
    '- When stating a date, time, total, item, or status, repeat it verbatim from this block.\n' +
    '- If multiple records could match the lead\'s question, list them and ask which one — do not pick.\n' +
    '- Never reveal a numeric qualification score; only the outcome shown above.\n' +
    '- This block changes between turns; ignore any older claim that contradicts what is listed here right now.'
  )
}

function extractQualificationDisplay(data: Record<string, unknown> | null): unknown[] {
  if (!data) return []
  const a = (data as { answers?: unknown }).answers
  return Array.isArray(a) ? a : []
}

function formatDateTimeInTz(iso: string, tz: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d)
  } catch {
    return d.toISOString()
  }
}

function formatDateOnly(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: DEFAULT_TZ,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    }).format(d)
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

function tzShortName(iso: string, tz: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return tz
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(d)
    const name = parts.find((p) => p.type === 'timeZoneName')?.value
    return name ?? tz
  } catch {
    return tz
  }
}

function formatMoney(amount: number | null, currency: string | null): string {
  if (amount == null || !Number.isFinite(amount)) return 'unknown'
  const cur = (currency || 'PHP').toUpperCase()
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: cur,
      currencyDisplay: 'narrowSymbol',
    }).format(amount)
  } catch {
    return `${cur} ${amount.toFixed(2)}`
  }
}
