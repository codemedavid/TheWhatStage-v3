'use server'
import { revalidatePath, revalidateTag } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { WorkspaceInput } from '../_lib/schemas'
import { DEFAULT_PROJECT_STAGES, projectStagesTag } from '../_lib/queries'
import { deleteWorkspaceGuard, resolveDefaultStageId } from '../_lib/workspaces'
import { describeActionError, isRedirectError, type ActionResult, type VoidActionResult } from '../_lib/action-result'
import { seedProjectSequenceRun, cancelActiveProjectSequenceRuns, ensureProjectSequenceRun } from '@/lib/projects/sequences/seed'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

function bust(userId: string): void {
  // Workspace lists/summaries are read uncached, so revalidatePath('layout')
  // refreshes them; only the stage cache needs an explicit tag bust.
  revalidateTag(projectStagesTag(userId), 'max')
  revalidatePath('/dashboard/projects', 'layout')
}

// Create an empty workspace seeded with the default starter stages.
export async function createWorkspace(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = WorkspaceInput.safeParse(raw)
  if (!parsed.success) return { ok: false, error: describeActionError(parsed.error) }
  const input = parsed.data
  const { supabase, userId } = await requireUser()

  try {
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

    bust(userId)
    return { ok: true, id: workspaceId }
  } catch (e) {
    if (isRedirectError(e)) throw e
    return { ok: false, error: describeActionError(e) }
  }
}

// Duplicate a workspace's stages + sequences + follow-up steps + settings into a
// new workspace. Cards (projects) are NOT copied. The copy runs atomically in
// a SECURITY INVOKER RPC so a partial clone can never be left behind.
export async function duplicateWorkspace(
  sourceWorkspaceId: string,
  name?: string,
): Promise<ActionResult<{ id: string }>> {
  const { supabase, userId } = await requireUser()
  try {
    const trimmed = name?.trim() ?? ''
    if (trimmed.length > 60) return { ok: false, error: 'Name must be 60 characters or fewer.' }
    const { data, error } = await supabase.rpc('duplicate_project_workspace', {
      p_workspace_id: sourceWorkspaceId,
      p_name: trimmed || null,
    })
    if (error) throw error
    bust(userId)
    return { ok: true, id: data as string }
  } catch (e) {
    if (isRedirectError(e)) throw e
    return { ok: false, error: describeActionError(e) }
  }
}

export async function updateWorkspace(id: string, raw: unknown): Promise<VoidActionResult> {
  const parsed = WorkspaceInput.safeParse(raw)
  if (!parsed.success) return { ok: false, error: describeActionError(parsed.error) }
  const input = parsed.data
  const { supabase, userId } = await requireUser()
  try {
    const { error } = await supabase
      .from('project_workspaces')
      .update({ name: input.name, description: input.description ?? null, color: input.color ?? null })
      .eq('id', id).eq('user_id', userId)
    if (error) throw error
    bust(userId)
    return { ok: true }
  } catch (e) {
    if (isRedirectError(e)) throw e
    return { ok: false, error: describeActionError(e) }
  }
}

// Delete a workspace. Blocked for the default workspace and for any workspace
// that still holds cards (the DB's on-delete-restrict FK is the backstop).
export async function deleteWorkspace(id: string): Promise<VoidActionResult> {
  const { supabase, userId } = await requireUser()
  try {
    const { data: ws, error: wsErr } = await supabase
      .from('project_workspaces').select('id, is_default')
      .eq('id', id).eq('user_id', userId).maybeSingle()
    if (wsErr) throw wsErr
    if (!ws) return { ok: false, error: 'Workspace not found.' }

    const { count, error: cntErr } = await supabase
      .from('projects').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('workspace_id', id)
    if (cntErr) throw cntErr

    const guard = deleteWorkspaceGuard({ isDefault: ws.is_default as boolean, projectCount: count ?? 0 })
    if (guard) return { ok: false, error: guard }

    const { error } = await supabase
      .from('project_workspaces').delete().eq('id', id).eq('user_id', userId)
    if (error) throw error
    bust(userId)
    return { ok: true }
  } catch (e) {
    if (isRedirectError(e)) throw e
    return { ok: false, error: describeActionError(e) }
  }
}

