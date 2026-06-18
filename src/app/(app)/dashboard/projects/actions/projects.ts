'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ProjectInput, ProjectUpdateInput } from '../_lib/schemas'
import { seedProjectSequenceRun, cancelActiveProjectSequenceRuns } from '@/lib/projects/sequences/seed'

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

  const currency = input.currency ?? (await resolveDefaultCurrency(supabase, userId))

  const { data: maxRow } = await supabase
    .from('projects').select('position')
    .eq('user_id', userId).eq('stage_id', input.stage_id)
    .order('position', { ascending: false }).limit(1).maybeSingle()
  const nextPos = (maxRow?.position ?? -1) + 1

  const { data, error } = await supabase
    .from('projects')
    .insert({ user_id: userId, ...input, currency, position: nextPos })
    .select('id').single()
  if (error) throw error

  // Seed a follow-up sequence if the entry stage defines one.
  await seedProjectSequenceRun(createAdminClient(), {
    userId, projectId: data.id, leadId: input.lead_id, stageId: input.stage_id,
  })

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
  const { supabase } = await requireUser()
  const { error } = await supabase.from('projects').update(patch).eq('id', id)
  if (error) throw error
  revalidatePath('/dashboard/projects', 'layout')
}

export async function deleteProject(id: string): Promise<void> {
  const { supabase } = await requireUser()
  const { error } = await supabase.from('projects').delete().eq('id', id)
  if (error) throw error
  revalidatePath('/dashboard/projects', 'layout')
}

export async function moveProject(id: string, toStageId: string, toPosition: number): Promise<void> {
  const { supabase, userId } = await requireUser()

  const { data: current, error: readErr } = await supabase
    .from('projects').select('stage_id, lead_id')
    .eq('id', id).maybeSingle()
  if (readErr) throw readErr
  if (!current) throw new Error('Project not found')

  const { error } = await supabase
    .from('projects')
    .update({ stage_id: toStageId, position: toPosition })
    .eq('id', id)
  if (error) throw error

  const stageChanged = current.stage_id !== toStageId
  if (stageChanged) {
    await supabase.from('project_stage_events').insert({
      project_id: id, user_id: userId,
      from_stage_id: current.stage_id, to_stage_id: toStageId, source: 'user',
    })
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

type SubmissionOverrides = { title?: string; value?: number; stageId?: string }

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

  // Ensure the user has a project board to drop this into.
  const { ensureDefaultProjectStages } = await import('../_lib/queries')
  await ensureDefaultProjectStages(userId)

  let stageId = overrides?.stageId
  if (!stageId) {
    const { data: def } = await supabase
      .from('project_stages').select('id')
      .eq('user_id', userId).eq('is_default', true).maybeSingle()
    if (!def) throw new Error('No default project stage configured')
    stageId = def.id as string
  }

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
