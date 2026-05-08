import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export interface SalesSubmissionItem {
  id: string
  outcome: string | null
  data: Record<string, unknown>
  meta: Record<string, unknown> | null
  created_at: string
  lead_id: string | null
  lead_name: string | null
  source_action_page: {
    id: string
    title: string
    kind: string
    slug: string
  } | null
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug: id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: salesPage } = await supabase
    .from('action_pages')
    .select('id, kind')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle<{ id: string; kind: string }>()
  if (!salesPage)
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (salesPage.kind !== 'sales')
    return NextResponse.json({ error: 'wrong_kind' }, { status: 400 })

  // Submissions tagged via embedded action pages — meta.source_sales_page_id matches.
  const { data: tagged, error: tErr } = await supabase
    .from('action_page_submissions')
    .select(
      'id, outcome, data, meta, created_at, lead_id, action_page_id, leads(name)',
    )
    .eq('user_id', user.id)
    .filter('meta->>source_sales_page_id', 'eq', id)
    .order('created_at', { ascending: false })
    .limit(200)
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })

  // Direct submissions on the sales page itself (fallback form path).
  const { data: direct, error: dErr } = await supabase
    .from('action_page_submissions')
    .select(
      'id, outcome, data, meta, created_at, lead_id, action_page_id, leads(name)',
    )
    .eq('user_id', user.id)
    .eq('action_page_id', id)
    .order('created_at', { ascending: false })
    .limit(200)
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 })

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

  const rows = [
    ...((tagged ?? []) as Row[]),
    ...((direct ?? []) as Row[]),
  ]

  // De-dupe (a submission could in theory satisfy both queries — defensive).
  const seen = new Set<string>()
  const merged: Row[] = []
  for (const r of rows) {
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

  const items: SalesSubmissionItem[] = merged.map((r) => {
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

  return NextResponse.json({ submissions: items })
}
