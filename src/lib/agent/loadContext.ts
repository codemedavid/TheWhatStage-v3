import type { SupabaseClient } from '@supabase/supabase-js'
import type { BulkContext } from './types'

const COOLDOWN_HOURS = 48
const DAILY_CAP = 500

export async function loadContext(
  admin: SupabaseClient,
  userId: string,
  threadIds: string[],
): Promise<BulkContext> {
  if (threadIds.length === 0) {
    return {
      lastInboundByThread: new Map(),
      optinByThread: new Map(),
      otnByThread: new Map(),
      cooldownThreadIds: new Set(),
      dailyCapUsed: 0,
      projectInstructionsByLead: new Map(),
    }
  }

  const now = new Date().toISOString()
  const cooldownCutoff = new Date(Date.now() - COOLDOWN_HOURS * 3600_000).toISOString()
  const dailyCutoff = new Date(Date.now() - 24 * 3600_000).toISOString()

  const [messagesRes, optinsRes, otnsRes, cooldownRes, capRes, threadsRes] = await Promise.all([
    // Last inbound message per thread (for personalization in draft generation)
    admin
      .from('messenger_messages')
      .select('thread_id, body')
      .in('thread_id', threadIds)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false }),

    // Marketing opt-ins
    admin
      .from('messenger_marketing_optins')
      .select('thread_id, opted_out_at')
      .in('thread_id', threadIds),

    // Unconsumed, non-expired OTN tokens
    admin
      .from('messenger_otn_tokens')
      .select('thread_id, token, requested_at')
      .in('thread_id', threadIds)
      .is('consumed_at', null)
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order('requested_at', { ascending: true }),

    // Threads that received a campaign send in the last 48h (cooldown)
    admin
      .from('agent_campaign_messages')
      .select('thread_id')
      .in('thread_id', threadIds)
      .eq('status', 'sent')
      .gte('sent_at', cooldownCutoff),

    // Daily cap: fetch user's campaign IDs first, then count sent messages.
    admin
      .from('agent_campaigns')
      .select('id')
      .eq('user_id', userId),

    // Thread -> lead mapping, so we can align drafts to each customer's project.
    admin
      .from('messenger_threads')
      .select('id, lead_id')
      .in('id', threadIds),
  ])

  // Last inbound per thread (keep only the newest row per thread_id)
  const lastInboundByThread = new Map<string, string>()
  for (const row of messagesRes.data ?? []) {
    if (!lastInboundByThread.has(row.thread_id as string)) {
      lastInboundByThread.set(row.thread_id as string, row.body as string)
    }
  }

  const optinByThread = new Map<string, { opted_out_at: string | null }>()
  for (const row of optinsRes.data ?? []) {
    if (!optinByThread.has(row.thread_id as string)) {
      optinByThread.set(row.thread_id as string, { opted_out_at: row.opted_out_at as string | null })
    }
  }

  const otnByThread = new Map<string, { token: string; requested_at: string }>()
  for (const row of otnsRes.data ?? []) {
    if (!otnByThread.has(row.thread_id as string)) {
      otnByThread.set(row.thread_id as string, {
        token: row.token as string,
        requested_at: row.requested_at as string,
      })
    }
  }

  const cooldownThreadIds = new Set<string>(
    (cooldownRes.data ?? []).map((r) => r.thread_id as string),
  )

  // Second pass: count sent campaign messages in last 24h for this user's campaigns.
  const userCampaignIds = (capRes.data ?? []).map((r) => (r as { id: string }).id)
  let dailyCapUsed = 0
  if (userCampaignIds.length > 0) {
    const { count } = await admin
      .from('agent_campaign_messages')
      .select('id', { count: 'exact', head: true })
      .in('campaign_id', userCampaignIds)
      .eq('status', 'sent')
      .gte('sent_at', dailyCutoff)
    dailyCapUsed = count ?? 0
  }

  // Per-customer project instructions. Resolve each thread's lead, then pick
  // that lead's active (open) project and carry its AI instructions, keyed by
  // lead_id so generateDraft can look it up via AudienceLead.id.
  const leadIds = [
    ...new Set(
      (threadsRes.data ?? [])
        .map((r) => (r as { lead_id: string | null }).lead_id)
        .filter((id): id is string => !!id),
    ),
  ]
  const projectInstructionsByLead = new Map<string, string>()
  if (leadIds.length > 0) {
    const { data: projectRows } = await admin
      .from('projects')
      .select('lead_id, ai_instructions, updated_at, project_stages(kind)')
      .in('lead_id', leadIds)
      .order('updated_at', { ascending: false })
    for (const row of projectRows ?? []) {
      const r = row as {
        lead_id: string
        ai_instructions: string | null
        project_stages: { kind: string | null } | { kind: string | null }[] | null
      }
      if (projectInstructionsByLead.has(r.lead_id)) continue // newest wins
      const stage = Array.isArray(r.project_stages) ? r.project_stages[0] : r.project_stages
      const terminal = stage?.kind === 'won' || stage?.kind === 'lost'
      if (terminal) continue
      const instr = r.ai_instructions?.trim()
      // Mark the lead as resolved (its active project is this one) regardless of
      // whether it has instructions, so an older project never overrides it.
      projectInstructionsByLead.set(r.lead_id, instr ?? '')
    }
    // Drop empties so consumers can treat "present" as "has instructions".
    for (const [k, v] of projectInstructionsByLead) {
      if (v === '') projectInstructionsByLead.delete(k)
    }
  }

  return {
    lastInboundByThread,
    optinByThread,
    otnByThread,
    cooldownThreadIds,
    dailyCapUsed,
    projectInstructionsByLead,
  }
}

export { DAILY_CAP }
