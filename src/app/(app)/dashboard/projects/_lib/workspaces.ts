import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import type { ProjectWorkspaceRow } from '@/lib/projects/types'
import { DEFAULT_PROJECT_STAGES } from './queries'

const NAME_MAX = 60
const DEFAULT_WORKSPACE_NAME = 'Welcome'

// ── Pure helpers (no IO) ──────────────────────────────────────────────────

// Default name when duplicating a workspace, capped at the name length limit.
export function defaultCopyName(name: string): string {
  return `Copy of ${name}`.slice(0, NAME_MAX)
}

// Returns a user-facing reason the workspace cannot be deleted, or null when it
// can. The default workspace is permanent; a workspace must be emptied of cards
// first (mirrors the DB's on-delete-restrict FK and the stage-delete UX).
export function deleteWorkspaceGuard(args: { isDefault: boolean; projectCount: number }): string | null {
  if (args.isDefault) return "The default workspace can't be deleted."
  if (args.projectCount > 0) {
    return `Move or delete this workspace's ${args.projectCount} project(s) first.`
  }
  return null
}

export type WorkspaceSummary = ProjectWorkspaceRow & {
  /** Stages defined in this workspace. */
  stageCount: number
  /** All cards (archived included) — the "is it empty?" count for delete. */
  projectCount: number
  /** Non-archived cards — what the workspace card shows as "N projects". */
  activeProjectCount: number
  /** Sum of non-archived card values. */
  openValue: number
  currency: string
}

type SummaryStage = { workspace_id: string }
type SummaryProject = {
  workspace_id: string
  value: number | null
  archived_at: string | null
  currency?: string | null
}

// Fold flat stage/project rows into per-workspace summary cards. Order follows
// the `workspaces` argument so the index renders in position order.
export function computeWorkspaceSummaries(
  workspaces: ProjectWorkspaceRow[],
  stages: SummaryStage[],
  projects: SummaryProject[],
): WorkspaceSummary[] {
  const stageCount = new Map<string, number>()
  for (const s of stages) stageCount.set(s.workspace_id, (stageCount.get(s.workspace_id) ?? 0) + 1)

  const projectCount = new Map<string, number>()
  const activeCount = new Map<string, number>()
  const openValue = new Map<string, number>()
  const currency = new Map<string, string>()
  for (const p of projects) {
    projectCount.set(p.workspace_id, (projectCount.get(p.workspace_id) ?? 0) + 1)
    if (p.archived_at == null) {
      activeCount.set(p.workspace_id, (activeCount.get(p.workspace_id) ?? 0) + 1)
      openValue.set(p.workspace_id, (openValue.get(p.workspace_id) ?? 0) + (p.value ?? 0))
      if (!currency.has(p.workspace_id) && p.currency) currency.set(p.workspace_id, p.currency)
    }
  }

  return workspaces.map((w) => ({
    ...w,
    stageCount: stageCount.get(w.id) ?? 0,
    projectCount: projectCount.get(w.id) ?? 0,
    activeProjectCount: activeCount.get(w.id) ?? 0,
    openValue: openValue.get(w.id) ?? 0,
    currency: currency.get(w.id) ?? 'PHP',
  }))
}

// ── Data layer ────────────────────────────────────────────────────────────

function normalizeWorkspaceRow(row: Record<string, unknown>): ProjectWorkspaceRow {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    position: row.position as number,
    is_default: row.is_default as boolean,
    color: (row.color as string | null) ?? null,
    updated_at: (row.updated_at as string | null) ?? null,
  }
}

export async function fetchWorkspaces(supabase: SupabaseClient, userId: string): Promise<ProjectWorkspaceRow[]> {
  const { data, error } = await supabase
    .from('project_workspaces').select('*')
    .eq('user_id', userId).order('position', { ascending: true })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeWorkspaceRow)
}

export async function fetchWorkspaceById(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
): Promise<ProjectWorkspaceRow | null> {
  const { data, error } = await supabase
    .from('project_workspaces').select('*')
    .eq('user_id', userId).eq('id', workspaceId).maybeSingle()
  if (error) throw error
  return data ? normalizeWorkspaceRow(data as Record<string, unknown>) : null
}

