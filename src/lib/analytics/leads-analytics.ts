import 'server-only'
import { createClient } from '@/lib/supabase/server'
import type { CrosstabCell } from './metrics'

/**
 * Per-tenant leads & revenue analytics data access. Thin typed wrappers over the
 * auth.uid()-scoped analytics RPCs (migration 20260620140000), always called via
 * the RLS client (the tenant's own session). Like admin-usage.ts, RPC failures
 * are surfaced (thrown) rather than degraded to zeros — an empty result from a
 * failed auth gate is indistinguishable from genuinely-zero data otherwise.
 */

const n = (v: unknown): number => Number(v ?? 0)

function unwrapRpc<T>(
  fn: string,
  result: { data: T | null; error: { message: string } | null },
): T {
  if (result.error) {
    console.error(`[leads-analytics] ${fn} failed`, result.error)
    throw new Error(`leads-analytics.${fn}: ${result.error.message}`)
  }
  return result.data ?? ([] as unknown as T)
}

export interface AnalyticsFilters {
  from?: string | null
  to?: string | null
  source?: string | null
  campaign?: string | null
}

export interface AnalyticsOverview {
  totalLeads: number
  totalProjects: number
  totalSubmissions: number
  /** Chat-implied submissions (subset of totalSubmissions). Segment, don't blend:
   *  headline "form submissions" = totalSubmissions - virtualSubmissions. */
  virtualSubmissions: number
  attributedSubmissions: number
  submissionsWithProject: number
  activeActionPages: number
  wonProjects: number
  lostProjects: number
  openProjects: number
  projectValueCount: number
  projectValueSum: number
  projectValueAvg: number
  wonValueSum: number
  openValueSum: number
  currencyCount: number
}

export interface TimeseriesPoint {
  day: string
  leads: number
  projects: number
  submissions: number
  virtualSubmissions: number
}

export interface FunnelRow {
  stageId: string
  name: string
  kind: string
  position: number
  rank: number
  reached: number
}

export interface CampaignOption {
  id: string
  name: string
}

function rpcArgs(f: AnalyticsFilters) {
  return {
    p_from: f.from ?? null,
    p_to: f.to ?? null,
    p_source: f.source ?? null,
    p_campaign: f.campaign ?? null,
  }
}

function mapFunnel(rows: Record<string, unknown>[], reachedKey: string): FunnelRow[] {
  return rows.map((r) => ({
    stageId: String(r.stage_id),
    name: String(r.name),
    kind: String(r.kind ?? ''),
    position: n(r.position),
    rank: n(r.rank),
    reached: n(r[reachedKey]),
  }))
}

export async function getAnalyticsOverview(f: AnalyticsFilters): Promise<AnalyticsOverview> {
  const supabase = await createClient()
  const rows = unwrapRpc<Record<string, unknown>[]>(
    'getAnalyticsOverview',
    await supabase.rpc('analytics_overview', rpcArgs(f)),
  )
  const r = rows[0] ?? {}
  return {
    totalLeads: n(r.total_leads),
    totalProjects: n(r.total_projects),
    totalSubmissions: n(r.total_submissions),
    virtualSubmissions: n(r.virtual_submissions),
    attributedSubmissions: n(r.attributed_submissions),
    submissionsWithProject: n(r.submissions_with_project),
    activeActionPages: n(r.active_action_pages),
    wonProjects: n(r.won_projects),
    lostProjects: n(r.lost_projects),
    openProjects: n(r.open_projects),
    projectValueCount: n(r.project_value_count),
    projectValueSum: n(r.project_value_sum),
    projectValueAvg: n(r.project_value_avg),
    wonValueSum: n(r.won_value_sum),
    openValueSum: n(r.open_value_sum),
    currencyCount: n(r.currency_count),
  }
}

export async function getAnalyticsTimeseries(f: AnalyticsFilters): Promise<TimeseriesPoint[]> {
  const supabase = await createClient()
  const data = unwrapRpc<Record<string, unknown>[]>(
    'getAnalyticsTimeseries',
    await supabase.rpc('analytics_timeseries', rpcArgs(f)),
  )
  return data.map((r) => ({
    day: String(r.day),
    leads: n(r.leads),
    projects: n(r.projects),
    submissions: n(r.submissions),
    virtualSubmissions: n(r.virtual_submissions),
  }))
}

export async function getLeadFunnel(f: AnalyticsFilters): Promise<FunnelRow[]> {
  const supabase = await createClient()
  const data = unwrapRpc<Record<string, unknown>[]>(
    'getLeadFunnel',
    await supabase.rpc('analytics_lead_funnel', rpcArgs(f)),
  )
  return mapFunnel(data, 'leads_reached')
}

export async function getLeadToProject(f: AnalyticsFilters): Promise<FunnelRow[]> {
  const supabase = await createClient()
  const data = unwrapRpc<Record<string, unknown>[]>(
    'getLeadToProject',
    await supabase.rpc('analytics_lead_to_project', rpcArgs(f)),
  )
  return mapFunnel(data, 'projects_reached')
}

