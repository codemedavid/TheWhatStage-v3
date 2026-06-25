import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActionPageKind } from '@/lib/action-pages/kinds'
import type { ProjectStageKind } from '@/lib/projects/types'
import type { PipelineRule } from './schemas'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeThreadCounts } from '@/lib/messenger/unread'
import { STAGE_EMBED } from '@/lib/projects/stage-embed'

export interface ActionPageRow {
  id: string
  kind: ActionPageKind
  slug: string
  title: string
  description: string | null
  status: 'draft' | 'published' | 'archived'
  config: Record<string, unknown>
  pipeline_rules: PipelineRule[]
  capi_event_name_override: string | null
  notification_template: { text?: string; echo_payment_proof?: boolean } | null
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
      'id, kind, slug, title, description, status, config, pipeline_rules, capi_event_name_override, notification_template, cta_label, bot_send_instructions, signing_secret, created_at, updated_at',
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
  messenger_full_name: string | null
  created_at: string
}

// Supabase's default `max-rows` ceiling. The submissions view computes its
// stats (Total / This month / This week / outcome breakdown) from the rows it
// receives, so a low cap silently understates every count. Pull up to the
// platform ceiling so the totals reflect reality for a single action page.
const SUBMISSIONS_FETCH_LIMIT = 1000

export async function fetchSubmissions(
  supabase: SupabaseClient,
  userId: string,
  actionPageId: string,
  limit = SUBMISSIONS_FETCH_LIMIT,
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
      messenger_full_name: null as string | null,
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
    const fbNameByKey = new Map<string, string>()
    for (const t of (threads ?? []) as Array<{
      psid: string
      page_id: string
      full_name: string | null
      leads: { name?: string } | { name?: string }[] | null
    }>) {
      const linkedLead = Array.isArray(t.leads) ? t.leads[0] : t.leads
      const resolved = linkedLead?.name || t.full_name
      if (resolved) nameByKey.set(`${t.page_id}:${t.psid}`, resolved)
      if (t.full_name) fbNameByKey.set(`${t.page_id}:${t.psid}`, t.full_name)
    }
    for (const r of rows) {
      if (r.psid && r.page_id) {
        r.messenger_name = nameByKey.get(`${r.page_id}:${r.psid}`) ?? null
        r.messenger_full_name = fbNameByKey.get(`${r.page_id}:${r.psid}`) ?? null
      }
    }
  }

  return rows
}

// The project a submission was turned into, plus its current stage. Lets the
// submissions view show the live deal stage (e.g. "Scoping", "Won") instead of
// a static "Project assigned" badge, while still linking to the project.
export interface SubmissionProjectInfo {
  id: string
  stageName: string | null
  stageKind: ProjectStageKind | null
  /** Unread inbound messages waiting on the project's lead (Messenger thread). */
  unreadCount: number
  /** Running "messages we missed" tally; resets only on explicit mark-as-read. */
  missedCount: number
}

type ThreadCountJoin =
  | { unread_count: number | null; missed_count: number | null }
  | { unread_count: number | null; missed_count: number | null }[]
  | null
type LeadThreadJoin =
  | { messenger_threads: ThreadCountJoin }
  | { messenger_threads: ThreadCountJoin }[]
  | null
type SubmissionProjectJoin = {
  id: string
  origin_submission_id: string | null
  project_stages: { name: string; kind: ProjectStageKind | null } | { name: string; kind: ProjectStageKind | null }[] | null
  leads: LeadThreadJoin
}

function firstOf<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

// Map submission id → existing project info, for submissions that have already
// been turned into a project (origin_submission_id link).
export async function fetchProjectInfoBySubmissionIds(
  supabase: SupabaseClient,
  userId: string,
  submissionIds: string[],
): Promise<Map<string, SubmissionProjectInfo>> {
  const map = new Map<string, SubmissionProjectInfo>()
  if (submissionIds.length === 0) return map
  const { data, error } = await supabase
    .from('projects')
    .select(`id, origin_submission_id, ${STAGE_EMBED}(name, kind), leads(messenger_threads(unread_count, missed_count))`)
    .eq('user_id', userId)
    .in('origin_submission_id', submissionIds)
  if (error) throw new Error(`fetchProjectInfoBySubmissionIds: ${error.message}`)
  for (const row of (data ?? []) as SubmissionProjectJoin[]) {
    if (!row.origin_submission_id) continue
    const stage = firstOf(row.project_stages)
    const thread = firstOf(firstOf(row.leads)?.messenger_threads)
    const counts = normalizeThreadCounts(thread)
    map.set(row.origin_submission_id, {
      id: row.id,
      stageName: stage?.name ?? null,
      stageKind: stage?.kind ?? null,
      unreadCount: counts.unread_count,
      missedCount: counts.missed_count,
    })
  }
  return map
}

export interface PipelineStageOption {
  id: string
  name: string
  kind: string | null
}

export async function fetchPipelineStages(
  _supabase: SupabaseClient,
  userId: string,
): Promise<PipelineStageOption[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('pipeline_stages')
    .select('id, name, kind, position')
    .eq('user_id', userId)
    .order('position', { ascending: true })
  if (error) throw new Error(`fetchPipelineStages: ${error.message}`)
  return (data ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
    kind: (s.kind as string | null) ?? null,
  }))
}

export interface ActionPageOption {
  id: string
  kind: ActionPageKind
  title: string
  status: ActionPageRow['status']
}

export async function fetchActionPageOptions(
  supabase: SupabaseClient,
  userId: string,
): Promise<ActionPageOption[]> {
  const { data, error } = await supabase
    .from('action_pages')
    .select('id, kind, title, status, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  if (error) throw new Error(`fetchActionPageOptions: ${error.message}`)
  return (data ?? []).map((p) => ({
    id: p.id as string,
    kind: p.kind as ActionPageKind,
    title: p.title as string,
    status: p.status as ActionPageRow['status'],
  }))
}

export async function fetchPrimaryActionPageId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('chatbot_configs')
    .select('primary_action_page_id')
    .eq('user_id', userId)
    .maybeSingle<{ primary_action_page_id: string | null }>()
  if (error) throw new Error(`fetchPrimaryActionPageId: ${error.message}`)
  return data?.primary_action_page_id ?? null
}
