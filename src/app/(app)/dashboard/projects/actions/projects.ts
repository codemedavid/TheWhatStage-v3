'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ProjectInput, ProjectUpdateInput } from '../_lib/schemas'
import {
  fetchWorkspaces,
  resolveDefaultStageId,
  resolveDestinationWorkspaceId,
} from '../_lib/workspaces'
import { seedProjectSequenceRun, cancelActiveProjectSequenceRuns } from '@/lib/projects/sequences/seed'
import { resetThreadCountersByLead } from '@/lib/messenger/reset-counters'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

async function resolveDefaultCurrency(
  supabase: Awaited<ReturnType<typeof requireUser>>['supabase'],
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from('business_profiles').select('default_currency')
    .eq('user_id', userId).maybeSingle()
  return (data?.default_currency as string | undefined) ?? 'PHP'
}

export async function createProject(raw: unknown): Promise<string> {
  const input = ProjectInput.parse(raw)
  const { supabase, userId } = await requireUser()

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

  const { data: maxRow } = await supabase
    .from('projects').select('position')
    .eq('user_id', userId).eq('stage_id', input.stage_id)
    .order('position', { ascending: false }).limit(1).maybeSingle()
  const nextPos = (maxRow?.position ?? -1) + 1

  const { data, error } = await supabase
    .from('projects')
    .insert({ user_id: userId, workspace_id: workspaceId, ...input, currency, position: nextPos })
    .select('id').single()
  if (error) throw error

  // Seed a follow-up sequence if the entry stage defines one.
  await seedProjectSequenceRun(createAdminClient(), {
    userId, projectId: data.id, leadId: input.lead_id, stageId: input.stage_id,
  })

  // Baseline the unread/missed counters to zero: the "messages we missed" tally
  // counts forward from the moment the lead becomes a project. RLS-scoped via
  // the user client (lead ownership already verified above).
  await resetThreadCountersByLead(supabase, input.lead_id, { resetMissed: true })

  revalidatePath('/dashboard/projects', 'layout')
  return data.id as string
}

export async function updateProject(id: string, raw: unknown): Promise<void> {
  const input = ProjectUpdateInput.parse(raw)
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (v !== undefined) patch[k] = v
  }
  if (Object.keys(patch).length === 0) return
  const { supabase, userId } = await requireUser()
  const { error } = await supabase.from('projects').update(patch).eq('id', id).eq('user_id', userId)
  if (error) throw error
  revalidatePath('/dashboard/projects', 'layout')
}

export async function deleteProject(id: string): Promise<void> {
  const { supabase, userId } = await requireUser()
  const { error } = await supabase.from('projects').delete().eq('id', id).eq('user_id', userId)
  if (error) throw error
  revalidatePath('/dashboard/projects', 'layout')
}

// Soft-hide a card from the board without deleting it. Archived projects still
// count in every stage/KPI total — they are only filtered out of the board's
// card rendering. Archiving also cancels any in-flight follow-up sequence so the
// bot stops messaging a customer we've set aside.
export async function archiveProject(id: string): Promise<void> {
  const { supabase, userId } = await requireUser()
  const { error } = await supabase
    .from('projects')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', userId)
    .is('archived_at', null)
  if (error) throw error
  await cancelActiveProjectSequenceRuns(createAdminClient(), id, 'project archived')
  revalidatePath('/dashboard/projects', 'layout')
}

// Restore an archived card to the board. Does not re-seed sequences — the
// operator can move the card to re-trigger a stage's follow-up if desired.
export async function unarchiveProject(id: string): Promise<void> {
  const { supabase, userId } = await requireUser()
  const { error } = await supabase
    .from('projects')
    .update({ archived_at: null })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw error
  revalidatePath('/dashboard/projects', 'layout')
}

export async function moveProject(id: string, toStageId: string, toPosition: number): Promise<void> {
  const { supabase, userId } = await requireUser()

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
      from_stage_id: current.stage_id, to_stage_id: toStageId, source: 'user',
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

  revalidatePath('/dashboard/projects', 'layout')
}

export type LeadOption = { id: string; name: string }

// Lightweight customer search for the "New project" lead picker.
export async function searchLeads(q: string): Promise<LeadOption[]> {
  const { supabase, userId } = await requireUser()
  let query = supabase
    .from('leads').select('id, name')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(20)
  const term = q.trim()
  if (term) query = query.ilike('name', `%${term}%`)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as LeadOption[]
}

type SubmissionOverrides = { title?: string; value?: number; workspaceId?: string }

// Lightweight workspace list for the "Create project" workspace picker on the
// action-page submissions and lead drawer. Kept to a single RLS-scoped read so
// the menu opens fast; it does NOT seed a default workspace (the create path's
// resolveDestinationWorkspaceId handles the brand-new-user case), so an empty
// result simply means "create into the default".
export type WorkspaceOption = { id: string; name: string; isDefault: boolean; color: string | null }

export async function listProjectWorkspaces(): Promise<WorkspaceOption[]> {
  const { supabase, userId } = await requireUser()
  const rows = await fetchWorkspaces(supabase, userId)
  return rows.map((w) => ({ id: w.id, name: w.name, isDefault: w.is_default, color: w.color }))
}

// "Mark as project": create a project from an action-page submission, linking
// it back to the originating submission and the submission's lead.
export async function createProjectFromSubmission(
  submissionId: string,
  overrides?: SubmissionOverrides,
): Promise<string> {
  const { supabase, userId } = await requireUser()

  const { data: submission, error: subErr } = await supabase
    .from('action_page_submissions')
    .select('id, lead_id, action_pages(title, kind)')
    .eq('id', submissionId).eq('user_id', userId).maybeSingle()
  if (subErr) throw subErr
  if (!submission) throw new Error('Submission not found')
  if (!submission.lead_id) throw new Error('Submission is not linked to a lead')

  // Resolve the destination workspace: an explicit pick from the action-page /
  // lead-drawer picker (ownership-verified) or the user's default workspace, then
  // drop the card into that workspace's default stage.
  const workspaceId = await resolveDestinationWorkspaceId(supabase, userId, overrides?.workspaceId)
  const stageId = await resolveDefaultStageId(supabase, userId, workspaceId)
  if (!stageId) throw new Error('No default project stage configured')

  const page = Array.isArray(submission.action_pages)
    ? (submission.action_pages[0] ?? null)
    : (submission.action_pages ?? null)
  const title =
    overrides?.title?.trim() ||
    (page?.title as string | undefined) ||
    `Project from ${(page?.kind as string | undefined) ?? 'submission'}`

  const id = await createProject({
    lead_id: submission.lead_id,
    stage_id: stageId,
    origin_submission_id: submissionId,
    title: title.slice(0, 160),
    value: overrides?.value ?? null,
  })

  revalidatePath('/dashboard/leads', 'layout')
  return id
}
