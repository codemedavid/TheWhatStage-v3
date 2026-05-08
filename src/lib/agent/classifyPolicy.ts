// Pure function — no I/O, fully unit-testable.
import type { AudienceLead, BulkContext, PolicyResult } from './types'
import { DAILY_CAP } from './loadContext'

// Policy outcome for shared-template campaigns. An approved utility
// template lets us bypass the 24h window via the UTILITY_MESSAGE tag, so
// the only "paused" reasons that still apply are cooldown and cap.
export type TemplatePolicyResult =
  | { policy: 'RESPONSE' }
  | { policy: 'UTILITY_MESSAGE' }
  | { policy: 'paused'; reason: 'cooldown' | 'cap' }

const WINDOW_MS = 24 * 60 * 60 * 1000

export function isInsideWindow(lastInboundAt: string | null): boolean {
  if (!lastInboundAt) return false
  return Date.now() - new Date(lastInboundAt).getTime() < WINDOW_MS
}

export function classifyPolicy(
  lead: AudienceLead,
  ctx: BulkContext,
  dailyCapRemaining?: number,
): PolicyResult {
  const remaining = dailyCapRemaining ?? DAILY_CAP - ctx.dailyCapUsed

  if (remaining <= 0) {
    return { policy: 'paused', reason: 'cap' }
  }

  if (ctx.cooldownThreadIds.has(lead.thread_id)) {
    return { policy: 'paused', reason: 'cooldown' }
  }

  if (isInsideWindow(lead.last_inbound_at)) {
    return { policy: 'RESPONSE' }
  }

  const optin = ctx.optinByThread.get(lead.thread_id)
  if (optin && !optin.opted_out_at) {
    return { policy: 'MARKETING_MESSAGE' }
  }

  const otn = ctx.otnByThread.get(lead.thread_id)
  if (otn) {
    return { policy: 'OTN', token: otn.token }
  }

  return { policy: 'paused', reason: 'window' }
}

export function policyLabel(p: PolicyResult): string {
  if (p.policy === 'RESPONSE') return 'RESPONSE'
  if (p.policy === 'MARKETING_MESSAGE') return 'MARKETING_MESSAGE'
  if (p.policy === 'OTN') return 'OTN'
  return `paused:${p.reason}`
}

export function isPausedPolicy(p: PolicyResult): boolean {
  return p.policy === 'paused'
}

/**
 * Policy classifier for shared-template campaigns. Skips the opt-in/OTN
 * checks because an approved utility template carries its own permission.
 * Cooldown and daily-cap still apply.
 */
export function classifyTemplatePolicy(
  lead: AudienceLead,
  ctx: BulkContext,
  dailyCapRemaining?: number,
): TemplatePolicyResult {
  const remaining = dailyCapRemaining ?? DAILY_CAP - ctx.dailyCapUsed
  if (remaining <= 0) return { policy: 'paused', reason: 'cap' }
  if (ctx.cooldownThreadIds.has(lead.thread_id)) {
    return { policy: 'paused', reason: 'cooldown' }
  }
  if (isInsideWindow(lead.last_inbound_at)) return { policy: 'RESPONSE' }
  return { policy: 'UTILITY_MESSAGE' }
}

export function templatePolicyLabel(p: TemplatePolicyResult): string {
  if (p.policy === 'paused') return `paused:${p.reason}`
  return p.policy
}
