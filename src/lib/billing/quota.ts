import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Display-only quota state for a tenant's current calendar month (Phase 3).
 *
 * Resolves the tenant's plan from profiles.subscription_tier (the single tier
 * source of truth, toggled by the superadmin) → billing_plans, and sums this
 * month's tokens/cost from the live llm_usage_events ledger. RLS-safe with the
 * tenant's own auth'd client (own profile, own events, public plans).
 *
 * NOTHING here blocks a reply. `overage` is purely a UI signal today. When
 * enforcement turns on later it would gate via model-router (soft degrade),
 * never silence the bot — see USAGE_BILLING_PLAN.md §4.2.
 */
export interface QuotaState {
  tier: string
  planName: string
  usedTokens: number
  /** Soft cap for the period; null when the plan is unknown/uncapped. */
  includedTokens: number | null
  /** usedTokens / includedTokens; null when there is no cap. */
  ratio: number | null
  /** ratio > 1. Display signal only — never blocks. */
  overage: boolean
  /** This month's accumulated cost in USD micros (USD * 1e6). */
  costMicros: number
}

export async function getQuotaState(
  supabase: SupabaseClient,
  userId: string,
): Promise<QuotaState> {
  // Start of the current month in Asia/Manila (UTC+8, no DST).
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const [year, month] = parts.split('-')
  const monthStart = `${year}-${month}-01T00:00:00+08:00`

  const [profileRes, eventsRes, adjRes] = await Promise.all([
    supabase
      .from('profiles')
      .select('subscription_tier, included_tokens_override')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('llm_usage_events')
      .select('total_tokens, cost_micros')
      .eq('user_id', userId)
      .gte('created_at', monthStart),
    // Superadmin corrections (credits / manual adds / resets) for this period.
    supabase
      .from('usage_adjustments')
      .select('delta_tokens, delta_cost_micros')
      .eq('user_id', userId)
      .gte('created_at', monthStart),
  ])

  const tier = (profileRes.data?.subscription_tier as string | undefined) ?? 'free'

  const { data: plan } = await supabase
    .from('billing_plans')
    .select('name, included_tokens')
    .eq('id', tier)
    .maybeSingle()

  const rows = eventsRes.data ?? []
  const adjustments = adjRes.data ?? []
  const adjTokens = adjustments.reduce((s, r) => s + Number(r.delta_tokens ?? 0), 0)
  const adjCost = adjustments.reduce((s, r) => s + Number(r.delta_cost_micros ?? 0), 0)
  // Metered + adjustments, clamped so a net credit never shows negative usage.
  const usedTokens = Math.max(0, rows.reduce((s, r) => s + Number(r.total_tokens ?? 0), 0) + adjTokens)
  const costMicros = Math.max(0, rows.reduce((s, r) => s + Number(r.cost_micros ?? 0), 0) + adjCost)

  // Per-user override wins over the tier's cap; null = uncapped.
  const overrideCap = profileRes.data?.included_tokens_override
  const includedTokens =
    overrideCap != null
      ? Number(overrideCap)
      : plan?.included_tokens != null
        ? Number(plan.included_tokens)
        : null
  const ratio =
    includedTokens && includedTokens > 0 ? usedTokens / includedTokens : null

  return {
    tier,
    planName: (plan?.name as string | undefined) ?? tier,
    usedTokens,
    includedTokens,
    ratio,
    overage: ratio != null && ratio > 1,
    costMicros,
  }
}
