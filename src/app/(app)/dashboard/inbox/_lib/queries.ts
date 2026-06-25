import type { SupabaseClient } from '@supabase/supabase-js'
import {
  mapThreadRow,
  mapSubmissionRow,
  mapProjectRow,
  type InboxItem,
  type InboxTab,
  type RawThreadRow,
  type RawSubmissionRow,
  type RawProjectRow,
} from './rows'

// One screenful per tab. The "needs reply" / "important" working sets are tiny
// in practice; submissions/projects use the same cap with the existing recent
// indexes. "Load more" can be layered on later — out of scope for v1.
export const INBOX_PAGE_SIZE = 50

const THREAD_SELECT =
  'id, lead_id, full_name, picture_url, unread_count, missed_count, is_important, last_message_at, last_message_preview, ' +
  'leads(name, projects(title, archived_at, updated_at)), facebook_pages(name)'

const SUBMISSION_SELECT =
  'id, lead_id, outcome, data, created_at, action_pages(title, kind), ' +
  'leads(name, messenger_threads(is_important, unread_count, missed_count, picture_url), projects(title, archived_at, updated_at))'

const PROJECT_SELECT =
  'id, lead_id, title, updated_at, ' +
  'leads(name, messenger_threads(is_important, unread_count, missed_count, picture_url, last_message_at, last_message_preview))'

// Threads where the client is waiting on a reply: an unread message OR a missed
// one. Served by messenger_threads_user_recent_idx(user_id, last_message_at desc).
export async function fetchNeedsReply(
  supabase: SupabaseClient,
  userId: string,
  limit = INBOX_PAGE_SIZE,
): Promise<InboxItem[]> {
  const { data, error } = await supabase
    .from('messenger_threads')
    .select(THREAD_SELECT)
    .eq('user_id', userId)
    .or('unread_count.gt.0,missed_count.gt.0')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) throw new Error(`fetchNeedsReply: ${error.message}`)
  return ((data ?? []) as unknown as RawThreadRow[]).map(mapThreadRow)
}

// Manually pinned threads ("important to check"), newest activity first. Served
// by the partial messenger_threads_user_important_idx.
export async function fetchImportant(
  supabase: SupabaseClient,
  userId: string,
  limit = INBOX_PAGE_SIZE,
): Promise<InboxItem[]> {
  const { data, error } = await supabase
    .from('messenger_threads')
    .select(THREAD_SELECT)
    .eq('user_id', userId)
    .eq('is_important', true)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(limit)
  if (error) throw new Error(`fetchImportant: ${error.message}`)
  return ((data ?? []) as unknown as RawThreadRow[]).map(mapThreadRow)
}

// Recent action-page submissions across ALL pages — includes form/booking/order
// submissions even when the lead never started a Messenger chat. Served by
// action_page_submissions_lead_idx / a created_at scan within the user's rows.
export async function fetchRecentSubmissions(
  supabase: SupabaseClient,
  userId: string,
  limit = INBOX_PAGE_SIZE,
): Promise<InboxItem[]> {
  const { data, error } = await supabase
    .from('action_page_submissions')
    .select(SUBMISSION_SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`fetchRecentSubmissions: ${error.message}`)
  return ((data ?? []) as unknown as RawSubmissionRow[]).map(mapSubmissionRow)
}

// Leads the operator "has operation with": every active (non-archived) project,
// most-recently-updated first, with the lead's unread/pin state for the row.
export async function fetchProjectLeads(
  supabase: SupabaseClient,
  userId: string,
  limit = INBOX_PAGE_SIZE,
): Promise<InboxItem[]> {
  const { data, error } = await supabase
    .from('projects')
    .select(PROJECT_SELECT)
    .eq('user_id', userId)
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`fetchProjectLeads: ${error.message}`)
  return ((data ?? []) as unknown as RawProjectRow[]).map(mapProjectRow)
}

// Dispatch the active tab to its fetcher.
export function fetchInboxItems(
  supabase: SupabaseClient,
  userId: string,
  tab: InboxTab,
  limit = INBOX_PAGE_SIZE,
): Promise<InboxItem[]> {
  switch (tab) {
    case 'important':
      return fetchImportant(supabase, userId, limit)
    case 'submissions':
      return fetchRecentSubmissions(supabase, userId, limit)
    case 'projects':
      return fetchProjectLeads(supabase, userId, limit)
    case 'needs-reply':
    default:
      return fetchNeedsReply(supabase, userId, limit)
  }
}

// Distinct conversations waiting on a reply (unread OR missed). Powers the
// sidebar "Inbox" badge and the "Needs reply" tab chip. A thread count (not a
// message sum) so the number reads as "how many people are waiting".
export async function countNeedsReply(supabase: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('messenger_threads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .or('unread_count.gt.0,missed_count.gt.0')
  if (error) throw new Error(`countNeedsReply: ${error.message}`)
  return count ?? 0
}

// Count of pinned threads, for the "Important" tab chip.
export async function countImportant(supabase: SupabaseClient, userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('messenger_threads')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_important', true)
  if (error) throw new Error(`countImportant: ${error.message}`)
  return count ?? 0
}
