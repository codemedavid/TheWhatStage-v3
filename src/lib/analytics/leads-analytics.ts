import 'server-only'
import { createClient } from '@/lib/supabase/server'

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
