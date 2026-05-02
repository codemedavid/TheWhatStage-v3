import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  AssignmentMode,
  CampaignStatus,
  FunnelRule,
  PersonalityMode,
  Requirement,
} from './schemas'

export interface CampaignRow {
  id: string
  name: string
  description: string | null
  enabled: boolean
  status: CampaignStatus
  assignment_mode: AssignmentMode
  weight: number
  personality_mode: PersonalityMode
  persona: string
  do_rules: string[]
  dont_rules: string[]
  goal_action_page_id: string | null
  created_at: string
  updated_at: string
}

export interface CampaignListItem {
  id: string
  name: string
  description: string | null
  enabled: boolean
  status: CampaignStatus
  assignment_mode: AssignmentMode
  weight: number
  funnel_count: number
  goal_action_page_title: string | null
  updated_at: string
}

export interface FunnelRow {
  id: string
  campaign_id: string
  name: string
  description: string | null
  position: number
  requirements: Requirement[]
  rules: FunnelRule[]
  instruction: string
  action_page_id: string | null
  next_funnel_id: string | null
  updated_at: string
}

export async function fetchCampaigns(
  supabase: SupabaseClient,
  userId: string,
): Promise<CampaignListItem[]> {
  const { data: campaigns, error } = await supabase
    .from('campaigns')
    .select(
      'id, name, description, enabled, status, assignment_mode, weight, goal_action_page_id, updated_at',
    )
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  if (error) throw new Error(`fetchCampaigns: ${error.message}`)
  if (!campaigns?.length) return []

  const ids = campaigns.map((c) => c.id as string)
  const goalIds = Array.from(
    new Set(
      campaigns
        .map((c) => c.goal_action_page_id as string | null)
        .filter((v): v is string => Boolean(v)),
    ),
  )

  const [{ data: funnelRows, error: fErr }, goals] = await Promise.all([
    supabase.from('funnels').select('campaign_id').in('campaign_id', ids),
    goalIds.length
      ? supabase
          .from('action_pages')
          .select('id, title')
          .eq('user_id', userId)
          .in('id', goalIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[], error: null }),
  ])
  if (fErr) throw new Error(`fetchCampaigns funnel counts: ${fErr.message}`)
  if (goals.error) throw new Error(`fetchCampaigns goal pages: ${goals.error.message}`)

  const counts = new Map<string, number>()
  for (const row of funnelRows ?? []) {
    const id = row.campaign_id as string
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const goalTitles = new Map<string, string>()
  for (const g of goals.data ?? []) goalTitles.set(g.id as string, g.title as string)

  return campaigns.map((c) => ({
    id: c.id as string,
    name: c.name as string,
    description: (c.description as string | null) ?? null,
    enabled: Boolean(c.enabled),
    status: c.status as CampaignStatus,
    assignment_mode: c.assignment_mode as AssignmentMode,
    weight: (c.weight as number) ?? 1,
    funnel_count: counts.get(c.id as string) ?? 0,
    goal_action_page_title: c.goal_action_page_id
      ? (goalTitles.get(c.goal_action_page_id as string) ?? null)
      : null,
    updated_at: c.updated_at as string,
  }))
}

export async function fetchCampaign(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<CampaignRow | null> {
  const { data, error } = await supabase
    .from('campaigns')
    .select(
      'id, name, description, enabled, status, assignment_mode, weight, personality_mode, persona, do_rules, dont_rules, goal_action_page_id, created_at, updated_at',
    )
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle<CampaignRow>()
  if (error) throw new Error(`fetchCampaign: ${error.message}`)
  return data ?? null
}

export async function fetchCampaignFunnels(
  supabase: SupabaseClient,
  userId: string,
  campaignId: string,
): Promise<FunnelRow[]> {
  const { data, error } = await supabase
    .from('funnels')
    .select(
      'id, campaign_id, name, description, position, requirements, rules, instruction, action_page_id, next_funnel_id, updated_at',
    )
    .eq('user_id', userId)
    .eq('campaign_id', campaignId)
    .order('position', { ascending: true })
  if (error) throw new Error(`fetchCampaignFunnels: ${error.message}`)
  return (data ?? []) as FunnelRow[]
}

export async function fetchFunnel(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<FunnelRow | null> {
  const { data, error } = await supabase
    .from('funnels')
    .select(
      'id, campaign_id, name, description, position, requirements, rules, instruction, action_page_id, next_funnel_id, updated_at',
    )
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle<FunnelRow>()
  if (error) throw new Error(`fetchFunnel: ${error.message}`)
  return data ?? null
}

export interface ActionPageOption {
  id: string
  title: string
  kind: string
  status: 'draft' | 'published' | 'archived'
}

export async function fetchActionPageOptions(
  supabase: SupabaseClient,
  userId: string,
): Promise<ActionPageOption[]> {
  const { data, error } = await supabase
    .from('action_pages')
    .select('id, title, kind, status')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  if (error) throw new Error(`fetchActionPageOptions: ${error.message}`)
  return (data ?? []) as ActionPageOption[]
}

export interface CampaignLeadRow {
  id: string
  name: string
  company: string | null
  email: string | null
  stage_id: string
  stage_name: string | null
  created_at: string
}

export async function fetchCampaignLeads(
  supabase: SupabaseClient,
  userId: string,
  campaignId: string,
  limit = 50,
): Promise<CampaignLeadRow[]> {
  const { data, error } = await supabase
    .from('leads')
    .select('id, name, company, email, stage_id, created_at, pipeline_stages(name)')
    .eq('user_id', userId)
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`fetchCampaignLeads: ${error.message}`)
  type Row = Omit<CampaignLeadRow, 'stage_name'> & {
    pipeline_stages: { name: string } | { name: string }[] | null
  }
  return ((data ?? []) as Row[]).map((r) => {
    const s = r.pipeline_stages
    const stage_name = Array.isArray(s) ? (s[0]?.name ?? null) : (s?.name ?? null)
    const { pipeline_stages: _ignored, ...rest } = r
    return { ...rest, stage_name }
  })
}

export interface LeadFieldOption {
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'select'
}

export async function fetchLeadFieldOptions(
  supabase: SupabaseClient,
  userId: string,
): Promise<LeadFieldOption[]> {
  const { data, error } = await supabase
    .from('lead_field_defs')
    .select('key, label, type, position')
    .eq('user_id', userId)
    .order('position', { ascending: true })
  if (error) throw new Error(`fetchLeadFieldOptions: ${error.message}`)
  return (data ?? []).map((r) => ({
    key: r.key as string,
    label: r.label as string,
    type: r.type as LeadFieldOption['type'],
  }))
}