export async function reorderWorkspaces(orderedIds: string[]): Promise<VoidActionResult> {
  const { supabase, userId } = await requireUser()
  try {
    const results = await Promise.all(
      orderedIds.map((id, position) =>
        supabase.from('project_workspaces').update({ position }).eq('id', id).eq('user_id', userId),
      ),
    )
    for (const r of results) if (r.error) throw r.error
    bust(userId)
    return { ok: true }
  } catch (e) {
    if (isRedirectError(e)) throw e
    return { ok: false, error: describeActionError(e) }
  }
}

// Transfer a card to another workspace. It lands in the destination workspace's
// default stage; the old stage's in-flight sequence is cancelled and the
// destination stage's sequence is (re)seeded, mirroring moveProject across
// stages. The move is recorded in project_stage_events.
export async function moveProjectToWorkspace(
  projectId: string,
  toWorkspaceId: string,
): Promise<VoidActionResult> {
  const { supabase, userId } = await requireUser()
  try {
    const { data: project, error: projErr } = await supabase
      .from('projects').select('id, lead_id, stage_id, workspace_id')
      .eq('id', projectId).eq('user_id', userId).maybeSingle()
    if (projErr) throw projErr
    if (!project) return { ok: false, error: 'Project not found.' }

    if (project.workspace_id === toWorkspaceId) {
      // Already here. Repair a half-applied prior transfer (update + cancel
      // succeeded but the new run failed to seed): ensure the card has a run for
      // its current stage. No-op when a healthy run already exists.
      await ensureProjectSequenceRun(createAdminClient(), {
        userId, projectId, leadId: project.lead_id as string, stageId: project.stage_id as string,
      })
      return { ok: true }
    }

    const { data: targetWs, error: wsErr } = await supabase
      .from('project_workspaces').select('id')
      .eq('id', toWorkspaceId).eq('user_id', userId).maybeSingle()
    if (wsErr) throw wsErr
    if (!targetWs) return { ok: false, error: 'Destination workspace not found.' }

    const destStageId = await resolveDefaultStageId(supabase, userId, toWorkspaceId)
    if (!destStageId) return { ok: false, error: 'Destination workspace has no stage to receive the card.' }

    const { data: maxRow } = await supabase
      .from('projects').select('position')
      .eq('user_id', userId).eq('stage_id', destStageId)
      .order('position', { ascending: false }).limit(1).maybeSingle()
    const nextPos = ((maxRow?.position as number | undefined) ?? -1) + 1

    // workspace_id + stage_id are updated together so the composite FK
    // (workspace_id, stage_id) stays satisfied.
    const { error: updErr } = await supabase
      .from('projects')
      .update({ workspace_id: toWorkspaceId, stage_id: destStageId, position: nextPos })
      .eq('id', projectId).eq('user_id', userId)
    if (updErr) throw updErr

    const { error: evtErr } = await supabase.from('project_stage_events').insert({
      project_id: projectId, user_id: userId,
      from_stage_id: project.stage_id as string, to_stage_id: destStageId,
      source: 'user', reason: 'moved workspace',
    })
    // Best-effort audit row: the move already committed, so a failed event must
    // not fail the action — but never swallow it silently.
    if (evtErr) console.error('[moveProjectToWorkspace] stage event insert failed', evtErr)

    const admin = createAdminClient()
    await cancelActiveProjectSequenceRuns(admin, projectId, 'project moved workspace')
    await seedProjectSequenceRun(admin, {
      userId, projectId, leadId: project.lead_id as string, stageId: destStageId,
    })

    bust(userId)
    return { ok: true }
  } catch (e) {
    if (isRedirectError(e)) throw e
    return { ok: false, error: describeActionError(e) }
  }
}
