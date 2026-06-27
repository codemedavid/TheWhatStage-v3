'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LeadsQuery } from '../_lib/schemas'
import {
  fetchStages,
  fetchFieldDefs,
  fetchContactsForExport,
  fetchLatestProjectStatusByLead,
} from '../_lib/queries'
import { contactsToCsv, type ContactExportRow } from '../_lib/contacts-csv'

const MAX_EXPORT = 50000

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

// Export the Contacts view as CSV: every reachable phone/email plus the lead's
// most recent project status. `scope: 'filtered'` honours the on-screen contact
// filter, search, and date window; `scope: 'all'` exports all reachable contacts.
export async function exportContactsCsv(
  rawParams: unknown,
  scope: 'filtered' | 'all',
): Promise<string> {
  const params = LeadsQuery.parse(rawParams)
  const { supabase, userId } = await requireUser()

  const [stages, fieldDefs, contacts] = await Promise.all([
    fetchStages(supabase, userId),
    fetchFieldDefs(supabase, userId),
    fetchContactsForExport(supabase, userId, params, scope, MAX_EXPORT),
  ])

  const statusByLead = await fetchLatestProjectStatusByLead(
    supabase,
    userId,
    contacts.map((c) => c.id),
  )

  const rows: ContactExportRow[] = contacts.map((c) => ({
    ...c,
    project_status: statusByLead.get(c.id) ?? null,
  }))

  return contactsToCsv(rows, stages, fieldDefs)
}
