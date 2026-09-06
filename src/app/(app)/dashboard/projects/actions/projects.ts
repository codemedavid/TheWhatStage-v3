'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  fetchWorkspaces,
  resolveDefaultStageId,
  resolveDestinationWorkspaceId,
} from '../_lib/workspaces'
import {
  archiveProjectFor,
  createProjectFor,
  moveProjectFor,
  unarchiveProjectFor,
  updateProjectFor,
} from '../_lib/mutations'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

export async function createProject(raw: unknown): Promise<string> {
  const { supabase, userId } = await requireUser()
  const id = await createProjectFor(supabase, userId, raw)
  revalidatePath('/dashboard/projects', 'layout')
  return id
}

export async function updateProject(id: string, raw: unknown): Promise<void> {
  const { supabase, userId } = await requireUser()
  const changed = await updateProjectFor(supabase, userId, id, raw)
  if (changed) revalidatePath('/dashboard/projects', 'layout')
}

export async function deleteProject(id: string): Promise<void> {
  const { supabase, userId } = await requireUser()
  const { error } = await supabase.from('projects').delete().eq('id', id).eq('user_id', userId)
  if (error) throw error
  revalidatePath('/dashboard/projects', 'layout')
}

// Soft-hide a card from the board without deleting it (see archiveProjectFor).
export async function archiveProject(id: string): Promise<void> {
  const { supabase, userId } = await requireUser()
  await archiveProjectFor(supabase, userId, id)
  revalidatePath('/dashboard/projects', 'layout')
}

export async function unarchiveProject(id: string): Promise<void> {
  const { supabase, userId } = await requireUser()
  await unarchiveProjectFor(supabase, userId, id)
  revalidatePath('/dashboard/projects', 'layout')
}

export async function moveProject(id: string, toStageId: string, toPosition: number): Promise<void> {
  const { supabase, userId } = await requireUser()
  await moveProjectFor(supabase, userId, id, toStageId, toPosition)
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
