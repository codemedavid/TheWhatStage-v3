// Pure, DB-free view-model for the Inbox. Every inbox row resolves to a single
// lead and deep-links to that lead's conversation (`/dashboard/leads?lead={id}`).
// The four tabs produce heterogeneous source rows (a messenger thread, an action
// page submission, or a project) that all collapse into one `InboxItem` shape so
// the list renders uniformly. Kept side-effect-free so it can be unit-tested
// without a Supabase client.

import { normalizeThreadCounts } from '@/lib/messenger/unread'

export const INBOX_TABS = ['needs-reply', 'important', 'submissions', 'projects'] as const
export type InboxTab = (typeof INBOX_TABS)[number]
export const DEFAULT_TAB: InboxTab = 'needs-reply'

export function isInboxTab(value: unknown): value is InboxTab {
  return typeof value === 'string' && (INBOX_TABS as readonly string[]).includes(value)
}

// Coerce an untrusted `?tab=` search param to a known tab, defaulting to the
// "needs reply" feed so a malformed value never reaches a query.
export function coerceTab(value: unknown): InboxTab {
  return isInboxTab(value) ? value : DEFAULT_TAB
}

export interface InboxItem {
  /** Stable React key — unique per source row across tabs. */
  key: string
  /** Deep-link target for the conversation; null when the row has no lead. */
  leadId: string | null
  name: string
  pictureUrl: string | null
  /** Active (non-archived) project title for the lead, or null. */
  projectTitle: string | null
  /** Facebook page name, or null. */
  pageName: string | null
  /** Last message preview or a short submission summary. */
  preview: string | null
  /** ISO timestamp driving the row's relative-time label. */
  timestamp: string | null
  unreadCount: number
  missedCount: number
  isImportant: boolean
  /** Small contextual label, e.g. a submission kind ("Form", "Booking"). */
  tag: string | null
  source: 'thread' | 'submission' | 'project'
}

// PostgREST one-to-one/embedded joins arrive as an object, a single-element
// array, or null. Flatten to the first row (or null).
function first<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

type ThreadJoin = {
  is_important?: boolean | null
  unread_count?: number | null
  missed_count?: number | null
  picture_url?: string | null
  last_message_at?: string | null
  last_message_preview?: string | null
}

type ProjectChipRow = {
  title?: string | null
  archived_at?: string | null
  updated_at?: string | null
}

// The lead's active project title for the row chip: the most-recently-updated
// NON-archived project. Display-only — not a routing key. Returns null when the
// lead has no live project.
export function pickProjectChip(projects: ProjectChipRow | ProjectChipRow[] | null | undefined): string | null {
  const rows = Array.isArray(projects) ? projects : projects ? [projects] : []
  let chosen: ProjectChipRow | null = null
  for (const p of rows) {
    if (p.archived_at) continue
    if (!chosen || (p.updated_at ?? '') > (chosen.updated_at ?? '')) chosen = p
  }
  return chosen?.title ?? null
}

const TAG_LABELS: Record<string, string> = {
  form: 'Form',
  booking: 'Booking',
  property: 'Property',
  sales: 'Sales',
  catalog: 'Order',
  quiz: 'Quiz',
}

function tagForKind(kind: string | null | undefined): string | null {
  if (!kind) return null
  return TAG_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1)
}

const MAX_PREVIEW_LEN = 140

// Short, human summary for a submission row: prefer the recorded outcome, else
// the first non-empty string value in the submission `data`, else a generic
// label. Never throws on odd `data` shapes.
export function summarizeSubmission(
  outcome: string | null | undefined,
  data: Record<string, unknown> | null | undefined,
): string {
  const trimmedOutcome = typeof outcome === 'string' ? outcome.trim() : ''
  if (trimmedOutcome) return truncate(trimmedOutcome)
  if (data && typeof data === 'object') {
    for (const value of Object.values(data)) {
      if (typeof value === 'string' && value.trim()) return truncate(value.trim())
      if (typeof value === 'number') return String(value)
    }
  }
  return 'New submission'
}

function truncate(s: string): string {
  return s.length > MAX_PREVIEW_LEN ? `${s.slice(0, MAX_PREVIEW_LEN - 1)}…` : s
}

