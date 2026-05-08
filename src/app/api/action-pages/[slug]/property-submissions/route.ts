import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export interface PropertySubmissionItem {
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

  const { data: property } = await supabase
    .from('action_pages')
    .select('id, kind')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle<{ id: string; kind: string }>()
  if (!property)
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (property.kind !== 'realestate')
    return NextResponse.json({ error: 'wrong_kind' }, { status: 400 })

  const { data, error } = await supabase
    .from('action_page_submissions')
    .select(
      'id, outcome, data, meta, created_at, lead_id, action_page_id, leads(name)',
    )
    .eq('user_id', user.id)
    .filter('meta->>source_property_action_page_id', 'eq', id)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as Array<{
    id: string
    outcome: string | null
    data: Record<string, unknown>
    meta: Record<string, unknown> | null
    created_at: string
    lead_id: string | null
    action_page_id: string
    leads: { name?: string } | { name?: string }[] | null
  }>

  const sourceIds = Array.from(new Set(rows.map((r) => r.action_page_id)))
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

  const items: PropertySubmissionItem[] = rows.map((r) => {
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
