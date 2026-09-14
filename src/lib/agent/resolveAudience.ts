import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptToken } from '@/lib/facebook/crypto'
import { fetchAllPages, PAGE_SIZE } from './batch'
import type { AudienceLead, ParsedIntent } from './types'

export class StageNotFoundError extends Error {
  constructor(stageName: string, available: string[]) {
    const list = available.length > 0 ? available.join(', ') : '(none)'
    super(`No pipeline stage matches "${stageName}". Available stages: ${list}`)
    this.name = 'StageNotFoundError'
  }
}

// Resolve every lead (with a Messenger thread) the campaign should reach.
// A null `stage_name` means "every stage". Results are paginated through
// PostgREST so audiences larger than max_rows (1000) come back complete.
export async function resolveAudience(
  admin: SupabaseClient,
  userId: string,
  intent: ParsedIntent,
): Promise<AudienceLead[]> {
  const stageName = intent.audience.stage_name?.trim() ?? ''
  const withinDays = intent.audience.last_active_within_days

  const stagesRes = await admin
    .from('pipeline_stages')
    .select('id, name')
    .eq('user_id', userId)
  const stages = (stagesRes.data ?? []) as Array<{ id: string; name: string }>

  // A stage the user named but we can't find must NOT silently widen to
  // "everyone" — that would message thousands of unintended leads.
  let matchedStageId: string | null = null
  if (stageName) {
    matchedStageId = pickStageId(stages, stageName)
    if (!matchedStageId) {
      throw new StageNotFoundError(stageName, stages.map((s) => s.name))
    }
  }

  const cutoff =
    withinDays != null && withinDays > 0
      ? new Date(Date.now() - withinDays * 86400_000).toISOString()
      : null

  const rows = await fetchAllPages<AudienceRow>(async (from, to) => {
    let query = admin
      .from('leads')
      .select(
        `id, name, custom_fields, user_id,
         messenger_threads!inner(
           id, psid, last_inbound_at, page_id,
           facebook_pages!inner(id, page_access_token)
         )`,
      )
      .eq('user_id', userId)
      .order('id', { ascending: true })
      .range(from, to)

    if (matchedStageId) query = query.eq('stage_id', matchedStageId)
    if (cutoff) query = query.gte('messenger_threads.last_inbound_at', cutoff)

    const { data, error } = await query
    if (error) {
      throw new Error(`resolveAudience: query failed — ${error.message}`)
    }
    return (data ?? []) as AudienceRow[]
  }, PAGE_SIZE)

  return rows.flatMap(toAudienceLeads)
}

function toAudienceLeads(lead: AudienceRow): AudienceLead[] {
  const threads = Array.isArray(lead.messenger_threads)
    ? lead.messenger_threads
    : [lead.messenger_threads]
  return threads
    .filter((t) => t && t.facebook_pages)
    .map((t) => {
      const page = Array.isArray(t.facebook_pages) ? t.facebook_pages[0] : t.facebook_pages
      return {
        id: lead.id,
        name: lead.name,
        custom_fields: (lead.custom_fields as Record<string, unknown>) ?? {},
        user_id: lead.user_id,
        thread_id: t.id,
        psid: t.psid,
        last_inbound_at: t.last_inbound_at,
        page_id: page.id,
        page_access_token: decryptToken(page.page_access_token),
      } satisfies AudienceLead
    })
}

// Prefer exact match (case-insensitive), then startsWith, then includes.
export function pickStageId(
  stages: Array<{ id: string; name: string }>,
  target: string,
): string | null {
  const norm = (s: string) => s.trim().toLowerCase()
  const t = norm(target)
  if (!t) return null
  const exact = stages.find((s) => norm(s.name) === t)
  if (exact) return exact.id
  const starts = stages.find((s) => norm(s.name).startsWith(t) || t.startsWith(norm(s.name)))
  if (starts) return starts.id
  const contains = stages.find((s) => norm(s.name).includes(t) || t.includes(norm(s.name)))
  return contains?.id ?? null
}

interface AudienceRow {
  id: string
  name: string | null
  custom_fields: unknown
  user_id: string
  messenger_threads:
    | ThreadJoin
    | ThreadJoin[]
}

interface ThreadJoin {
  id: string
  psid: string
  last_inbound_at: string | null
  page_id: string
  facebook_pages: PageJoin | PageJoin[]
}

interface PageJoin {
  id: string
  page_access_token: string
}