// Which badge a row should show, if any: unread takes precedence over missed,
// mirroring LeadCard / the projects board. Returns null when nothing is waiting.
export function resolveBadge(
  unreadCount: number,
  missedCount: number,
): { count: number; variant: 'unread' | 'missed' } | null {
  if (unreadCount > 0) return { count: unreadCount, variant: 'unread' }
  if (missedCount > 0) return { count: missedCount, variant: 'missed' }
  return null
}

// ---- Raw row shapes (as returned by the inbox queries) --------------------

export interface RawThreadRow {
  id: string
  lead_id: string | null
  full_name: string | null
  picture_url: string | null
  unread_count: number | null
  missed_count: number | null
  is_important: boolean | null
  last_message_at: string | null
  last_message_preview: string | null
  leads:
    | { name?: string | null; projects?: ProjectChipRow | ProjectChipRow[] | null }
    | { name?: string | null; projects?: ProjectChipRow | ProjectChipRow[] | null }[]
    | null
  facebook_pages: { name?: string | null } | { name?: string | null }[] | null
}

export interface RawSubmissionRow {
  id: string
  lead_id: string | null
  outcome: string | null
  data: Record<string, unknown> | null
  created_at: string
  action_pages: { title?: string | null; kind?: string | null } | { title?: string | null; kind?: string | null }[] | null
  leads:
    | { name?: string | null; messenger_threads?: ThreadJoin | ThreadJoin[] | null; projects?: ProjectChipRow | ProjectChipRow[] | null }
    | { name?: string | null; messenger_threads?: ThreadJoin | ThreadJoin[] | null; projects?: ProjectChipRow | ProjectChipRow[] | null }[]
    | null
}

export interface RawProjectRow {
  id: string
  lead_id: string | null
  title: string | null
  updated_at: string | null
  leads:
    | { name?: string | null; messenger_threads?: ThreadJoin | ThreadJoin[] | null }
    | { name?: string | null; messenger_threads?: ThreadJoin | ThreadJoin[] | null }[]
    | null
}

// ---- Mappers (pure) -------------------------------------------------------

const UNKNOWN_NAME = 'Unknown'

export function mapThreadRow(row: RawThreadRow): InboxItem {
  const lead = first(row.leads)
  const page = first(row.facebook_pages)
  const counts = normalizeThreadCounts(row)
  return {
    key: `thread:${row.id}`,
    leadId: row.lead_id,
    name: lead?.name?.trim() || row.full_name?.trim() || UNKNOWN_NAME,
    pictureUrl: row.picture_url ?? null,
    projectTitle: pickProjectChip(lead?.projects),
    pageName: page?.name ?? null,
    preview: row.last_message_preview ?? null,
    timestamp: row.last_message_at ?? null,
    unreadCount: counts.unread_count,
    missedCount: counts.missed_count,
    isImportant: row.is_important === true,
    tag: null,
    source: 'thread',
  }
}

export function mapSubmissionRow(row: RawSubmissionRow): InboxItem {
  const lead = first(row.leads)
  const thread = first(lead?.messenger_threads)
  const page = first(row.action_pages)
  const counts = normalizeThreadCounts(thread)
  return {
    key: `submission:${row.id}`,
    leadId: row.lead_id,
    name: lead?.name?.trim() || UNKNOWN_NAME,
    pictureUrl: thread?.picture_url ?? null,
    projectTitle: pickProjectChip(lead?.projects),
    pageName: page?.title ?? null,
    preview: summarizeSubmission(row.outcome, row.data),
    timestamp: row.created_at,
    unreadCount: counts.unread_count,
    missedCount: counts.missed_count,
    isImportant: thread?.is_important === true,
    tag: tagForKind(page?.kind),
    source: 'submission',
  }
}

export function mapProjectRow(row: RawProjectRow): InboxItem {
  const lead = first(row.leads)
  const thread = first(lead?.messenger_threads)
  const counts = normalizeThreadCounts(thread)
  return {
    key: `project:${row.id}`,
    leadId: row.lead_id,
    name: lead?.name?.trim() || UNKNOWN_NAME,
    pictureUrl: thread?.picture_url ?? null,
    projectTitle: row.title ?? null,
    pageName: null,
    preview: thread?.last_message_preview ?? null,
    timestamp: thread?.last_message_at ?? row.updated_at ?? null,
    unreadCount: counts.unread_count,
    missedCount: counts.missed_count,
    isImportant: thread?.is_important === true,
    tag: null,
    source: 'project',
  }
}
