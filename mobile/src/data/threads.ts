import { useCallback, useEffect, useMemo } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCoalescedCallback } from '@/lib/coalesce'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/providers/auth'
import type { ThreadRow } from './types'

export type InboxFilter = 'all' | 'unread' | 'important' | 'takeover'

const THREAD_SELECT =
  'id, lead_id, full_name, picture_url, unread_count, missed_count, is_important, auto_reply_enabled, bot_paused_until, last_message_at, last_message_preview, last_inbound_at, last_outbound_at, leads(name, stage_id), facebook_pages(name)'

// A phone shows ~7 rows. The old 200-row page cost ~870ms server-side on a
// 3.4k-thread account and was re-fetched on every realtime event; a page this
// size fills the screen and the rest arrives on scroll.
const PAGE_SIZE = 30

// Realtime fires on every inbound/outbound message and every unread bump. On a
// busy page that is a constant stream, so refetches are coalesced into at most
// one per window instead of one per event.
const REFRESH_WINDOW_MS = 2_500

export const threadKeys = {
  all: ['threads'] as const,
  lists: ['threads', 'list'] as const,
  list: (filter: InboxFilter) => ['threads', 'list', filter] as const,
  unreadCount: ['threads', 'unreadCount'] as const,
  one: (id: string) => ['threads', 'one', id] as const,
  byLead: (leadId: string) => ['threads', 'byLead', leadId] as const,
}

/** `unread` spans two counters, so the predicate lives in one place. */
function applyFilter<T>(q: T, filter: InboxFilter): T {
  const b = q as unknown as {
    or: (v: string) => T
    eq: (c: string, v: unknown) => T
    gt: (c: string, v: unknown) => T
  }
  if (filter === 'unread') return b.or('unread_count.gt.0,missed_count.gt.0')
  if (filter === 'important') return b.eq('is_important', true)
  if (filter === 'takeover') return b.gt('bot_paused_until', new Date().toISOString())
  return q
}

export async function fetchThreads(filter: InboxFilter, page = 0): Promise<ThreadRow[]> {
  const from = page * PAGE_SIZE
  const q = applyFilter(
    supabase
      .from('messenger_threads')
      .select(THREAD_SELECT)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .range(from, from + PAGE_SIZE - 1),
    filter,
  )
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as ThreadRow[]
}

/**
 * Paged inbox. Exposes a flat `rows` array so callers don't deal with pages,
 * plus `loadMore` for the list's `onEndReached`.
 */
export function useThreads(filter: InboxFilter) {
  const query = useInfiniteQuery({
    queryKey: threadKeys.list(filter),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchThreads(filter, pageParam),
    // A short page means the server had nothing more to give.
    getNextPageParam: (last, all) => (last.length < PAGE_SIZE ? undefined : all.length),
  })

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  // Flattened once per page change. Rebuilding it on every render handed the
  // inbox list a new `data` array each time, which is what made VirtualizedList
  // warn about slow updates on a long inbox.
  const rows = useMemo(() => query.data?.pages.flat() ?? [], [query.data])

  return {
    rows,
    isLoading: query.isLoading,
    isError: query.isError,
    isRefetching: query.isRefetching,
    refetch: query.refetch,
    isFetchingNextPage,
    loadMore,
  }
}

/**
 * Badge count. Counts server-side — the tab bar used to pull 200 full thread
 * rows (joins included) just to read `.length`, which also silently capped the
 * badge at the page size.
 */
export function useUnreadThreadCount() {
  return useQuery({
    queryKey: threadKeys.unreadCount,
    queryFn: async () => {
      const { count, error } = await applyFilter(
        supabase.from('messenger_threads').select('id', { count: 'exact', head: true }),
        'unread',
      )
      if (error) throw new Error(error.message)
      return count ?? 0
    },
  })
}

export function useThread(threadId: string | undefined) {
  return useQuery({
    queryKey: threadKeys.one(threadId ?? ''),
    enabled: !!threadId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messenger_threads')
        .select(THREAD_SELECT)
        .eq('id', threadId!)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data ?? null) as unknown as ThreadRow | null
    },
  })
}

