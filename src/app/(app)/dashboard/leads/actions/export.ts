'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LeadsQuery } from '../_lib/schemas'
import { fetchStages, fetchFieldDefs, type LeadRow } from '../_lib/queries'
import { leadsToCsv } from '../_lib/csv'

const MAX_EXPORT = 50000

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

export async function exportLeadsCsv(
  rawParams: unknown,
  scope: 'filtered' | 'all',
): Promise<string> {
  const params = LeadsQuery.parse(rawParams)
  const { supabase, userId } = await requireUser()

  const [stages, fieldDefs] = await Promise.all([
    fetchStages(supabase, userId),
    fetchFieldDefs(supabase, userId),
  ])

  let query = supabase
    .from('leads').select('*')
    .eq('user_id', userId)

  if (scope === 'filtered') {
    if (params.stage) query = query.eq('stage_id', params.stage)
    if (params.q) {
      const term = `%${params.q}%`
      query = query.or(
        `name.ilike.${term},email.ilike.${term},phone.ilike.${term},company.ilike.${term}`,
      )
    }
    if (params.from) query = query.gte('created_at', `${params.from}T00:00:00Z`)
    if (params.to)   query = query.lte('created_at', `${params.to}T23:59:59Z`)
  }

  query = query.order('created_at', { ascending: false }).limit(MAX_EXPORT)

  const { data, error } = await query
  if (error) throw error

  return leadsToCsv((data ?? []) as LeadRow[], stages, fieldDefs)
}
