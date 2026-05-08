import type { SupabaseClient } from '@supabase/supabase-js'
import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { type LeadsQuery, PAGE_SIZE } from './schemas'

export const stagesTag = (userId: string) => `leads:stages:${userId}`
export const fieldDefsTag = (userId: string) => `leads:field-defs:${userId}`

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
  phones: string[] | null
  emails: string[] | null
  position: number
  created_at: string
  updated_at: string
  picture_url: string | null
  campaign_id: string | null
  campaign_name: string | null
}

type LeadRowWithJoins = Omit<LeadRow, 'picture_url' | 'campaign_name'> & {
  messenger_threads: { picture_url: string | null }[] | { picture_url: string | null } | null
  campaigns: { name: string } | { name: string }[] | null
}

function flattenLead(row: LeadRowWithJoins): LeadRow {
  const { messenger_threads: t, campaigns: c, ...rest } = row
  const picture_url = Array.isArray(t)
    ? (t[0]?.picture_url ?? null)
    : (t?.picture_url ?? null)
  const campaign_name = Array.isArray(c)
    ? (c[0]?.name ?? null)
    : (c?.name ?? null)
  return { ...rest, picture_url, campaign_name }
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

// Cached variants — keyed and tagged per user. Use the admin client because
// `unstable_cache` runs outside the request scope (no cookies); user_id filter
// preserves isolation. Invalidate via revalidateTag in the matching actions.
export function fetchStagesCached(userId: string): Promise<StageRow[]> {
  return unstable_cache(
    async (uid: string) => {
      const admin = createAdminClient()
      const { data, error } = await admin
        .from('pipeline_stages').select('*')
        .eq('user_id', uid).order('position', { ascending: true })
      if (error) throw error
      return (data ?? []) as StageRow[]
    },
    ['leads-stages', userId],
    { tags: [stagesTag(userId)], revalidate: 3600 },
  )(userId)
}

export function fetchFieldDefsCached(userId: string): Promise<FieldDefRow[]> {
  return unstable_cache(
    async (uid: string) => {
      const admin = createAdminClient()
      const { data, error } = await admin
        .from('lead_field_defs').select('*')
        .eq('user_id', uid).order('position', { ascending: true })
      if (error) throw error
      return (data ?? []) as FieldDefRow[]
    },
    ['leads-field-defs', userId],
    { tags: [fieldDefsTag(userId)], revalidate: 3600 },
  )(userId)
}

export async function fetchLeadsTotal(
  supabase: SupabaseClient,
  userId: string,
  params: LeadsQuery,
): Promise<number> {
  let query = supabase
    .from('leads').select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (params.q) {
    const term = `%${params.q}%`
    query = query.or(
      `name.ilike.${term},email.ilike.${term},phone.ilike.${term},company.ilike.${term}`,
    )
  }
  if (params.from) query = query.gte('created_at', `${params.from}T00:00:00Z`)
  if (params.to)   query = query.lte('created_at', `${params.to}T23:59:59Z`)
  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

export async function fetchLeadsPage(
  supabase: SupabaseClient,
  userId: string,
  params: LeadsQuery,
  stageId?: string,
): Promise<{ rows: LeadRow[]; total: number }> {
  const sort = SORT_MAP[params.sort]
  let query = supabase
    .from('leads')
    .select('*, messenger_threads(picture_url), campaigns(name)', { count: 'exact' })
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
  const rows = ((data ?? []) as LeadRowWithJoins[]).map(flattenLead)
  return { rows, total: count ?? 0 }
}

export type CampaignOption = {
  id: string
  name: string
  enabled: boolean
  status: 'draft' | 'active' | 'paused' | 'archived'
  weight: number
}

export async function fetchCampaignOptions(
  supabase: SupabaseClient,
  userId: string,
): Promise<CampaignOption[]> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, name, enabled, status, weight')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as CampaignOption[]
}
