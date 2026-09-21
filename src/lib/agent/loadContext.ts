import type { SupabaseClient } from '@supabase/supabase-js'
import type { BulkContext } from './types'
import { STAGE_EMBED } from '@/lib/projects/stage-embed'
import { fetchAllPages, fetchByIdChunks } from './batch'

const COOLDOWN_HOURS = 48
const DEFAULT_DAILY_CAP = 5000
// Sends per user per rolling 24h across all campaigns. Env-tunable so a
// large "send to everyone" run isn't silently paused at an arbitrary number.
const DAILY_CAP = Math.max(1, Number(process.env.AGENT_DAILY_SEND_CAP) || DEFAULT_DAILY_CAP)

// Thread ids per RPC call for the last-inbound lookup. The RPC returns one
// row per thread, so this also keeps each response under PostgREST max_rows.
const LAST_INBOUND_RPC_CHUNK = 500

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

  // Every `.in(thread_id, …)` lookup is chunked (see batch.ts): thousands of
  // UUIDs in one GET would blow the URL limit, and a single response can't
  // carry more than max_rows anyway.
  const [lastInboundRows, optinRows, otnRows, cooldownRows, capRows, threadRows] =
    await Promise.all([
      // Newest inbound message body per thread, via DISTINCT ON in SQL so a
      // chatty thread can't crowd the others out of the page.
      fetchByIdChunks<{ thread_id: string; body: string | null }>(
        threadIds,
        async (ids) => {
          const { data, error } = await admin.rpc('agent_last_inbound_by_thread', {
            p_thread_ids: ids,
          })
          if (error) throw new Error(`loadContext: last inbound lookup failed — ${error.message}`)
          return (data ?? []) as Array<{ thread_id: string; body: string | null }>
        },
        LAST_INBOUND_RPC_CHUNK,
      ),

      // Marketing opt-ins
      fetchByIdChunks<{ thread_id: string; opted_out_at: string | null }>(threadIds, async (ids) => {
        const { data, error } = await admin
          .from('messenger_marketing_optins')
          .select('thread_id, opted_out_at')
          .in('thread_id', ids)
        if (error) throw new Error(`loadContext: optin lookup failed — ${error.message}`)
        return data ?? []
      }),

      // Unconsumed, non-expired OTN tokens
      fetchByIdChunks<{ thread_id: string; token: string; requested_at: string }>(
        threadIds,
        async (ids) => {
          const { data, error } = await admin
            .from('messenger_otn_tokens')
            .select('thread_id, token, requested_at')
            .in('thread_id', ids)
            .is('consumed_at', null)
            .or(`expires_at.is.null,expires_at.gt.${now}`)
            .order('requested_at', { ascending: true })
          if (error) throw new Error(`loadContext: OTN lookup failed — ${error.message}`)
          return data ?? []
        },
      ),

      // Threads that received a campaign send in the last 48h (cooldown)
      fetchByIdChunks<{ thread_id: string }>(threadIds, async (ids) => {
        const { data, error } = await admin
          .from('agent_campaign_messages')
          .select('thread_id')
          .in('thread_id', ids)
          .eq('status', 'sent')
          .gte('sent_at', cooldownCutoff)
        if (error) throw new Error(`loadContext: cooldown lookup failed — ${error.message}`)
        return data ?? []
      }),

      // Daily cap: fetch user's campaign IDs first, then count sent messages.
      // Paged, because a user who runs campaigns regularly will pass max_rows
      // and a truncated list silently undercounts the cap.
      fetchAllPages<{ id: string }>(async (from, to) => {
        const { data, error } = await admin
          .from('agent_campaigns')
          .select('id')
          .eq('user_id', userId)
          .order('id', { ascending: true })
          .range(from, to)
        if (error) throw new Error(`loadContext: campaign list failed — ${error.message}`)
        return (data ?? []) as Array<{ id: string }>
      }),

      // Thread -> lead mapping, so we can align drafts to each customer's project.
      fetchByIdChunks<{ id: string; lead_id: string | null }>(threadIds, async (ids) => {
        const { data, error } = await admin
          .from('messenger_threads')
          .select('id, lead_id')
          .in('id', ids)
        if (error) throw new Error(`loadContext: thread lookup failed — ${error.message}`)
        return data ?? []
      }),
    ])

  const lastInboundByThread = new Map<string, string>()
  for (const row of lastInboundRows) {
    if (row.body != null && !lastInboundByThread.has(row.thread_id)) {
      lastInboundByThread.set(row.thread_id, row.body)
    }
  }

  const optinByThread = new Map<string, { opted_out_at: string | null }>()
  for (const row of optinRows) {
    if (!optinByThread.has(row.thread_id)) {
      optinByThread.set(row.thread_id, { opted_out_at: row.opted_out_at })
    }
  }

  const otnByThread = new Map<string, { token: string; requested_at: string }>()
  for (const row of otnRows) {
    if (!otnByThread.has(row.thread_id)) {
      otnByThread.set(row.thread_id, { token: row.token, requested_at: row.requested_at })
    }
  }

  const cooldownThreadIds = new Set<string>(cooldownRows.map((r) => r.thread_id))

  // Second pass: count sent campaign messages in last 24h for this user's
  // campaigns. Chunked like every other `.in()` here, and it throws rather
  // than defaulting to 0 — a swallowed error used to report an empty budget
  // and wave a campaign straight past the daily cap.
  const userCampaignIds = capRows.map((r) => r.id)
  const countsPerChunk = await fetchByIdChunks<number>(userCampaignIds, async (ids) => {
    const { count, error } = await admin
      .from('agent_campaign_messages')
      .select('id', { count: 'exact', head: true })
      .in('campaign_id', ids)
      .eq('status', 'sent')
      .gte('sent_at', dailyCutoff)
    if (error) {
      throw new Error(`loadContext: daily cap count failed — ${error.message}`)
    }
    return [count ?? 0]
  })
  const dailyCapUsed = countsPerChunk.reduce((sum, n) => sum + n, 0)

  const leadIds = [
    ...new Set(threadRows.map((r) => r.lead_id).filter((id): id is string => !!id)),
  ]
  const projectInstructionsByLead = await loadProjectInstructions(admin, leadIds)

  return {
    lastInboundByThread,
    optinByThread,
    otnByThread,
    cooldownThreadIds,
    dailyCapUsed,
    projectInstructionsByLead,
  }
}