export async function getSubmissionToProject(f: Pick<AnalyticsFilters, 'from' | 'to'>): Promise<FunnelRow[]> {
  const supabase = await createClient()
  const data = unwrapRpc<Record<string, unknown>[]>(
    'getSubmissionToProject',
    await supabase.rpc('analytics_submission_to_project', { p_from: f.from ?? null, p_to: f.to ?? null }),
  )
  return mapFunnel(data, 'submissions_reached')
}

export interface DrilldownLead {
  leadId: string
  leadName: string
  source: string | null
  createdAt: string
  projectCount: number
  bestProjectStage: string | null
  valueSum: number
  currency: string | null
}

export interface ProjectStageValue {
  stageId: string
  name: string
  kind: string
  position: number
  projectCount: number
  valueCount: number
  valueSum: number
  valueAvg: number
}

/**
 * Lead-stage x project-stage cross-tab — every (forward lead stage, forward
 * project stage) cell, monotonic. Powers the "Lead → Project" explorer: pick a
 * lead stage and a project stage to see the conversion between them.
 */
export async function getLeadProjectCrosstab(f: AnalyticsFilters): Promise<CrosstabCell[]> {
  const supabase = await createClient()
  const rows = unwrapRpc<Record<string, unknown>[]>(
    'getLeadProjectCrosstab',
    await supabase.rpc('analytics_lead_project_crosstab', rpcArgs(f)),
  )
  return rows.map((r) => ({
    leadStageId: String(r.lead_stage_id),
    leadStageName: String(r.lead_stage_name),
    leadKind: String(r.lead_kind ?? ''),
    leadRank: n(r.lead_rank),
    leadStageTotal: n(r.lead_stage_total),
    projectStageId: String(r.project_stage_id),
    projectStageName: String(r.project_stage_name),
    projectKind: String(r.project_kind ?? ''),
    projectRank: n(r.project_rank),
    leads: n(r.leads),
  }))
}

/** The actual leads behind a cross-tab cell. projectRank < 0 = no project filter. */
export async function getLeadProjectLeads(
  f: AnalyticsFilters,
  leadRank: number,
  projectRank: number,
  limit = 100,
): Promise<DrilldownLead[]> {
  const supabase = await createClient()
  const rows = unwrapRpc<Record<string, unknown>[]>(
    'getLeadProjectLeads',
    await supabase.rpc('analytics_lead_project_leads', {
      ...rpcArgs(f),
      p_lead_rank: leadRank,
      p_project_rank: projectRank,
      p_limit: limit,
    }),
  )
  return rows.map((r) => ({
    leadId: String(r.lead_id),
    leadName: String(r.lead_name ?? 'Unnamed lead'),
    source: (r.source as string | null) ?? null,
    createdAt: String(r.created_at),
    projectCount: n(r.project_count),
    bestProjectStage: (r.best_project_stage as string | null) ?? null,
    valueSum: n(r.value_sum),
    currency: (r.currency as string | null) ?? null,
  }))
}

/** Value contribution per current project stage (lost included). */
export async function getProjectStageValue(f: AnalyticsFilters): Promise<ProjectStageValue[]> {
  const supabase = await createClient()
  const rows = unwrapRpc<Record<string, unknown>[]>(
    'getProjectStageValue',
    await supabase.rpc('analytics_project_stage_value', rpcArgs(f)),
  )
  return rows.map((r) => ({
    stageId: String(r.stage_id),
    name: String(r.name),
    kind: String(r.kind ?? ''),
    position: n(r.position),
    projectCount: n(r.project_count),
    valueCount: n(r.value_count),
    valueSum: n(r.value_sum),
    valueAvg: n(r.value_avg),
  }))
}

/** Tenant default currency for value display (mirrors projects' resolveDefaultCurrency). */
export async function getDefaultCurrency(): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 'PHP'
  const { data } = await supabase
    .from('business_profiles')
    .select('default_currency')
    .eq('user_id', user.id)
    .maybeSingle()
  return (data?.default_currency as string | undefined) ?? 'PHP'
}

/**
 * Distinct lead sources + campaigns for the toolbar filters. The campaign lookup
 * is best-effort: it degrades to an empty list (the filter just won't offer
 * campaigns) rather than failing the whole page if the campaigns table shape
 * differs.
 */
export async function getAnalyticsFilterOptions(): Promise<{
  sources: string[]
  campaigns: CampaignOption[]
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { sources: [], campaigns: [] }

  const [sourceRes, campaignRes] = await Promise.all([
    supabase.from('leads').select('source').eq('user_id', user.id).not('source', 'is', null).limit(2000),
    supabase.from('campaigns').select('id, name').eq('user_id', user.id).order('name'),
  ])

  const sources = [
    ...new Set(
      (sourceRes.data ?? [])
        .map((r) => (r.source as string | null)?.trim())
        .filter((s): s is string => !!s),
    ),
  ].sort((a, b) => a.localeCompare(b))

  let campaigns: CampaignOption[] = []
  if (campaignRes.error) {
    console.error('[leads-analytics] getAnalyticsFilterOptions campaigns failed', campaignRes.error)
  } else {
    campaigns = (campaignRes.data ?? []).map((c) => ({
      id: String(c.id),
      name: String(c.name ?? 'Untitled campaign'),
    }))
  }

  return { sources, campaigns }
}
