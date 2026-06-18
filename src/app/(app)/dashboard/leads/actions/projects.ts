'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  fetchProjectsByLead,
  ensureDefaultProjectStages,
  type ProjectCardRow,
} from '../../projects/_lib/queries'
import { createProject } from '../../projects/actions/projects'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

// List every project for a lead, newest first — powers the lead drawer's
// Projects tab so a customer's deals show up on the lead automatically.
export async function loadLeadProjects(leadId: string): Promise<ProjectCardRow[]> {
  const { supabase, userId } = await requireUser()
  return fetchProjectsByLead(supabase, userId, leadId)
}

// Create a project for a lead straight from the lead drawer, dropping it into
// the user's default project stage. Mirrors createProjectFromSubmission's stage
// resolution; createProject seeds the stage's follow-up sequence if any.
export async function createLeadProject(leadId: string, title?: string): Promise<string> {
  const { supabase, userId } = await requireUser()

  const { data: lead, error: leadErr } = await supabase
    .from('leads').select('id, name')
    .eq('id', leadId).eq('user_id', userId).maybeSingle()
  if (leadErr) throw leadErr
  if (!lead) throw new Error('Lead not found')

  await ensureDefaultProjectStages(userId)
  const { data: def } = await supabase
    .from('project_stages').select('id')
    .eq('user_id', userId).eq('is_default', true).maybeSingle()
  if (!def) throw new Error('No default project stage configured')

  const resolvedTitle = (title?.trim() || `Project — ${lead.name ?? 'customer'}`).slice(0, 160)
  const id = await createProject({
    lead_id: leadId,
    stage_id: def.id as string,
    title: resolvedTitle,
  })

  revalidatePath('/dashboard/leads', 'layout')
  return id
}
