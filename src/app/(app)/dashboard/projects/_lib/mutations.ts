import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { seedProjectSequenceRun, cancelActiveProjectSequenceRuns } from '@/lib/projects/sequences/seed'
import { resetThreadCountersByLead } from '@/lib/messenger/reset-counters'
import { ProjectInput, ProjectUpdateInput, ProjectStageInput, WorkspaceInput } from './schemas'
import { DEFAULT_PROJECT_STAGES } from './queries'

// Project write logic shared by the dashboard server actions (cookie session)
// and the MCP server (API key). Every function takes an explicit client +
// owner id and filters by `user_id`, so it is safe to call with the service-role
// client. Callers own cache revalidation.

type StageEventSource = 'user' | 'ai' | 'workflow'

const FALLBACK_CURRENCY = 'PHP'

async function resolveDefaultCurrency(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data } = await supabase
    .from('business_profiles').select('default_currency')
    .eq('user_id', userId).maybeSingle()
  return (data?.default_currency as string | undefined) ?? FALLBACK_CURRENCY
}

// Next free slot at the bottom of a stage column.
export async function nextStagePosition(
  supabase: SupabaseClient,
  userId: string,
  stageId: string,
): Promise<number> {
  const { data: maxRow } = await supabase
    .from('projects').select('position')
    .eq('user_id', userId).eq('stage_id', stageId)
    .order('position', { ascending: false }).limit(1).maybeSingle()
  return ((maxRow?.position as number | undefined) ?? -1) + 1
}

export async function createProjectFor(
  supabase: SupabaseClient,
  userId: string,
  raw: unknown,
): Promise<string> {
  const input = ProjectInput.parse(raw)

  // Authorize the FK target: a project may only be created for the caller's own
  // lead. Without this, a known lead UUID from another tenant could be attached
  // here (project ai_instructions then steer that tenant's bot for that lead).
  const { data: leadOwned } = await supabase
    .from('leads').select('id').eq('id', input.lead_id).eq('user_id', userId).maybeSingle()
  if (!leadOwned) throw new Error('Lead not found')

  // A client may pass origin_submission_id directly; verify ownership so a card
  // can't be linked to another tenant's submission (the FK only checks existence).
  if (input.origin_submission_id) {
    const { data: subOwned } = await supabase
      .from('action_page_submissions').select('id')
      .eq('id', input.origin_submission_id).eq('user_id', userId).maybeSingle()
    if (!subOwned) throw new Error('Submission not found')
  }

  // Resolve the stage's workspace so the card's (workspace_id, stage_id) pair
  // satisfies the composite FK and the card lands on the right board.
  const { data: stageRow, error: stageErr } = await supabase
    .from('project_stages').select('workspace_id')
    .eq('id', input.stage_id).eq('user_id', userId).maybeSingle()
  if (stageErr) throw stageErr
  if (!stageRow) throw new Error('Stage not found')
  const workspaceId = stageRow.workspace_id as string

  const currency = input.currency ?? (await resolveDefaultCurrency(supabase, userId))
  const position = await nextStagePosition(supabase, userId, input.stage_id)

  const { data, error } = await supabase
    .from('projects')
    .insert({ user_id: userId, workspace_id: workspaceId, ...input, currency, position })
    .select('id').single()
  if (error) throw error

  // Seed a follow-up sequence if the entry stage defines one.
  await seedProjectSequenceRun(createAdminClient(), {
    userId, projectId: data.id, leadId: input.lead_id, stageId: input.stage_id,
  })

  // Baseline the unread/missed counters to zero: the "messages we missed" tally
  // counts forward from the moment the lead becomes a project.
  await resetThreadCountersByLead(supabase, input.lead_id, { resetMissed: true }, userId)

  return data.id as string
}

// Returns false when there was nothing to update.
export async function updateProjectFor(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  raw: unknown,
): Promise<boolean> {
  const input = ProjectUpdateInput.parse(raw)
  const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined))
  if (Object.keys(patch).length === 0) return false
  const { error } = await supabase.from('projects').update(patch).eq('id', id).eq('user_id', userId)
  if (error) throw error
  return true
}

