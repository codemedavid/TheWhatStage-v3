import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptToken } from '@/lib/facebook/crypto'
import type { AudienceLead, ParsedIntent } from './types'

const MAX_AUDIENCE = 200

export async function resolveAudience(
  admin: SupabaseClient,
  userId: string,
  intent: ParsedIntent,
): Promise<AudienceLead[]> {
  const stageName = intent.audience.stage_name?.trim().toLowerCase() ?? null
  const withinDays = intent.audience.last_active_within_days

  // Build the leads query with joins.
  // Supabase JS doesn't support pg_trgm fuzzy match directly,
  // so we fetch all stages for the user and match by lowercase equality first,
  // then fall through to a contains match for flexibility.
  const stagesRes = await admin
    .from('pipeline_stages')
    .select('id, name')
    .eq('user_id', userId)
  const stages = stagesRes.data ?? []

  const matchedStageId = stageName ? pickStageId(stages, stageName) : null

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
    .limit(MAX_AUDIENCE)

  if (matchedStageId) {
    query = query.eq('stage_id', matchedStageId)
  }

  if (withinDays != null && withinDays > 0) {
    const cutoff = new Date(Date.now() - withinDays * 86400_000).toISOString()
    query = query.gte('messenger_threads.last_inbound_at', cutoff)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`resolveAudience: query failed — ${error.message}`)
  }

  const rows = (data ?? []) as AudienceRow[]
  return rows.flatMap((lead) => {
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
  })
}

// Prefer exact match (case-insensitive), then startsWith, then includes.
function pickStageId(
  stages: Array<{ id: string; name: string }>,
  target: string,
): string | null {
  const norm = (s: string) => s.trim().toLowerCase()
  const t = norm(target)
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
