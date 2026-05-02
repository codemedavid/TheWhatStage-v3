'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export interface LeadSubmission {
  id: string
  action_page_id: string
  action_page_title: string
  action_page_kind: string
  outcome: string | null
  data: Record<string, unknown>
  created_at: string
}

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

/**
 * Load all action-page submissions attributed to a given lead, newest first.
 * Used by the Lead drawer's "Forms" tab. RLS scopes results to the owner.
 */
export async function loadLeadSubmissions(
  leadId: string,
): Promise<LeadSubmission[]> {
  const { supabase } = await requireUser()
  const { data, error } = await supabase
    .from('action_page_submissions')
    .select(
      'id, action_page_id, outcome, data, created_at, action_pages!inner(title, kind)',
    )
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(`loadLeadSubmissions: ${error.message}`)
  return (data ?? []).map((row) => {
    const ap = Array.isArray(row.action_pages)
      ? row.action_pages[0]
      : (row.action_pages as { title: string; kind: string } | null)
    return {
      id: row.id as string,
      action_page_id: row.action_page_id as string,
      action_page_title: ap?.title ?? 'Untitled page',
      action_page_kind: ap?.kind ?? 'unknown',
      outcome: (row.outcome as string | null) ?? null,
      data: (row.data as Record<string, unknown>) ?? {},
      created_at: row.created_at as string,
    }
  })
}