// The user's default ("Welcome") workspace id, or null when none exists yet.
export async function fetchDefaultWorkspaceId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('project_workspaces').select('id')
    .eq('user_id', userId).eq('is_default', true).maybeSingle()
  if (error) throw error
  return (data?.id as string | undefined) ?? null
}

// Resolve a workspace's default stage (where new cards land). Falls back to the
// lowest-position stage when no stage carries the default flag.
export async function resolveDefaultStageId(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
): Promise<string | null> {
  const { data: def, error } = await supabase
    .from('project_stages').select('id')
    .eq('user_id', userId).eq('workspace_id', workspaceId).eq('is_default', true)
    .maybeSingle()
  if (error) throw error
  if (def?.id) return def.id as string
  const { data: first } = await supabase
    .from('project_stages').select('id')
    .eq('user_id', userId).eq('workspace_id', workspaceId)
    .order('position', { ascending: true }).limit(1).maybeSingle()
  return (first?.id as string | undefined) ?? null
}

// The workspace a card lives in — used to redirect legacy `?project=<id>`
// deep-links to the card's workspace board. Null when not found/owned.
export async function fetchProjectWorkspaceId(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('projects').select('workspace_id')
    .eq('user_id', userId).eq('id', projectId).maybeSingle()
  if (error) throw error
  return (data?.workspace_id as string | undefined) ?? null
}

// Seed a starter workspace ("Welcome", default) + its default stages the first
// time a user touches Projects. Idempotent: only creates what's missing. Uses
// the admin client so it can run from a cached/server context. Returns the
// default workspace id.
export async function ensureDefaultWorkspace(userId: string): Promise<string> {
  const admin = createAdminClient()

  let workspaceId = await readDefaultWorkspaceId(admin, userId)
  if (!workspaceId) {
    const { data: created, error } = await admin
      .from('project_workspaces')
      .insert({ user_id: userId, name: DEFAULT_WORKSPACE_NAME, position: 0, is_default: true })
      .select('id').single()
    // Ignore the unique-violation race (a concurrent first load created it).
    if (error && error.code !== '23505') throw error
    workspaceId = (created?.id as string | undefined) ?? (await readDefaultWorkspaceId(admin, userId))
  }
  if (!workspaceId) throw new Error('Could not resolve a default workspace')

  const { count, error: countErr } = await admin
    .from('project_stages').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('workspace_id', workspaceId)
  if (countErr) throw countErr
  if ((count ?? 0) === 0) {
    const rows = DEFAULT_PROJECT_STAGES.map((s) => ({ user_id: userId, workspace_id: workspaceId, ...s }))
    const { error: insertErr } = await admin.from('project_stages').insert(rows)
    if (insertErr && insertErr.code !== '23505') throw insertErr
  }
  return workspaceId
}

async function readDefaultWorkspaceId(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data } = await admin
    .from('project_workspaces').select('id')
    .eq('user_id', userId).eq('is_default', true).maybeSingle()
  return (data?.id as string | undefined) ?? null
}

// All workspaces + their summary stats for the index grid. Projects are few per
// user, so this fetches the flat stage/project lists and folds them in TS rather
// than running a grouped RPC.
export async function fetchWorkspaceSummaries(
  supabase: SupabaseClient,
  userId: string,
): Promise<WorkspaceSummary[]> {
  const [workspaces, stagesRes, projectsRes] = await Promise.all([
    fetchWorkspaces(supabase, userId),
    supabase.from('project_stages').select('workspace_id').eq('user_id', userId),
    supabase.from('projects').select('workspace_id, value, archived_at, currency').eq('user_id', userId),
  ])
  if (stagesRes.error) throw stagesRes.error
  if (projectsRes.error) throw projectsRes.error
  return computeWorkspaceSummaries(
    workspaces,
    (stagesRes.data ?? []) as SummaryStage[],
    (projectsRes.data ?? []) as SummaryProject[],
  )
}
