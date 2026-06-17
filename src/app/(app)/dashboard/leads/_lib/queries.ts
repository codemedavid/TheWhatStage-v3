import type { SupabaseClient } from '@supabase/supabase-js'
import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { type LeadsQuery, PAGE_SIZE } from './schemas'

export const stagesTag = (userId: string) => `leads:stages:${userId}`
export const fieldDefsTag = (userId: string) => `leads:field-defs:${userId}`

const SORT_MAP: Record<LeadsQuery['sort'], { col: string; asc: boolean; nullsLast?: boolean }> = {
  recent:     { col: 'created_at',      asc: false },
  oldest:     { col: 'created_at',      asc: true  },
  name_asc:   { col: 'name',            asc: true  },
  value_desc: { col: 'estimated_value', asc: false, nullsLast: true },
}

export type LeadRow = {
  id: string
  stage_id: string
  name: string
  email: string | null
  phone: string | null
  company: string | null
  job_title: string | null
  source: string | null
  estimated_value: number | null
  notes: string | null
  custom_fields: Record<string, unknown>
  phones: string[] | null
  emails: string[] | null
  position: number
  created_at: string
  updated_at: string
  picture_url: string | null
  campaign_id: string | null
  campaign_name: string | null
  /** Set when the most recent AI-driven stage event for this lead exists.
   *  null otherwise. Used to render the auto-move badge on the kanban card. */
  latest_auto_move: {
    source: 'classifier' | 'deep_classifier'
    confidence: 'low' | 'medium' | 'high' | null
    reason: string | null
    to_stage_name: string | null
    created_at: string
  } | null
}

type LeadRowWithJoins = Omit<LeadRow, 'picture_url' | 'campaign_name' | 'latest_auto_move'> & {
  messenger_threads: { picture_url: string | null }[] | { picture_url: string | null } | null
  campaigns: { name: string } | { name: string }[] | null
}

function flattenLead(row: LeadRowWithJoins): LeadRow {
  const { messenger_threads: t, campaigns: c, ...rest } = row
  const picture_url = Array.isArray(t)
    ? (t[0]?.picture_url ?? null)
    : (t?.picture_url ?? null)
  const campaign_name = Array.isArray(c)
    ? (c[0]?.name ?? null)
    : (c?.name ?? null)
  return { ...rest, picture_url, campaign_name, latest_auto_move: null }
}

export type StageRow = {
  id: string
  name: string
  description: string | null
  position: number
  is_default: boolean
  kind: 'entry' | 'qualifying' | 'nurture' | 'decision' | 'won' | 'lost' | 'dormant' | 'objection' | null
  entry_signals: string[]
  exit_signals: string[]
  required_fields: string[]
}

export type FieldDefRow = {
  id: string
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'select'
  options: string[] | null
  position: number
}

function normalizeStageRow(row: Record<string, unknown>): StageRow {
  return {
    ...(row as StageRow),
    entry_signals: (row.entry_signals as string[] | null) ?? [],
    exit_signals: (row.exit_signals as string[] | null) ?? [],
    required_fields: (row.required_fields as string[] | null) ?? [],
  }
}

export async function fetchStages(supabase: SupabaseClient, userId: string): Promise<StageRow[]> {
  const { data, error } = await supabase
    .from('pipeline_stages').select('*')
    .eq('user_id', userId).order('position', { ascending: true })
  if (error) throw error
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeStageRow)
}

export async function fetchFieldDefs(supabase: SupabaseClient, userId: string): Promise<FieldDefRow[]> {
  const { data, error } = await supabase
    .from('lead_field_defs').select('*')
    .eq('user_id', userId).order('position', { ascending: true })
  if (error) throw error
  return (data ?? []) as FieldDefRow[]
}

// Cached variants — keyed and tagged per user. Use the admin client because
// `unstable_cache` runs outside the request scope (no cookies); user_id filter
// preserves isolation. Invalidate via revalidateTag in the matching actions.
export function fetchStagesCached(userId: string): Promise<StageRow[]> {
  return unstable_cache(
    async (uid: string) => {
      const admin = createAdminClient()
      const { data, error } = await admin
        .from('pipeline_stages').select('*')
        .eq('user_id', uid).order('position', { ascending: true })
      if (error) throw error
      return ((data ?? []) as Record<string, unknown>[]).map(normalizeStageRow)
    },
    ['leads-stages', userId],
    { tags: [stagesTag(userId)], revalidate: 3600 },
  )(userId)
}

export function fetchFieldDefsCached(userId: string): Promise<FieldDefRow[]> {
  return unstable_cache(
    async (uid: string) => {
      const admin = createAdminClient()
      const { data, error } = await admin
        .from('lead_field_defs').select('*')
        .eq('user_id', uid).order('position', { ascending: true })
      if (error) throw error
      return (data ?? []) as FieldDefRow[]
    },
    ['leads-field-defs', userId],
    { tags: [fieldDefsTag(userId)], revalidate: 3600 },
  )(userId)
}

