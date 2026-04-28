import type { SupabaseClient } from '@supabase/supabase-js'
import { type LeadsQuery, PAGE_SIZE } from './schemas'

const SORT_MAP: Record<LeadsQuery['sort'], { col: string; asc: boolean; nullsLast?: boolean }> = {
  recent:     { col: 'created_at',      asc: false },
  oldest:     { col: 'created_at',      asc: true  },
  name_asc:   { col: 'name',            asc: true  },
  value_desc: { col: 'estimated_value', asc: false, nullsLast: true },
}

export type LeadRow = {
  id: string
  stage_id: string
  name: string
  email: string | null
  phone: string | null
  company: string | null
  job_title: string | null
  source: string | null
  estimated_value: number | null
  notes: string | null
  custom_fields: Record<string, unknown>
  position: number
  created_at: string
  updated_at: string
}

export type StageRow = {
  id: string
  name: string
  description: string | null
  position: number
  is_default: boolean
}

export type FieldDefRow = {
  id: string
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'select'
  options: string[] | null
  position: number
}

export async function fetchStages(supabase: SupabaseClient, userId: string): Promise<StageRow[]> {
  const { data, error } = await supabase
    .from('pipeline_stages').select('*')
    .eq('user_id', userId).order('position', { ascending: true })
  if (error) throw error
  return (data ?? []) as StageRow[]
}

export async function fetchFieldDefs(supabase: SupabaseClient, userId: string): Promise<FieldDefRow[]> {
  const { data, error } = await supabase
    .from('lead_field_defs').select('*')
    .eq('user_id', userId).order('position', { ascending: true })
  if (error) throw error
  return (data ?? []) as FieldDefRow[]
}

export async function fetchLeadsPage(
  supabase: SupabaseClient,
  userId: string,
  params: LeadsQuery,
  stageId?: string,
): Promise<{ rows: LeadRow[]; total: number }> {
  const sort = SORT_MAP[params.sort]
  let query = supabase
    .from('leads').select('*', { count: 'exact' })
    .eq('user_id', userId)
  if (stageId) query = query.eq('stage_id', stageId)

  if (params.q) {
    const term = `%${params.q}%`
    query = query.or(
      `name.ilike.${term},email.ilike.${term},phone.ilike.${term},company.ilike.${term}`,
    )
  }
  if (params.from) query = query.gte('created_at', `${params.from}T00:00:00Z`)
  if (params.to)   query = query.lte('created_at', `${params.to}T23:59:59Z`)

  query = query.order(sort.col, { ascending: sort.asc, nullsFirst: !sort.nullsLast })

  const from = (params.page - 1) * PAGE_SIZE
  const to   = from + PAGE_SIZE - 1
  const { data, error, count } = await query.range(from, to)
  if (error) throw error
  return { rows: (data ?? []) as LeadRow[], total: count ?? 0 }
}
