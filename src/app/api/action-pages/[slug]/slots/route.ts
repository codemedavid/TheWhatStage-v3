import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseBookingConfig } from '@/app/a/[slug]/_kinds/booking/schema'
import {
  computeSlotsForDate,
  type BookingSlotsConfig,
} from '@/lib/action-pages/handlers/booking.slots'

export const dynamic = 'force-dynamic'

/**
 * Public endpoint: GET /api/action-pages/[slug]/slots?date=YYYY-MM-DD
 *
 * Returns the available slots for `date` based on the page's booking config,
 * minus existing booked submissions. No auth — these are public booking pages.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params
  const date = req.nextUrl.searchParams.get('date')
  if (!slug) {
    return NextResponse.json({ error: 'missing_slug' }, { status: 400 })
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'bad_date' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Mirror src/app/a/[slug]/_lib/load.ts for the lookup pattern (admin client,
  // filter by published status).
  const { data: page, error: pageErr } = await admin
    .from('action_pages')
    .select('id, kind, status, config')
    .eq('slug', slug)
    .maybeSingle<{
      id: string
      kind: string
      status: string
      config: Record<string, unknown> | null
    }>()
  if (pageErr) {
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  }
  if (!page || page.status !== 'published' || page.kind !== 'booking') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const config = parseBookingConfig(page.config) satisfies BookingSlotsConfig

  // Pull all booked submissions whose slot_iso falls on the requested date.
  // Range filter on the JSONB text key keeps us inside the configured day in
  // any timezone, then computeSlotsForDate filters precisely.
  const { data: submissions, error: subErr } = await admin
    .from('action_page_submissions')
    .select('data')
    .eq('action_page_id', page.id)
    .eq('outcome', 'booked')
    .gte('data->>slot_iso', `${date}T00:00:00.000Z`)
    .lt('data->>slot_iso', `${nextDay(date)}T00:00:00.000Z`)
  if (subErr) {
    return NextResponse.json({ error: 'submissions_lookup_failed' }, { status: 500 })
  }

  const taken = new Map<string, number>()
  for (const row of submissions ?? []) {
    const iso = (row.data as { slot_iso?: string } | null)?.slot_iso
    if (typeof iso !== 'string') continue
    taken.set(iso, (taken.get(iso) ?? 0) + 1)
  }

  const slots = computeSlotsForDate({
    config,
    dateYmd: date,
    taken,
    now: new Date(),
  })

  // Hard-cap returned `taken` at capacity so clients don't render negative
  // availability if a misconfiguration ever lets multiple bookings through.
  const capped = slots.map((s) => ({
    start_iso: s.start_iso,
    end_iso: s.end_iso,
    capacity: s.capacity,
    taken: Math.min(s.capacity, s.taken),
  }))

  return NextResponse.json({ slots: capped })
}

function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split('-').map((n) => Number(n))
  const next = new Date(Date.UTC(y, m - 1, d + 1))
  const yy = next.getUTCFullYear()
  const mm = String(next.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(next.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}