export async function fetchLeadsTotal(
  supabase: SupabaseClient,
  userId: string,
  params: LeadsQuery,
): Promise<number> {
  let query = supabase
    .from('leads').select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
  if (params.q) {
    const term = `%${params.q}%`
    query = query.or(
      `name.ilike.${term},email.ilike.${term},phone.ilike.${term},company.ilike.${term}`,
    )
  }
  if (params.from) query = query.gte('created_at', `${params.from}T00:00:00Z`)
  if (params.to)   query = query.lte('created_at', `${params.to}T23:59:59Z`)
  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

export async function fetchLeadsPage(
  supabase: SupabaseClient,
  userId: string,
  params: LeadsQuery,
  stageId?: string,
): Promise<{ rows: LeadRow[]; total: number }> {
  const sort = SORT_MAP[params.sort]
  let query = supabase
    .from('leads')
    .select('*, messenger_threads(picture_url), campaigns(name)', { count: 'exact' })
    .eq('user_id', userId)
  if (stageId) query = query.eq('stage_id', stageId)

  if (params.q) {
    const term = `%${params.q}%`
    query = query.or(
      `name.ilike.${term},email.ilike.${term},phone.ilike.${term},company.ilike.${term}`,
    )
  }
  if (params.from) query = query.gte('created_at', `${params.from}T00:00:00Z`)
  if (params.to)   query = query.lte('created_at', `${params.to}T23:59:59Z`)

  query = query.order(sort.col, { ascending: sort.asc, nullsFirst: !sort.nullsLast })

  const from = (params.page - 1) * PAGE_SIZE
  const to   = from + PAGE_SIZE - 1
  const { data, error, count } = await query.range(from, to)
  if (error) throw error
  const rows = ((data ?? []) as LeadRowWithJoins[]).map(flattenLead)

  await populateLatestAutoMove(supabase, rows)

  return { rows, total: count ?? 0 }
}

// Populate latest_auto_move for each lead from lead_stage_events. Mutates the
// passed rows in place (server-only, single-use objects from the query above).
async function populateLatestAutoMove(
  supabase: SupabaseClient,
  rows: LeadRow[],
): Promise<void> {
  const leadIds = rows.map((l) => l.id)
  if (leadIds.length === 0) return

  type AutoMoveRaw = {
    lead_id: string
    source: 'classifier' | 'deep_classifier'
    confidence: 'low' | 'medium' | 'high' | null
    reason: string | null
    to_stage_id: string | null
    created_at: string
  }
  const autoMoveByLead = new Map<string, AutoMoveRaw>()
  const { data: events } = await supabase
    .from('lead_stage_events')
    .select('lead_id, source, confidence, reason, to_stage_id, created_at')
    .in('lead_id', leadIds)
    .in('source', ['classifier', 'deep_classifier'])
    .order('created_at', { ascending: false })
    .limit(500)
  for (const e of (events ?? []) as AutoMoveRaw[]) {
    if (!autoMoveByLead.has(e.lead_id)) {
      autoMoveByLead.set(e.lead_id, e)
    }
  }

  // Resolve stage names
  const stageIds = [
    ...new Set(
      [...autoMoveByLead.values()]
        .map((m) => m.to_stage_id)
        .filter((id): id is string => id !== null),
    ),
  ]
  const stageNameById = new Map<string, string>()
  if (stageIds.length > 0) {
    const { data: stageRows } = await supabase
      .from('pipeline_stages')
      .select('id, name')
      .in('id', stageIds)
    for (const s of (stageRows ?? []) as Array<{ id: string; name: string }>) {
      stageNameById.set(s.id, s.name)
    }
  }

  for (const l of rows) {
    const m = autoMoveByLead.get(l.id)
    l.latest_auto_move = m
      ? {
          source: m.source,
          confidence: m.confidence,
          reason: m.reason,
          to_stage_name: m.to_stage_id ? (stageNameById.get(m.to_stage_id) ?? null) : null,
          created_at: m.created_at,
        }
      : null
  }
}

// Fetch a single lead by id (scoped to the owning user). Used by the
// `?lead=<id>` deep link so "View lead" links from other surfaces open the
// drawer regardless of the active view, filters, or pagination. Returns null
// when the lead does not exist or is not owned by the user.
export async function fetchLeadById(
  supabase: SupabaseClient,
  userId: string,
  leadId: string,
): Promise<LeadRow | null> {
  const { data, error } = await supabase
    .from('leads')
    .select('*, messenger_threads(picture_url), campaigns(name)')
    .eq('user_id', userId)
    .eq('id', leadId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const rows = [flattenLead(data as LeadRowWithJoins)]
  await populateLatestAutoMove(supabase, rows)
  return rows[0]
}

export type CampaignOption = {
  id: string
  name: string
  enabled: boolean
  status: 'draft' | 'active' | 'paused' | 'archived'
  weight: number
}

// Re-exported from the client-safe module so server callers keep importing it
// from here, while client components import it directly from './signals' (this
// module pulls in the server-only admin client and must never reach the browser).
export { parseMatchedSignals } from './signals'

export async function fetchCampaignOptions(
  supabase: SupabaseClient,
  userId: string,
): Promise<CampaignOption[]> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, name, enabled, status, weight')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as CampaignOption[]
}

export type ContactValueRef = {
  value: string
  source: 'form' | 'booking' | 'catalog' | 'messenger' | 'manual'
  collected_at: string
}

export type ContactLeadRow = LeadRow & {
  latest_phone: ContactValueRef | null
  latest_email: ContactValueRef | null
  latest_contact_at: string | null
}

export async function fetchContactLeadsTotal(
  supabase: SupabaseClient,
  userId: string,
  params: LeadsQuery,
): Promise<number> {
  let query = supabase
    .from('leads').select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (params.contact_filter === 'phone') query = query.not('phones', 'eq', '{}')
  else if (params.contact_filter === 'email') query = query.not('emails', 'eq', '{}')
  else if (params.contact_filter === 'both') query = query.not('phones', 'eq', '{}').not('emails', 'eq', '{}')
  else query = query.or('phones.neq.{},emails.neq.{}')

  if (params.q) {
    const term = `%${params.q}%`
    query = query.or(
      `name.ilike.${term},email.ilike.${term},phone.ilike.${term},company.ilike.${term}`,
    )
  }
  if (params.from) query = query.gte('created_at', `${params.from}T00:00:00Z`)
  if (params.to)   query = query.lte('created_at', `${params.to}T23:59:59Z`)
  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

export async function fetchContactLeadsPage(
  supabase: SupabaseClient,
  userId: string,
  params: LeadsQuery,
): Promise<{ rows: ContactLeadRow[]; total: number }> {
  let query = supabase
    .from('leads')
    .select('*, messenger_threads(picture_url), campaigns(name)', { count: 'exact' })
    .eq('user_id', userId)

  if (params.contact_filter === 'phone') query = query.not('phones', 'eq', '{}')
  else if (params.contact_filter === 'email') query = query.not('emails', 'eq', '{}')
  else if (params.contact_filter === 'both') query = query.not('phones', 'eq', '{}').not('emails', 'eq', '{}')
  else query = query.or('phones.neq.{},emails.neq.{}')

  if (params.q) {
    const term = `%${params.q}%`
    query = query.or(
      `name.ilike.${term},email.ilike.${term},phone.ilike.${term},company.ilike.${term}`,
    )
  }
  if (params.from) query = query.gte('created_at', `${params.from}T00:00:00Z`)
  if (params.to)   query = query.lte('created_at', `${params.to}T23:59:59Z`)

  if (params.contact_sort === 'name_asc') {
    query = query.order('name', { ascending: true })
  } else {
    // DB-level fallback: order by updated_at. For recent_contact sort, this is
    // overridden in-memory below for the current page. Cross-page ordering under
    // recent_contact is approximate (updated_at proxy) — acceptable for MVP.
    query = query.order('updated_at', { ascending: false })
  }

  const from = (params.page - 1) * PAGE_SIZE
  const to   = from + PAGE_SIZE - 1
  const { data, error, count } = await query.range(from, to)
  if (error) throw error
  const baseRows = ((data ?? []) as LeadRowWithJoins[]).map(flattenLead)

  const leadIds = baseRows.map((l) => l.id)
  type RawContact = {
    lead_id: string
    kind: 'phone' | 'email'
    value: string
    source: ContactValueRef['source']
    collected_at: string
  }
  const latestByLead = new Map<string, { phone: ContactValueRef | null; email: ContactValueRef | null }>()
  if (leadIds.length > 0) {
    const { data: cv } = await supabase
      .from('lead_contact_values')
      .select('lead_id, kind, value, source, collected_at')
      .in('lead_id', leadIds)
      .order('collected_at', { ascending: false })
    for (const row of (cv ?? []) as RawContact[]) {
      let bucket = latestByLead.get(row.lead_id)
      if (!bucket) {
        bucket = { phone: null, email: null }
        latestByLead.set(row.lead_id, bucket)
      }
      if (row.kind === 'phone' && !bucket.phone) {
        bucket.phone = { value: row.value, source: row.source, collected_at: row.collected_at }
      } else if (row.kind === 'email' && !bucket.email) {
        bucket.email = { value: row.value, source: row.source, collected_at: row.collected_at }
      }
    }
  }

  let rows: ContactLeadRow[] = baseRows.map((l) => {
    const bucket = latestByLead.get(l.id) ?? { phone: null, email: null }
    const latest_contact_at =
      bucket.phone && bucket.email
        ? (bucket.phone.collected_at > bucket.email.collected_at ? bucket.phone.collected_at : bucket.email.collected_at)
        : (bucket.phone?.collected_at ?? bucket.email?.collected_at ?? null)
    return { ...l, latest_phone: bucket.phone, latest_email: bucket.email, latest_contact_at }
  })

  if (params.contact_sort === 'recent_contact') {
    rows = rows.sort((a, b) => {
      if (a.latest_contact_at === b.latest_contact_at) return 0
      if (a.latest_contact_at === null) return 1
      if (b.latest_contact_at === null) return -1
      return a.latest_contact_at < b.latest_contact_at ? 1 : -1
    })
  }

  return { rows, total: count ?? 0 }
}