// Soft-hide a card from the board without deleting it. Archived projects still
// count in every stage/KPI total — they are only filtered out of the board's
// card rendering. Archiving also cancels any in-flight follow-up sequence so the
// bot stops messaging a customer we've set aside.
export async function archiveProjectFor(supabase: SupabaseClient, userId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .is('archived_at', null)
  if (error) throw error
  await cancelActiveProjectSequenceRuns(createAdminClient(), id, 'project archived')
}

// Restore an archived card to the board. Does not re-seed sequences — the
// operator can move the card to re-trigger a stage's follow-up if desired.
export async function unarchiveProjectFor(supabase: SupabaseClient, userId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('projects')
    .update({ archived_at: null })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw error
}

export async function moveProjectFor(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  toStageId: string,
  toPosition: number,
  opts: { source?: StageEventSource; reason?: string | null } = {},
): Promise<{ stageChanged: boolean }> {
  const source = opts.source ?? 'user'
  const { data: current, error: readErr } = await supabase
    .from('projects').select('stage_id, lead_id')
    .eq('id', id).eq('user_id', userId).maybeSingle()
  if (readErr) throw readErr
  if (!current) throw new Error('Project not found')

  // The composite FK (workspace_id, stage_id) rejects a cross-workspace/foreign
  // stage; user_id scoping keeps the write owner-bound regardless of RLS.
  const { error } = await supabase
    .from('projects')
    .update({ stage_id: toStageId, position: toPosition })
    .eq('id', id).eq('user_id', userId)
  if (error) throw error

  const stageChanged = current.stage_id !== toStageId
  if (stageChanged) {
    const { error: evtErr } = await supabase.from('project_stage_events').insert({
      project_id: id, user_id: userId,
      from_stage_id: current.stage_id, to_stage_id: toStageId, source,
      reason: opts.reason ?? null,
    })
    if (evtErr) console.error('[moveProject] stage event insert failed', evtErr)
    const admin = createAdminClient()
    // Leaving the old stage cancels its in-flight sequence; entering the new
    // stage seeds that stage's sequence (seed also clears any active run).
    await cancelActiveProjectSequenceRuns(admin, id, 'project moved stage')
    await seedProjectSequenceRun(admin, {
      userId, projectId: id, leadId: current.lead_id as string, stageId: toStageId,
    })
  }
  return { stageChanged }
}

// Create an empty workspace seeded with the default starter stages.
export async function createWorkspaceFor(
  supabase: SupabaseClient,
  userId: string,
  raw: unknown,
): Promise<string> {
  const input = WorkspaceInput.parse(raw)
  const { data: maxRow } = await supabase
    .from('project_workspaces').select('position')
    .eq('user_id', userId).order('position', { ascending: false }).limit(1).maybeSingle()
  const nextPos = ((maxRow?.position as number | undefined) ?? -1) + 1

  const { data: ws, error } = await supabase
    .from('project_workspaces')
    .insert({
      user_id: userId,
      name: input.name,
      description: input.description ?? null,
      color: input.color ?? null,
      position: nextPos,
      is_default: false,
    })
    .select('id').single()
  if (error) throw error
  const workspaceId = ws.id as string

  const rows = DEFAULT_PROJECT_STAGES.map((s) => ({ user_id: userId, workspace_id: workspaceId, ...s }))
  const { error: stageErr } = await supabase.from('project_stages').insert(rows)
  if (stageErr) throw stageErr
  return workspaceId
}

export async function createProjectStageFor(
  supabase: SupabaseClient,
  userId: string,
  workspaceId: string,
  raw: unknown,
): Promise<string> {
  const input = ProjectStageInput.parse(raw)

  // Reject a workspace the caller does not own before inserting into it.
  const { data: ws } = await supabase
    .from('project_workspaces').select('id')
    .eq('id', workspaceId).eq('user_id', userId).maybeSingle()
  if (!ws) throw new Error('Workspace not found')

  const { data: maxRow } = await supabase
    .from('project_stages').select('position')
    .eq('user_id', userId).eq('workspace_id', workspaceId).order('position', { ascending: false })
    .limit(1).maybeSingle()
  const nextPos = ((maxRow?.position as number | undefined) ?? -1) + 1

  const { data, error } = await supabase.from('project_stages').insert({
    user_id: userId,
    workspace_id: workspaceId,
    name: input.name,
    description: input.description ?? null,
    kind: input.kind ?? 'open',
    color: input.color ?? null,
    position: nextPos,
    is_default: false,
  }).select('id').single()
  if (error) throw error
  return data.id as string
}
