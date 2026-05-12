import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchActionPage, fetchSubmissions } from '../../_lib/queries'
import type { SubmissionListItem } from '../../_lib/queries'
import BookingSubmissionsView from './BookingSubmissionsView'
import type { BookingEntry } from './BookingSubmissionsView'
import PropertySubmissionsView, {
  type PropertySubmissionRow,
} from './PropertySubmissionsView'
import CatalogOrdersView, { type CatalogOrderEntry } from './CatalogOrdersView'

export default async function SubmissionsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const page = await fetchActionPage(supabase, user.id, id)
  if (!page) notFound()

  // For realestate pages, "submissions" means anything tagged with this
  // property id via the meta convention — fetched separately.
  if (page.kind === 'realestate') {
    const { data: rows } = await supabase
      .from('action_page_submissions')
      .select(
        'id, outcome, data, meta, created_at, lead_id, action_page_id, leads(name)',
      )
      .eq('user_id', user.id)
      .filter('meta->>source_property_action_page_id', 'eq', id)
      .order('created_at', { ascending: false })
      .limit(200)

    const sourceIds = Array.from(
      new Set(((rows ?? []) as Array<{ action_page_id: string }>).map((r) => r.action_page_id)),
    )
    const sourceById = new Map<
      string,
      { id: string; title: string; kind: string; slug: string }
    >()
    if (sourceIds.length > 0) {
      const { data: sources } = await supabase
        .from('action_pages')
        .select('id, title, kind, slug')
        .in('id', sourceIds)
        .eq('user_id', user.id)
      for (const s of (sources ?? []) as Array<{
        id: string
        title: string
        kind: string
        slug: string
      }>) {
        sourceById.set(s.id, s)
      }
    }

    const submissionRows: PropertySubmissionRow[] = (
      (rows ?? []) as Array<{
        id: string
        outcome: string | null
        data: Record<string, unknown>
        meta: Record<string, unknown> | null
        created_at: string
        lead_id: string | null
        action_page_id: string
        leads: { name?: string } | { name?: string }[] | null
      }>
    ).map((r) => {
      const lead = Array.isArray(r.leads) ? r.leads[0] : r.leads
      return {
        id: r.id,
        outcome: r.outcome ?? null,
        data: r.data ?? {},
        meta: r.meta ?? null,
        created_at: r.created_at,
        lead_id: r.lead_id ?? null,
        lead_name: lead?.name ?? null,
        source_action_page: sourceById.get(r.action_page_id) ?? null,
      }
    })

    return (
      <PropertySubmissionsView
        pageId={id}
        pageTitle={page.title}
        pageStatus={page.status}
        submissions={submissionRows}
      />
    )
  }

  // For sales pages, "submissions" means anything tagged with this sales page
  // id via meta.source_sales_page_id, plus any direct submissions on the
  // sales page itself (fallback form path).
  if (page.kind === 'sales') {
    const [taggedRes, directRes] = await Promise.all([
      supabase
        .from('action_page_submissions')
        .select(
          'id, outcome, data, meta, created_at, lead_id, action_page_id, leads(name)',
        )
        .eq('user_id', user.id)
        .filter('meta->>source_sales_page_id', 'eq', id)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('action_page_submissions')
        .select(
          'id, outcome, data, meta, created_at, lead_id, action_page_id, leads(name)',
        )
        .eq('user_id', user.id)
        .eq('action_page_id', id)
        .order('created_at', { ascending: false })
        .limit(200),
    ])

    type Row = {
      id: string
      outcome: string | null
      data: Record<string, unknown>
      meta: Record<string, unknown> | null
      created_at: string
      lead_id: string | null
      action_page_id: string
      leads: { name?: string } | { name?: string }[] | null
    }

    const seen = new Set<string>()
    const merged: Row[] = []
    for (const r of [
      ...((taggedRes.data ?? []) as Row[]),
      ...((directRes.data ?? []) as Row[]),
    ]) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      merged.push(r)
    }
    merged.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )

    const sourceIds = Array.from(new Set(merged.map((r) => r.action_page_id)))
    const sourceById = new Map<
      string,
      { id: string; title: string; kind: string; slug: string }
    >()
    if (sourceIds.length > 0) {
      const { data: sources } = await supabase
        .from('action_pages')
        .select('id, title, kind, slug')
        .in('id', sourceIds)
        .eq('user_id', user.id)
      for (const s of (sources ?? []) as Array<{
        id: string
        title: string
        kind: string
        slug: string
      }>) {
        sourceById.set(s.id, s)
      }
    }

    const submissionRows: PropertySubmissionRow[] = merged.map((r) => {
      const lead = Array.isArray(r.leads) ? r.leads[0] : r.leads
      return {
        id: r.id,
        outcome: r.outcome ?? null,
        data: r.data ?? {},
        meta: r.meta ?? null,
        created_at: r.created_at,
        lead_id: r.lead_id ?? null,
        lead_name: lead?.name ?? null,
        source_action_page: sourceById.get(r.action_page_id) ?? null,
      }
    })

    return (
      <PropertySubmissionsView
        pageId={id}
        pageTitle={page.title}
        pageStatus={page.status}
        submissions={submissionRows}
        breadcrumbLabel="Sales submissions"
        editLabel="Edit sales page"
        description="Forms, bookings, qualifications, and direct submissions collected from this sales page."
        emptyMessage="No submissions yet. When buyers fill out the form (or a linked action page) on this sales page, their submissions will appear here."
      />
    )
  }

  /* ---- Catalog kind: fetch from business_orders for rich order data ---- */
  if (page.kind === 'catalog') {
    const { data: rawOrders } = await supabase
      .from('business_orders')
      .select('id, payment_status, currency, subtotal_amount, customer_name, customer_email, customer_phone, customer_notes, created_at, psid, lead_id, business_order_items(title_snapshot, quantity, unit_amount, line_total_amount, currency)')
      .eq('action_page_id', id)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(500)

    const catalogOrders: CatalogOrderEntry[] = ((rawOrders ?? []) as Array<{
      id: string
      payment_status: string
      currency: string
      subtotal_amount: number
      customer_name: string | null
      customer_email: string | null
      customer_phone: string | null
      customer_notes: string | null
      created_at: string
      psid: string | null
      lead_id: string | null
      business_order_items: Array<{
        title_snapshot: string
        quantity: number
        unit_amount: number
        line_total_amount: number
        currency: string
      }>
    }>).map(o => ({
      id: o.id,
      shortId: '#' + o.id.replace(/-/g, '').slice(0, 6),
      createdAt: o.created_at,
      dateKey: o.created_at.slice(0, 10),
      paymentStatus: o.payment_status as CatalogOrderEntry['paymentStatus'],
      currency: o.currency,
      subtotalAmount: Number(o.subtotal_amount),
      customerName: o.customer_name,
      customerEmail: o.customer_email,
      customerPhone: o.customer_phone,
      customerNotes: o.customer_notes,
      items: (o.business_order_items ?? []).map(i => ({
        title: i.title_snapshot,
        quantity: i.quantity,
        unitAmount: Number(i.unit_amount),
        lineTotalAmount: Number(i.line_total_amount),
        currency: i.currency,
      })),
      source: o.psid ? 'Messenger' : 'Web',
      leadId: o.lead_id,
    }))

    return (
      <CatalogOrdersView
        orders={catalogOrders}
        pageTitle={page.title}
        pageStatus={page.status}
        pageId={id}
      />
    )
  }

  const submissions = await fetchSubmissions(supabase, user.id, id)

  const kind = page.kind

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  /* ---- Booking kind: transform to BookingEntry[] and render premium view ---- */
  if (kind === 'booking') {
    const entries: BookingEntry[] = submissions.map((s) => {
      const data = s.data as Record<string, unknown>
      const slotIso = typeof data.slot_iso === 'string' ? data.slot_iso : null
      const fields = data.fields && typeof data.fields === 'object'
        ? (data.fields as Record<string, unknown>)
        : {}

      const rawName =
        (typeof fields.full_name === 'string' ? fields.full_name : null) ??
        s.lead_name ??
        s.messenger_name ??
        'Anonymous'
      const phone = typeof fields.phone === 'string' ? fields.phone : ''

      // Derive dateKey
      let dateKey: string
      if (slotIso) {
        const d = new Date(slotIso)
        dateKey = Number.isNaN(d.getTime())
          ? s.created_at.slice(0, 10)
          : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      } else {
        dateKey = s.created_at.slice(0, 10)
      }

      // Derive time
      let timeShort = ''
      let meridiem = ''
      if (slotIso) {
        const d = new Date(slotIso)
        if (!Number.isNaN(d.getTime())) {
          const h = d.getHours()
          const m = d.getMinutes()
          timeShort = String(h % 12 || 12) + (m !== 0 ? `:${String(m).padStart(2, '0')}` : '')
          meridiem = h >= 12 ? 'PM' : 'AM'
        }
      }

      // Derive status
      let status: BookingEntry['status']
      if (s.outcome === 'no_show') {
        status = 'no-show'
      } else if (s.outcome === 'booked') {
        const slotTime = slotIso ? new Date(slotIso).getTime() : NaN
        status = !Number.isNaN(slotTime) && slotTime > now.getTime() ? 'upcoming' : 'completed'
      } else {
        status = 'failed'
      }

      // Initials
      const initials = rawName === 'Anonymous'
        ? '?'
        : rawName
          .split(' ')
          .filter(Boolean)
          .slice(0, 2)
          .map((w: string) => w[0]?.toUpperCase() ?? '')
          .join('')

      return {
        id: s.id,
        slotIso,
        dateKey,
        timeShort,
        meridiem,
        name: rawName,
        initials,
        phone,
        source: s.psid ? 'Messenger' : 'Web',
        status,
        createdAt: s.created_at,
        leadId: s.lead_id,
        outcome: s.outcome,
      }
    })

    return (
      <BookingSubmissionsView
        entries={entries}
        pageTitle={page.title}
        pageStatus={page.status}
        pageId={id}
      />
    )
  }

  /* ---- All other kinds: original layout ---- */
  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-16">
      {/* Top bar */}
      <div className="flex items-center gap-3 pt-1">
        <Link
          href="/dashboard/action-pages"
          className="flex items-center gap-1.5 text-[12px] text-[#6B7280] hover:text-[#111827]"
        >
          <ChevronLeft size={12} />
          Action Pages
        </Link>
        <span className="text-[#D1D5DB]">/</span>
        <span className="truncate max-w-[180px] text-[12px] font-medium text-[#374151]">
          {page.title}
        </span>
        <span className="text-[#D1D5DB]">/</span>
        <span className="text-[12px] text-[#6B7280]">Submissions</span>
        <div className="flex-1" />
        <Link
          href={`/dashboard/action-pages/${id}`}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-[12px] font-medium text-[#374151] hover:bg-[#F9FAFB] transition-colors"
        >
          <PencilIcon />
          Edit page
        </Link>
      </div>

      {/* Page header */}
      <div className="flex items-start gap-4">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
          style={{ background: KIND_TINT[kind] + '20', color: KIND_TINT[kind] }}
        >
          <KindIcon kind={kind} size={20} />
        </div>
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-[#111827] leading-tight">
            {page.title}
          </h1>
          <p className="mt-0.5 flex items-center gap-2 text-[13px] text-[#6B7280]">
            <span>{KIND_LABEL[kind] ?? kind}</span>
            <span className="text-[#E5E7EB]">·</span>
            <span>{submissions.length} total</span>
            {page.status === 'published' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#D1FAE5] px-2 py-0.5 text-[11px] font-medium text-[#065F46]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
                Live
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Kind-specific stats + content */}
      {kind === 'form' && (
        <FormView
          submissions={submissions}
          monthStart={monthStart}
          weekAgo={weekAgo}
        />
      )}
      {kind === 'qualification' && (
        <QualificationView
          submissions={submissions}
          weekAgo={weekAgo}
        />
      )}
      {kind !== 'form' && kind !== 'qualification' && (
        <GenericView submissions={submissions} />
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════
   FORM VIEW  (grouped by submitted date)
═══════════════════════════════════════════════ */

function FormView({
  submissions,
  monthStart,
  weekAgo,
}: {
  submissions: SubmissionListItem[]
  monthStart: Date
  weekAgo: Date
}) {
  const submitted = submissions.filter((s) => s.outcome === 'submitted' || !s.outcome)
  const thisMonth = submitted.filter((s) => new Date(s.created_at) >= monthStart)
  const thisWeek = submitted.filter((s) => new Date(s.created_at) >= weekAgo)
  const groups = groupByCreatedDate(submissions)

  return (
    <>
      <div className="grid grid-cols-3 gap-3">
        <StatCard value={submitted.length} label="Total submissions" color="violet" />
        <StatCard value={thisMonth.length} label="This month" color="indigo" />
        <StatCard value={thisWeek.length} label="This week" color="blue" />
      </div>

      {submissions.length === 0 ? (
        <EmptyState icon="form" message="No submissions yet. Responses will appear here once leads fill the form." />
      ) : (
        <div className="space-y-8">
          {groups.map(({ dateKey, dateLabel, isToday, items }) => (
            <section key={dateKey}>
              <DayDivider label={dateLabel} count={items.length} isToday={isToday} />
              <div className="space-y-2.5">
                {items.map((s) => (
                  <FormCard key={s.id} submission={s} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  )
}

function FormCard({ submission: s }: { submission: SubmissionListItem }) {
  const data = s.data as Record<string, unknown>
  const fields = data.fields && typeof data.fields === 'object'
    ? (data.fields as Record<string, unknown>)
    : {}

  return (
    <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-shadow">
      <PersonContent submission={s} fields={fields} />
    </div>
  )
}

/* ═══════════════════════════════════════════════
   QUALIFICATION VIEW
═══════════════════════════════════════════════ */

function formatOutcomeLabel(outcome: string): string {
  return OUTCOME_META[outcome]?.label ?? outcome.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function qualificationStatColor(outcome: string): 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'indigo' {
  if (/disqual|lost|not_fit/i.test(outcome)) return 'red'
  if (/review|pending/i.test(outcome)) return 'amber'
  if (/qual|won|hot/i.test(outcome)) return 'green'
  return 'indigo'
}

function QualificationView({
  submissions,
  weekAgo,
}: {
  submissions: SubmissionListItem[]
  weekAgo: Date
}) {
  const outcomeCounts = Array.from(
    submissions.reduce((map, s) => {
      const key = s.outcome || 'unknown'
      map.set(key, (map.get(key) ?? 0) + 1)
      return map
    }, new Map<string, number>()),
  ).sort((a, b) => b[1] - a[1])
  const thisWeek = submissions.filter((s) => new Date(s.created_at) >= weekAgo)
  const groups = groupByCreatedDate(submissions)

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {outcomeCounts.slice(0, 3).map(([outcome, count]) => (
          <StatCard
            key={outcome}
            value={count}
            label={formatOutcomeLabel(outcome)}
            color={qualificationStatColor(outcome)}
          />
        ))}
        <StatCard value={thisWeek.length} label="This week" color="blue" />
      </div>

      {submissions.length === 0 ? (
        <EmptyState icon="workflow" message="No responses yet. Qualification results will appear once leads complete the quiz." />
      ) : (
        <div className="space-y-8">
          {groups.map(({ dateKey, dateLabel, isToday, items }) => (
            <section key={dateKey}>
              <DayDivider label={dateLabel} count={items.length} isToday={isToday} />
              <div className="space-y-2.5">
                {items.map((s) => (
                  <QualificationCard key={s.id} submission={s} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  )
}

function QualificationCard({ submission: s }: { submission: SubmissionListItem }) {
  const data = s.data as Record<string, unknown>
  const answers = Array.isArray(data.answers) ? data.answers : []
  const score = typeof data.score === 'number' ? data.score : null

  const outcomeMeta = OUTCOME_META[s.outcome ?? ''] ?? {
    bg: '#F3F4F6', text: '#6B7280', label: s.outcome ?? '—',
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-shadow">
      <div className="flex flex-col gap-3 p-4">
        {/* Person row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF] text-[#3B82F6]">
              <PersonIcon size={14} />
            </div>
            <div className="min-w-0">
              {s.lead_id ? (
                <Link
                  href={`/dashboard/leads?lead=${s.lead_id}`}
                  className="block truncate text-[14px] font-semibold text-[#111827] hover:text-[#0EA5E9] transition-colors"
                >
                  {s.lead_name ?? s.messenger_name ?? 'Unknown lead'}
                </Link>
              ) : (
                <span className="block truncate text-[14px] font-semibold text-[#374151]">
                  {s.lead_name ?? s.messenger_name ?? 'Anonymous'}
                </span>
              )}
              <div className="mt-0.5 flex items-center gap-2">
                {s.psid && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-[#6B7280]">
                    <MessengerIcon size={10} />
                    via Messenger
                  </span>
                )}
                {s.lead_id && (
                  <Link href={`/dashboard/leads?lead=${s.lead_id}`} className="text-[11px] text-[#0EA5E9] hover:underline">
                    View lead →
                  </Link>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              <span
                className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                style={{ background: outcomeMeta.bg, color: outcomeMeta.text }}
              >
                {outcomeMeta.label}
              </span>
              {score !== null && (
                <span className="text-[12px] font-medium text-[#374151]">
                  {score.toFixed(1)} pts
                </span>
              )}
            </div>
            <span className="text-[11px] text-[#9CA3AF]">{relTime(new Date(s.created_at))}</span>
          </div>
        </div>

        {/* Answers */}
        {answers.length > 0 && (
          <div className="border-t border-[#F3F4F6] pt-3 space-y-2">
            {answers.map((a: Record<string, unknown>, i: number) => {
              const prompt = typeof a.prompt === 'string' ? a.prompt : `Q${i + 1}`
              const display = a.display
              const displayStr = Array.isArray(display)
                ? display.join(', ')
                : typeof display === 'string'
                  ? display
                  : typeof a.value === 'string'
                    ? a.value
                    : '—'
              return (
                <div key={i} className="grid grid-cols-[1fr_auto] gap-3 items-start">
                  <span className="text-[12px] text-[#6B7280] leading-snug">{prompt}</span>
                  <span className="text-right text-[12.5px] font-medium text-[#374151] leading-snug max-w-[200px] break-words">
                    {displayStr || '—'}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   CATALOG VIEW
═══════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════
   GENERIC VIEW  (sales, realestate, unknown)
═══════════════════════════════════════════════ */

function countThisWeek(submissions: SubmissionListItem[]): number {
  const oneWeekAgo = new Date(Date.now() - 604800000)
  return submissions.filter((s) => new Date(s.created_at) >= oneWeekAgo).length
}

function GenericView({ submissions }: { submissions: SubmissionListItem[] }) {
  const groups = groupByCreatedDate(submissions)
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <StatCard value={submissions.length} label="Total submissions" color="indigo" />
        <StatCard
          value={countThisWeek(submissions)}
          label="This week"
          color="blue"
        />
      </div>

      {submissions.length === 0 ? (
        <EmptyState icon="actions" message="No submissions yet." />
      ) : (
        <div className="space-y-8">
          {groups.map(({ dateKey, dateLabel, isToday, items }) => (
            <section key={dateKey}>
              <DayDivider label={dateLabel} count={items.length} isToday={isToday} />
              <div className="space-y-2.5">
                {items.map((s) => (
                  <GenericCard key={s.id} submission={s} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  )
}

function GenericCard({ submission: s }: { submission: SubmissionListItem }) {
  const entries = Object.entries(s.data ?? {})

  return (
    <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#F3F4F6] text-[#6B7280]">
              <PersonIcon size={14} />
            </div>
            <div className="min-w-0">
              {s.lead_id ? (
                <Link
                  href={`/dashboard/leads?lead=${s.lead_id}`}
                  className="block truncate text-[14px] font-semibold text-[#111827] hover:text-[#0EA5E9] transition-colors"
                >
                  {s.lead_name ?? s.messenger_name ?? 'Unknown lead'}
                </Link>
              ) : (
                <span className="text-[14px] font-semibold text-[#374151]">{s.messenger_name ?? 'Anonymous'}</span>
              )}
              {s.psid && (
                <span className="mt-0.5 flex items-center gap-1 text-[11px] text-[#6B7280]">
                  <MessengerIcon size={10} />
                  via Messenger
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {s.outcome && (
              <span className="rounded-full bg-[#F3F4F6] px-2.5 py-0.5 text-[11px] font-medium text-[#374151]">
                {s.outcome}
              </span>
            )}
            <span className="text-[11px] text-[#9CA3AF]">{relTime(new Date(s.created_at))}</span>
          </div>
        </div>
        {entries.length > 0 && (
          <div className="grid grid-cols-1 gap-1.5 border-t border-[#F3F4F6] pt-2 sm:grid-cols-2">
            {entries.map(([k, v]) => (
              <FieldRow key={k} label={humanize(k)} value={formatFieldValue(v)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   SHARED PIECES
═══════════════════════════════════════════════ */

function PersonContent({
  submission: s,
  fields,
}: {
  submission: SubmissionListItem
  fields: Record<string, unknown>
}) {
  return (
    <div className="flex flex-1 flex-col gap-2 p-4 min-w-0">
      {/* Person row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#EFF6FF] text-[#3B82F6]">
            <PersonIcon size={14} />
          </div>
          <div className="min-w-0">
            {s.lead_id ? (
              <Link
                href={`/dashboard/leads?lead=${s.lead_id}`}
                className="block truncate text-[14px] font-semibold text-[#111827] hover:text-[#0EA5E9] transition-colors"
              >
                {s.lead_name ?? s.messenger_name ?? 'Unknown lead'}
              </Link>
            ) : (
              <span className="block truncate text-[14px] font-semibold text-[#374151]">
                {s.lead_name ?? s.messenger_name ?? 'Anonymous'}
              </span>
            )}
            <div className="mt-0.5 flex items-center gap-2">
              {s.psid && (
                <span className="inline-flex items-center gap-1 text-[11px] text-[#6B7280]">
                  <MessengerIcon size={10} />
                  via Messenger
                </span>
              )}
              {s.lead_id && (
                <Link href={`/dashboard/leads?lead=${s.lead_id}`} className="text-[11px] text-[#0EA5E9] hover:underline">
                  View lead →
                </Link>
              )}
            </div>
          </div>
        </div>
        <span className="shrink-0 text-[11px] text-[#9CA3AF]">
          {relTime(new Date(s.created_at))}
        </span>
      </div>

      {/* Fields */}
      {Object.keys(fields).length > 0 && (
        <div className="mt-1 grid grid-cols-1 gap-1.5 border-t border-[#F3F4F6] pt-2 sm:grid-cols-2">
          {Object.entries(fields).map(([key, val]) => (
            <FieldRow key={key} label={humanize(key)} value={formatFieldValue(val)} />
          ))}
        </div>
      )}
    </div>
  )
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5 min-w-0">
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-wide text-[#9CA3AF]">
        {label}
      </span>
      <span className="truncate text-[12.5px] text-[#374151]">{value}</span>
    </div>
  )
}

function DayDivider({
  label,
  count,
  isToday,
}: {
  label: string
  count: number
  isToday: boolean
}) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <div className="flex items-center gap-2">
        {isToday && (
          <span className="rounded-full bg-[#0EA5E9] px-2 py-0.5 text-[11px] font-semibold text-white">
            TODAY
          </span>
        )}
        <span className="text-[14px] font-semibold text-[#111827]">{label}</span>
      </div>
      <div className="flex-1 border-t border-[#E5E7EB]" />
      <span className="text-[12px] text-[#9CA3AF]">
        {count} {count === 1 ? 'submission' : 'submissions'}
      </span>
    </div>
  )
}

function StatCard({
  value,
  label,
  color,
}: {
  value: number
  label: string
  color: 'blue' | 'indigo' | 'violet' | 'amber' | 'gray' | 'green' | 'red'
}) {
  const colorMap: Record<string, { bg: string; num: string; text: string }> = {
    blue:   { bg: '#EFF6FF', num: '#2563EB', text: '#1D4ED8' },
    indigo: { bg: '#EEF2FF', num: '#4F46E5', text: '#4338CA' },
    violet: { bg: '#F5F3FF', num: '#7C3AED', text: '#6D28D9' },
    amber:  { bg: '#FFFBEB', num: '#D97706', text: '#B45309' },
    gray:   { bg: '#F9FAFB', num: '#9CA3AF', text: '#6B7280' },
    green:  { bg: '#F0FDF4', num: '#16A34A', text: '#15803D' },
    red:    { bg: '#FFF1F2', num: '#E11D48', text: '#BE123C' },
  }
  const c = colorMap[color]
  return (
    <div className="rounded-xl px-4 py-3" style={{ background: c.bg }}>
      <div className="text-[28px] font-bold leading-none tabular-nums" style={{ color: c.num }}>
        {value}
      </div>
      <div className="mt-1 text-[12px] font-medium" style={{ color: c.text }}>
        {label}
      </div>
    </div>
  )
}

function EmptyState({ icon, message }: { icon: string; message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[#D1D5DB] bg-white px-6 py-14 text-center">
      <div
        className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ background: '#F0F9FF', color: '#0EA5E9' }}
      >
        <KindIcon kind={icon} size={26} />
      </div>
      <p className="text-[13px] text-[#6B7280]">{message}</p>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   GROUPING HELPERS
═══════════════════════════════════════════════ */

interface DayGroup {
  dateKey: string
  dateLabel: string
  isToday: boolean
  items: SubmissionListItem[]
}

function groupByCreatedDate(submissions: SubmissionListItem[]): DayGroup[] {
  const todayKey = new Date().toISOString().slice(0, 10)
  const map = new Map<string, SubmissionListItem[]>()
  for (const s of submissions) {
    const key = s.created_at.slice(0, 10)
    const arr = map.get(key) ?? []
    arr.push(s)
    map.set(key, arr)
  }
  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dateKey, items]) => ({
      dateKey,
      dateLabel: formatDateLabel(dateKey),
      isToday: dateKey === todayKey,
      items: items.sort((a, b) => b.created_at.localeCompare(a.created_at)),
    }))
}

function formatDateLabel(dateKey: string): string {
  const d = new Date(dateKey + 'T12:00:00Z')
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

/* ═══════════════════════════════════════════════
   FORMATTING
═══════════════════════════════════════════════ */

function formatFieldValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return String(v)
  if (Array.isArray(v)) return v.map((x) => formatFieldValue(x)).join(', ')
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${humanize(k)}: ${formatFieldValue(val)}`)
      .join(' · ')
  }
  return String(v)
}

function humanize(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function relTime(d: Date): string {
  const ms = Date.now() - d.getTime()
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  const wk = Math.floor(day / 7)
  if (wk < 5) return `${wk}w ago`
  const mo = Math.floor(day / 30)
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(day / 365)}y ago`
}

/* ═══════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════ */

const KIND_TINT: Record<string, string> = {
  booking:       '#0EA5E9',
  form:          '#8B5CF6',
  qualification: '#F59E0B',
  catalog:       '#1F7A4D',
  sales:         '#EC4899',
  realestate:    '#6366F1',
}

const KIND_LABEL: Record<string, string> = {
  booking:       'Booking',
  form:          'Form',
  qualification: 'Qualification',
  catalog:       'Catalog',
  sales:         'Sales Page',
  realestate:    'Real Estate',
}

const OUTCOME_META: Record<string, { bg: string; text: string; label: string }> = {
  qualified:      { bg: '#D1FAE5', text: '#065F46', label: 'Qualified' },
  disqualified:   { bg: '#FEE2E2', text: '#991B1B', label: 'Disqualified' },
  pending_review: { bg: '#FEF3C7', text: '#92400E', label: 'Pending review' },
  submitted:      { bg: '#EFF6FF', text: '#1D4ED8', label: 'Submitted' },
  booked:         { bg: '#D1FAE5', text: '#065F46', label: 'Booked' },
  checked_out:    { bg: '#D1FAE5', text: '#065F46', label: 'Checked out' },
  invalid:        { bg: '#FEE2E2', text: '#991B1B', label: 'Invalid' },
}

/* ═══════════════════════════════════════════════
   ICONS
═══════════════════════════════════════════════ */

function KindIcon({ kind, size = 18 }: { kind: string; size?: number }) {
  const p = {
    width: size, height: size, viewBox: '0 0 24 24',
    fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.75, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  }
  switch (kind) {
    case 'calendar':
    case 'booking':
      return <svg {...p} aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
    case 'form':
      return <svg {...p} aria-hidden="true"><path d="M4 4h12a3 3 0 013 3v13a2 2 0 00-2-2H4z" /><path d="M4 4v15M8 8h7M8 11h7" /></svg>
    case 'workflow':
    case 'qualification':
      return <svg {...p} aria-hidden="true"><rect x="3" y="3" width="6" height="6" rx="1.5" /><rect x="15" y="15" width="6" height="6" rx="1.5" /><rect x="15" y="3" width="6" height="6" rx="1.5" /><path d="M9 6h6M18 9v6" /></svg>
    case 'layers':
    case 'catalog':
      return <svg {...p} aria-hidden="true"><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5M3 17l9 5 9-5" /></svg>
    default:
      return <svg {...p} aria-hidden="true"><path d="M4 5h16M4 12h10M4 19h16" /><circle cx="18" cy="12" r="2.5" fill="currentColor" stroke="none" /></svg>
  }
}

function ChevronLeft({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="15 6 9 12 15 18" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  )
}

function PersonIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  )
}

function MessengerIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.145 2 11.243c0 2.908 1.437 5.51 3.687 7.21V22l3.37-1.852C10.077 20.374 11.02 20.5 12 20.5c5.523 0 10-4.145 10-9.257C22 6.145 17.523 2 12 2zm1.05 12.47l-2.55-2.72-4.98 2.72 5.48-5.82 2.6 2.72 4.93-2.72-5.48 5.82z" />
    </svg>
  )
}

