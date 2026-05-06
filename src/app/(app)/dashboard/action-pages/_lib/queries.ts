import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActionPageKind } from '@/lib/action-pages/kinds'
import type { PipelineRule } from './schemas'

export interface ActionPageRow {
  id: string
  kind: ActionPageKind
  slug: string
  title: string
  description: string | null
  status: 'draft' | 'published' | 'archived'
  config: Record<string, unknown>
  pipeline_rules: PipelineRule[]
  notification_template: { text?: string } | null
  cta_label: string | null
  bot_send_instructions: string | null
  signing_secret: string
  created_at: string
  updated_at: string
}

export interface ActionPageListItem {
  id: string
  kind: ActionPageKind
  slug: string
  title: string
  status: ActionPageRow['status']
  submission_count: number
  updated_at: string
}

export async function fetchActionPages(
  supabase: SupabaseClient,
  userId: string,
): Promise<ActionPageListItem[]> {
  const { data: pages, error } = await supabase
    .from('action_pages')
    .select('id, kind, slug, title, status, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  if (error) throw new Error(`fetchActionPages: ${error.message}`)
  if (!pages?.length) return []

  const ids = pages.map((p) => p.id as string)
  const { data: counts, error: cErr } = await supabase
    .from('action_page_submissions')
    .select('action_page_id')
    .in('action_page_id', ids)
  if (cErr) throw new Error(`fetchActionPages submission counts: ${cErr.message}`)

  const tally = new Map<string, number>()
  for (const row of counts ?? []) {
    const id = row.action_page_id as string
    tally.set(id, (tally.get(id) ?? 0) + 1)
  }

  return pages.map((p) => ({
    id: p.id as string,
    kind: p.kind as ActionPageKind,
    slug: p.slug as string,
    title: p.title as string,
    status: p.status as ActionPageRow['status'],
    submission_count: tally.get(p.id as string) ?? 0,
    updated_at: p.updated_at as string,
  }))
}

export async function fetchActionPage(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<ActionPageRow | null> {
  const { data, error } = await supabase
    .from('action_pages')
    .select(
      'id, kind, slug, title, description, status, config, pipeline_rules, notification_template, cta_label, bot_send_instructions, signing_secret, created_at, updated_at',
    )
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle<ActionPageRow>()
  if (error) throw new Error(`fetchActionPage: ${error.message}`)
  return data ?? null
}

export interface SubmissionListItem {
  id: string
  outcome: string | null
  data: Record<string, unknown>
  psid: string | null
  page_id: string | null
  lead_id: string | null
  lead_name: string | null
  messenger_name: string | null
  created_at: string
}

export async function fetchSubmissions(
  supabase: SupabaseClient,
  userId: string,
  actionPageId: string,
  limit = 100,
): Promise<SubmissionListItem[]> {
  const { data, error } = await supabase
    .from('action_page_submissions')
    .select('id, outcome, data, psid, page_id, lead_id, created_at, leads(name)')
    .eq('user_id', userId)
    .eq('action_page_id', actionPageId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`fetchSubmissions: ${error.message}`)

  const rows = (data ?? []).map((row) => {
    const lead = Array.isArray(row.leads)
      ? row.leads[0]
      : (row.leads as { name?: string } | null)
    return {
      id: row.id as string,
      outcome: (row.outcome as string | null) ?? null,
      data: (row.data as Record<string, unknown>) ?? {},
      psid: (row.psid as string | null) ?? null,
      page_id: (row.page_id as string | null) ?? null,
      lead_id: (row.lead_id as string | null) ?? null,
      lead_name: lead?.name ?? null,
      messenger_name: null as string | null,
      created_at: row.created_at as string,
    }
  })

  const psids = Array.from(
    new Set(rows.filter((r) => r.psid && r.page_id).map((r) => r.psid as string)),
  )
  const pageIds = Array.from(
    new Set(rows.filter((r) => r.psid && r.page_id).map((r) => r.page_id as string)),
  )
  if (psids.length > 0 && pageIds.length > 0) {
    const { data: threads } = await supabase
      .from('messenger_threads')
      .select('psid, page_id, full_name, leads(name)')
      .in('psid', psids)
      .in('page_id', pageIds)
    const nameByKey = new Map<string, string>()
    for (const t of (threads ?? []) as Array<{
      psid: string
      page_id: string
      full_name: string | null
      leads: { name?: string } | { name?: string }[] | null
    }>) {
      const linkedLead = Array.isArray(t.leads) ? t.leads[0] : t.leads
      const resolved = linkedLead?.name || t.full_name
      if (resolved) nameByKey.set(`${t.page_id}:${t.psid}`, resolved)
    }
    for (const r of rows) {
      if (r.psid && r.page_id) {
        r.messenger_name = nameByKey.get(`${r.page_id}:${r.psid}`) ?? null
      }
    }
  }

  return rows
}

export async function fetchPipelineStages(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from('pipeline_stages')
    .select('id, name, position')
    .eq('user_id', userId)
    .order('position', { ascending: true })
  if (error) throw new Error(`fetchPipelineStages: ${error.message}`)
  return (data ?? []).map((s) => ({ id: s.id as string, name: s.name as string }))
}
