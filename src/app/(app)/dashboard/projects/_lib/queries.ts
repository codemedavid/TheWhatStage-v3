import type { SupabaseClient } from '@supabase/supabase-js'
import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ProjectRow, ProjectStageRow, ProjectStageKind } from '@/lib/projects/types'
import { type ProjectsQuery, PAGE_SIZE } from './schemas'

export type { ProjectStageRow, ProjectStageKind } from '@/lib/projects/types'

export const projectsTag = (userId: string) => `projects:list:${userId}`
export const projectStagesTag = (userId: string) => `projects:stages:${userId}`

const SORT_MAP: Record<ProjectsQuery['sort'], { col: string; asc: boolean; nullsLast?: boolean }> = {
  recent:     { col: 'created_at', asc: false },
  oldest:     { col: 'created_at', asc: true  },
  title_asc:  { col: 'title',      asc: true  },
  value_desc: { col: 'value',      asc: false, nullsLast: true },
}

export type ProjectCardRow = ProjectRow & {
  lead_name: string | null
  lead_email: string | null
  lead_phone: string | null
  lead_company: string | null
  lead_picture_url: string | null
  stage_name: string | null
  stage_kind: ProjectStageKind | null
  origin_submission_kind: string | null
}

type LeadJoin = {
  name: string | null
  email: string | null
  phone: string | null
  company: string | null
  messenger_threads: { picture_url: string | null }[] | { picture_url: string | null } | null
}
type StageJoin = { name: string; kind: ProjectStageKind | null }

type ProjectRowWithJoins = ProjectRow & {
  leads: LeadJoin | LeadJoin[] | null
  project_stages: StageJoin | StageJoin[] | null
}

function first<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

function flattenProject(row: ProjectRowWithJoins): ProjectCardRow {
  const { leads, project_stages, ...rest } = row
  const lead = first(leads)
  const stage = first(project_stages)
  const thread = lead ? first(lead.messenger_threads) : null
  return {
    ...rest,
    lead_name: lead?.name ?? null,
    lead_email: lead?.email ?? null,
    lead_phone: lead?.phone ?? null,
    lead_company: lead?.company ?? null,
    lead_picture_url: thread?.picture_url ?? null,
    stage_name: stage?.name ?? null,
    stage_kind: stage?.kind ?? null,
    origin_submission_kind: null,
  }
}

const PROJECT_SELECT =
  '*, leads(name, email, phone, company, messenger_threads(picture_url)), project_stages(name, kind)'

function normalizeStageRow(row: Record<string, unknown>): ProjectStageRow {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    position: row.position as number,
    is_default: row.is_default as boolean,
    kind: (row.kind as ProjectStageKind | null) ?? null,
    color: (row.color as string | null) ?? null,
  }
}

export async function fetchProjectStages(supabase: SupabaseClient, userId: string): Promise<ProjectStageRow[]> {
  const { data, error } = await supabase
    .from('project_stages').select('*')
    .eq('user_id', userId).order('position', { ascending: true })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeStageRow)
}

// Cached variant — admin client because unstable_cache runs outside request
// scope; user_id filter preserves isolation. Invalidate via revalidateTag.
export function fetchProjectStagesCached(userId: string): Promise<ProjectStageRow[]> {
  return unstable_cache(
    async (uid: string) => {
      const admin = createAdminClient()
      const { data, error } = await admin
        .from('project_stages').select('*')
        .eq('user_id', uid).order('position', { ascending: true })
      if (error) throw error
      return ((data ?? []) as Record<string, unknown>[]).map(normalizeStageRow)
    },
    ['project-stages', userId],
    { tags: [projectStagesTag(userId)], revalidate: 3600 },
  )(userId)
}

const DEFAULT_PROJECT_STAGES: Array<{ name: string; position: number; is_default: boolean; kind: ProjectStageKind; color: string | null }> = [
  { name: 'New',         position: 0, is_default: true,  kind: 'open', color: null },
  { name: 'Scoping',     position: 1, is_default: false, kind: 'open', color: null },
  { name: 'Proposal',    position: 2, is_default: false, kind: 'open', color: null },
  { name: 'Negotiation', position: 3, is_default: false, kind: 'open', color: null },
  { name: 'Won',         position: 4, is_default: false, kind: 'won',  color: '#16a34a' },
  { name: 'Lost',        position: 5, is_default: false, kind: 'lost', color: '#dc2626' },
]

// Seed a starter board the first time a user opens Projects. Idempotent: only
// inserts when the user has zero stages. Uses the admin client so it can run
// from a cached/server context.
export async function ensureDefaultProjectStages(userId: string): Promise<void> {
  const admin = createAdminClient()
  const { count, error } = await admin
    .from('project_stages').select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (error) throw error
  if ((count ?? 0) > 0) return
  const rows = DEFAULT_PROJECT_STAGES.map((s) => ({ user_id: userId, ...s }))
  const { error: insertErr } = await admin.from('project_stages').insert(rows)
  // Ignore unique-violation races (a concurrent first load seeded already).
  if (insertErr && insertErr.code !== '23505') throw insertErr
}