export function useThreadByLead(leadId: string | undefined) {
  return useQuery({
    queryKey: threadKeys.byLead(leadId ?? ''),
    enabled: !!leadId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messenger_threads')
        .select(THREAD_SELECT)
        .eq('lead_id', leadId!)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return (data ?? null) as unknown as ThreadRow | null
    },
  })
}

/**
 * Refresh the views a thread mutation can change: the filtered lists, the badge
 * count, and that thread's own row. Deliberately narrower than `threadKeys.all`
 * — opening a chat fires `markSeen`, and invalidating the whole prefix made
 * every open re-fetch every cached list and every other thread.
 */
function invalidateThreadViews(qc: ReturnType<typeof useQueryClient>, threadId?: string): void {
  qc.invalidateQueries({ queryKey: threadKeys.lists })
  qc.invalidateQueries({ queryKey: threadKeys.unreadCount })
  if (threadId) qc.invalidateQueries({ queryKey: threadKeys.one(threadId) })
}

/** Opening a chat clears unread_count (missed_count survives until "mark read"). */
export function useMarkThreadSeen() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (threadId: string) => {
      const { error } = await supabase
        .from('messenger_threads')
        .update({ unread_count: 0, last_read_at: new Date().toISOString() })
        .eq('id', threadId)
      if (error) throw new Error(error.message)
    },
    onSuccess: (_d, threadId) => invalidateThreadViews(qc, threadId),
  })
}

export function useMarkThreadRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (threadId: string) => {
      const { error } = await supabase
        .from('messenger_threads')
        .update({ unread_count: 0, missed_count: 0, last_read_at: new Date().toISOString() })
        .eq('id', threadId)
      if (error) throw new Error(error.message)
    },
    onSuccess: (_d, threadId) => invalidateThreadViews(qc, threadId),
  })
}

export function useToggleImportant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ threadId, value }: { threadId: string; value: boolean }) => {
      const { error } = await supabase
        .from('messenger_threads')
        .update({ is_important: value })
        .eq('id', threadId)
      if (error) throw new Error(error.message)
    },
    onSuccess: (_d, { threadId }) => invalidateThreadViews(qc, threadId),
  })
}

/**
 * Same semantics as the dashboard toggle: turning the bot on also clears any
 * human-takeover pause so it replies to the next message immediately.
 */
export function useSetAutoReply() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ threadId, value }: { threadId: string; value: boolean }) => {
      const patch = value ? { auto_reply_enabled: true, bot_paused_until: null } : { auto_reply_enabled: false }
      const { error } = await supabase.from('messenger_threads').update(patch).eq('id', threadId)
      if (error) throw new Error(error.message)
    },
    onSuccess: (_d, { threadId }) => invalidateThreadViews(qc, threadId),
  })
}

/** Ends a human takeover early without touching the auto-reply setting. */
export function useResumeBot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (threadId: string) => {
      const { error } = await supabase.from('messenger_threads').update({ bot_paused_until: null }).eq('id', threadId)
      if (error) throw new Error(error.message)
    },
    onSuccess: (_d, threadId) => invalidateThreadViews(qc, threadId),
  })
}

/**
 * Live inbox. Every inbound reply, outbound send and unread bump on any of the
 * user's threads arrives here, so a blanket refetch per event meant a busy page
 * kept the inbox permanently re-fetching and the first paint never landed.
 *
 * Instead each burst is coalesced: the first event refreshes immediately, and
 * anything arriving inside REFRESH_WINDOW_MS is collapsed into one trailing
 * refresh. Only the lists and the badge count are invalidated — a specific
 * thread's own row is refreshed by the screen that has it open.
 */
export function useThreadsRealtime() {
  const qc = useQueryClient()
  const { userId } = useAuth()
  const schedule = useCoalescedCallback(() => {
    qc.invalidateQueries({ queryKey: threadKeys.lists })
    qc.invalidateQueries({ queryKey: threadKeys.unreadCount })
  }, REFRESH_WINDOW_MS)

  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel(`threads:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messenger_threads', filter: `user_id=eq.${userId}` },
        schedule,
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [schedule, userId])
}
