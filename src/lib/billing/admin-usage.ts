import 'server-only'
import { createClient } from '@/lib/supabase/server'

/**
 * Superadmin usage-analytics data access. Thin typed wrappers over the
 * current_role()-gated analytics RPCs (migration 20260611000500). Always called
 * via the RLS client (the superadmin's own session) so the in-function role guard
 * authorizes the read — no service-role client in a component. Reads the
 * usage_daily rollup (refreshed hourly), so figures can lag real time by up to
 * the rollup cadence; surface that in the UI.
 *
 * Cost is returned in USD micros for internal use but is intentionally NOT shown
 * in the UI until provider rates are verified (tokens-only product decision).
 */

export interface UsageTotals {
  totalTokens: number
  promptTokens: number
  cachedPromptTokens: number
  completionTokens: number
  costMicros: number
  eventCount: number
  activeTenants: number
}

export interface UsageTrendPoint {
  day: string
  totalTokens: number
  cachedPromptTokens: number
  completionTokens: number
  costMicros: number
  eventCount: number
  activeTenants: number
}

export interface ScopeModelRow {
  scope: string
  model: string
  totalTokens: number
  cachedPromptTokens: number
  completionTokens: number
  costMicros: number
  eventCount: number
}

export interface TenantUsageRow {
  userId: string
  email: string | null
  fullName: string | null
  tier: string
  includedTokens: number | null
  totalTokens: number
  adjTokens: number
  effectiveTokens: number
  costMicros: number
  eventCount: number
  lastActiveDay: string | null
}

const n = (v: unknown): number => Number(v ?? 0)

/**
 * Surface RPC failures instead of silently degrading to zeros. The analytics
 * RPCs are gated (`forbidden: superadmin only`) — when that gate fails, an empty
 * result is indistinguishable from genuinely-zero usage, which is exactly how the
 * admin dashboard showed "no usage" despite a full ledger. Throw so the caller
 * can render an error state, and log server-side for diagnosis.
 */
function unwrapRpc<T>(
  fn: string,
  result: { data: T | null; error: { message: string } | null },
): T {
  if (result.error) {
    console.error(`[admin-usage] ${fn} failed`, result.error)
    throw new Error(`admin-usage.${fn}: ${result.error.message}`)
  }
  return (result.data ?? ([] as unknown as T))
}

/** Today's date as YYYY-MM-DD in Asia/Manila (matches usage_daily.day). */
export function manilaToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** First day of the current Asia/Manila calendar month as YYYY-MM-DD. */
export function manilaMonthStart(): string {
  return `${manilaToday().slice(0, 7)}-01`
}

/** Human label for the current Manila month, e.g. "June 2026". */
export function manilaMonthLabel(): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    month: 'long',
    year: 'numeric',
  }).format(new Date())
}

export async function getUsageTotals(
  from: string,
  to: string,
  userId?: string,
): Promise<UsageTotals> {
  const supabase = await createClient()
  const data = unwrapRpc<Record<string, unknown>[]>(
    'getUsageTotals',
    await supabase.rpc('admin_usage_totals', { p_from: from, p_to: to, p_user: userId ?? null }),
  )
  const r = data[0] ?? {}
  return {
    totalTokens: n(r.total_tokens),
    promptTokens: n(r.prompt_tokens),
    cachedPromptTokens: n(r.cached_prompt_tokens),
    completionTokens: n(r.completion_tokens),
    costMicros: n(r.cost_micros),
    eventCount: n(r.event_count),
    activeTenants: n(r.active_tenants),
  }
}

export async function getUsageTrend(
  from: string,
  to: string,
  userId?: string,
): Promise<UsageTrendPoint[]> {
  const supabase = await createClient()
  const data = unwrapRpc<Record<string, unknown>[]>(
    'getUsageTrend',
    await supabase.rpc('admin_usage_trend', { p_from: from, p_to: to, p_user: userId ?? null }),
  )
  return data.map((r) => ({
    day: String(r.day),
    totalTokens: n(r.total_tokens),
    cachedPromptTokens: n(r.cached_prompt_tokens),
    completionTokens: n(r.completion_tokens),
    costMicros: n(r.cost_micros),
    eventCount: n(r.event_count),
    activeTenants: n(r.active_tenants),
  }))
}

export async function getUsageByScopeModel(
  from: string,
  to: string,
  userId?: string,
): Promise<ScopeModelRow[]> {
  const supabase = await createClient()
  const data = unwrapRpc<Record<string, unknown>[]>(
    'getUsageByScopeModel',
    await supabase.rpc('admin_usage_by_scope_model', { p_from: from, p_to: to, p_user: userId ?? null }),
  )
  return data.map((r) => ({
    scope: String(r.scope),
    model: String(r.model),
    totalTokens: n(r.total_tokens),
    cachedPromptTokens: n(r.cached_prompt_tokens),
    completionTokens: n(r.completion_tokens),
    costMicros: n(r.cost_micros),
    eventCount: n(r.event_count),
  }))
}

export async function getUsageByTenant(from: string, to: string): Promise<TenantUsageRow[]> {
  const supabase = await createClient()
  const data = unwrapRpc<Record<string, unknown>[]>(
    'getUsageByTenant',
    await supabase.rpc('admin_usage_by_tenant', { p_from: from, p_to: to }),
  )
  return data.map((r) => ({
    userId: String(r.user_id),
    email: (r.email as string | null) ?? null,
    fullName: (r.full_name as string | null) ?? null,
    tier: String(r.tier ?? 'free'),
    includedTokens: r.included_tokens != null ? n(r.included_tokens) : null,
    totalTokens: n(r.total_tokens),
    adjTokens: n(r.adj_tokens),
    effectiveTokens: n(r.effective_tokens),
    costMicros: n(r.cost_micros),
    eventCount: n(r.event_count),
    lastActiveDay: (r.last_active_day as string | null) ?? null,
  }))
}