// Best-effort enrichment of the origin-submission kind (form/booking/etc.) for
// card badges. Mutates rows in place; missing kinds stay null.
async function populateOriginKind(supabase: SupabaseClient, rows: ProjectCardRow[]): Promise<void> {
  const ids = [...new Set(rows.map((r) => r.origin_submission_id).filter((id): id is string => !!id))]
  if (ids.length === 0) return
  const { data } = await supabase
    .from('action_page_submissions')
    .select('id, action_pages(kind)')
    .in('id', ids)
  const kindById = new Map<string, string | null>()
  type Row = { id: string; action_pages: { kind: string } | { kind: string }[] | null }
  for (const r of (data ?? []) as Row[]) {
    const page = first(r.action_pages)
    kindById.set(r.id, page?.kind ?? null)
  }
  for (const r of rows) {
    if (r.origin_submission_id) r.origin_submission_kind = kindById.get(r.origin_submission_id) ?? null
  }
}

export async function fetchProjectsPage(
  supabase: SupabaseClient,
  userId: string,
  params: ProjectsQuery,
  stageId?: string,
): Promise<{ rows: ProjectCardRow[]; total: number }> {
  const sort = SORT_MAP[params.sort]
  let query = supabase
    .from('projects').select(PROJECT_SELECT, { count: 'exact' })
    .eq('user_id', userId)
  if (stageId) query = query.eq('stage_id', stageId)
  if (params.q) {
    const term = `%${params.q}%`
    query = query.or(`title.ilike.${term},description.ilike.${term}`)
  }
  query = query.order(sort.col, { ascending: sort.asc, nullsFirst: !sort.nullsLast })

  const from = (params.page - 1) * PAGE_SIZE
  const to   = from + PAGE_SIZE - 1
  const { data, error, count } = await query.range(from, to)
  if (error) throw error
  const rows = ((data ?? []) as ProjectRowWithJoins[]).map(flattenProject)
  await populateOriginKind(supabase, rows)
  return { rows, total: count ?? 0 }
}

// All projects for the board, ordered for column grouping. Projects are far
// fewer than leads per user, so the board loads them in one shot (no paging).
export async function fetchBoardProjects(
  supabase: SupabaseClient,
  userId: string,
): Promise<ProjectCardRow[]> {
  const { data, error } = await supabase
    .from('projects').select(PROJECT_SELECT)
    .eq('user_id', userId)
    .order('stage_id', { ascending: true })
    .order('position', { ascending: true })
  if (error) throw error
  const rows = ((data ?? []) as ProjectRowWithJoins[]).map(flattenProject)
  await populateOriginKind(supabase, rows)
  return rows
}

export async function fetchProjectById(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<ProjectCardRow | null> {
  const { data, error } = await supabase
    .from('projects').select(PROJECT_SELECT)
    .eq('user_id', userId).eq('id', projectId).maybeSingle()
  if (error) throw error
  if (!data) return null
  const rows = [flattenProject(data as ProjectRowWithJoins)]
  await populateOriginKind(supabase, rows)
  return rows[0]
}

export async function fetchProjectsByLead(
  supabase: SupabaseClient,
  userId: string,
  leadId: string,
): Promise<ProjectCardRow[]> {
  const { data, error } = await supabase
    .from('projects').select(PROJECT_SELECT)
    .eq('user_id', userId).eq('lead_id', leadId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  const rows = ((data ?? []) as ProjectRowWithJoins[]).map(flattenProject)
  await populateOriginKind(supabase, rows)
  return rows
}

export type StageSequenceStep = {
  id: string
  position: number
  delay_minutes: number
  instruction: string
  fallback_message: string | null
  channel: 'messenger'
}

export type StageSequence = {
  id: string | null
  enabled: boolean
  steps: StageSequenceStep[]
}

export async function fetchStageSequence(
  supabase: SupabaseClient,
  userId: string,
  stageId: string,
): Promise<StageSequence> {
  const { data: seq, error } = await supabase
    .from('project_stage_sequences')
    .select('id, enabled')
    .eq('user_id', userId).eq('stage_id', stageId).maybeSingle()
  if (error) throw error
  if (!seq) return { id: null, enabled: false, steps: [] }

  const { data: steps, error: stepErr } = await supabase
    .from('project_stage_sequence_steps')
    .select('id, position, delay_minutes, instruction, fallback_message, channel')
    .eq('sequence_id', seq.id).order('position', { ascending: true })
  if (stepErr) throw stepErr

  return {
    id: seq.id as string,
    enabled: seq.enabled as boolean,
    steps: (steps ?? []) as StageSequenceStep[],
  }
}
