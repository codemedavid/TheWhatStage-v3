'use server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LeadsQuery } from '../_lib/schemas'
import { fetchStages, fetchFieldDefs, type LeadRow } from '../_lib/queries'
import { manilaDayStartIso, manilaDayEndIso } from '../_lib/day-bounds'
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
    // Match the on-screen date window: Manila day bounds against last_activity_at.
    if (params.from) query = query.gte('last_activity_at', manilaDayStartIso(params.from))
    if (params.to)   query = query.lte('last_activity_at', manilaDayEndIso(params.to))
  }

  query = query.order('created_at', { ascending: false }).limit(MAX_EXPORT)

  const { data, error } = await query
  if (error) throw error

  return leadsToCsv((data ?? []) as LeadRow[], stages, fieldDefs)
}