// Per-customer project instructions. Pick each lead's newest non-terminal
// project and carry its AI instructions, keyed by lead_id so generateDraft
// can look it up via AudienceLead.id.
async function loadProjectInstructions(
  admin: SupabaseClient,
  leadIds: string[],
): Promise<Map<string, string>> {
  const byLead = new Map<string, string>()
  if (leadIds.length === 0) return byLead

  type ProjectRow = {
    lead_id: string
    ai_instructions: string | null
    project_stages: { kind: string | null } | { kind: string | null }[] | null
  }
  const projectRows = await fetchByIdChunks<ProjectRow>(leadIds, async (ids) => {
    const { data, error } = await admin
      .from('projects')
      .select(`lead_id, ai_instructions, updated_at, ${STAGE_EMBED}(kind)`)
      .in('lead_id', ids)
      .order('updated_at', { ascending: false })
    if (error) throw new Error(`loadContext: project lookup failed — ${error.message}`)
    return (data ?? []) as unknown as ProjectRow[]
  })

  for (const r of projectRows) {
    if (byLead.has(r.lead_id)) continue // newest wins
    const stage = Array.isArray(r.project_stages) ? r.project_stages[0] : r.project_stages
    const terminal = stage?.kind === 'won' || stage?.kind === 'lost'
    if (terminal) continue
    // Mark the lead as resolved (its active project is this one) regardless of
    // whether it has instructions, so an older project never overrides it.
    byLead.set(r.lead_id, r.ai_instructions?.trim() ?? '')
  }
  // Drop empties so consumers can treat "present" as "has instructions".
  return new Map([...byLead].filter(([, v]) => v !== ''))
}

export { DAILY_CAP }
