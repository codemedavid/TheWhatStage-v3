import type { AnalyticsFilters } from './leads-analytics'

/**
 * Argument builders for the analytics RPCs. Pure (no I/O) so they can be unit
 * tested directly. Two shapes:
 *
 * - {@link rpcArgs}: date window + lead cohort filters — shared by every RPC,
 *   including the account-wide LEAD-side ones (leads have no workspace).
 * - {@link projectRpcArgs}: adds `p_workspace_id` for the PROJECT-side RPCs, so
 *   conversion/value metrics can be scoped to one workspace (null = all).
 */
export function rpcArgs(f: AnalyticsFilters) {
  return {
    p_from: f.from ?? null,
    p_to: f.to ?? null,
    p_source: f.source ?? null,
    p_campaign: f.campaign ?? null,
  }
}

export function projectRpcArgs(f: AnalyticsFilters) {
  return {
    ...rpcArgs(f),
    p_workspace_id: f.workspace ?? null,
  }
}
