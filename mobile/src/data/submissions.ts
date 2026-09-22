import { useCallback, useMemo } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { DateRange } from '@/lib/date-range'
import { supabase } from '@/lib/supabase'
import { IMPLIED_PROCEED } from '@/lib/submission-data'
import type { ActionPageStat, SubmissionRow } from './types'

// Who filled in which action page. Reads go straight to Supabase — both tables
// carry owner RLS policies — except the per-page rollup, which needs a GROUP BY
// PostgREST cannot express (see the action_page_submission_stats migration).

const SELECT =
  'id, action_page_id, lead_id, psid, outcome, data, created_at, leads(name), action_pages(title, kind, slug)'

// Searching by name has to filter on the embedded lead, which PostgREST only
// does through an inner join — so a name search deliberately drops anonymous
// web submissions, which have no lead to match.
const SEARCH_SELECT = SELECT.replace('leads(name)', 'leads!inner(name)')

const PAGE_SIZE = 30

/** Which rows count as somebody actually filling the page in. */
export type OutcomeFilter = 'all' | 'filled' | 'implied'

export interface SubmissionFilter {
  /** A single action page, or null for every page. */
  pageId: string | null
  range: DateRange
  outcome: OutcomeFilter
  /** Lead-name search; blank means no search. */
  search: string
}

export const submissionKeys = {
  all: ['submissions'] as const,
  feed: (f: SubmissionFilter) =>
    ['submissions', 'feed', f.pageId ?? 'all', f.range.from, f.range.to, f.outcome, f.search] as const,
  stats: (range: DateRange) => ['submissions', 'stats', range.from, range.to] as const,
  byLead: (leadId: string) => ['submissions', 'byLead', leadId] as const,
}

const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString())

async function fetchSubmissions(filter: SubmissionFilter, page: number): Promise<SubmissionRow[]> {
  const from = page * PAGE_SIZE
  const search = filter.search.trim()
  let q = supabase
    .from('action_page_submissions')
    .select(search ? SEARCH_SELECT : SELECT)
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1)

  // `%` and `,` would otherwise be read as wildcards / filter separators.
  if (search) q = q.ilike('leads.name', `%${search.replace(/[%,]/g, ' ')}%`)

  if (filter.pageId) q = q.eq('action_page_id', filter.pageId)
  const fromIso = iso(filter.range.from)
  const toIso = iso(filter.range.to)
  if (fromIso) q = q.gte('created_at', fromIso)
  if (toIso) q = q.lt('created_at', toIso)
  // `outcome` is nullable, so "not implied" has to spell out the null case.
  if (filter.outcome === 'filled') q = q.or(`outcome.is.null,outcome.neq.${IMPLIED_PROCEED}`)
  if (filter.outcome === 'implied') q = q.eq('outcome', IMPLIED_PROCEED)

  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as SubmissionRow[]
}

/** Paged submission feed, newest first. Exposes flat rows plus `loadMore`. */
export function useSubmissions(filter: SubmissionFilter) {
  const query = useInfiniteQuery({
    queryKey: submissionKeys.feed(filter),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchSubmissions(filter, pageParam),
    getNextPageParam: (last, all) => (last.length < PAGE_SIZE ? undefined : all.length),
  })

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [fetchNextPage, hasNextPage, isFetchingNextPage])

  const rows = useMemo(() => query.data?.pages.flat() ?? [], [query.data])

  return { ...query, rows, loadMore }
}

/** Every owned action page with its fill counts for the range — one round trip. */
export function useSubmissionStats(range: DateRange) {
  return useQuery({
    queryKey: submissionKeys.stats(range),
    queryFn: async () => {
      const { data, error } = await supabase.rpc('action_page_submission_stats', {
        p_from: iso(range.from),
        p_to: iso(range.to),
      })
      if (error) throw new Error(error.message)
      return (data ?? []) as ActionPageStat[]
    },
  })
}

/** Everything one lead has ever submitted — powers "already filled" badges. */
export function useLeadSubmissions(leadId: string | null | undefined) {
  return useQuery({
    queryKey: submissionKeys.byLead(leadId ?? ''),
    enabled: !!leadId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('action_page_submissions')
        .select(SELECT)
        .eq('lead_id', leadId!)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw new Error(error.message)
      return (data ?? []) as unknown as SubmissionRow[]
    },
  })
}
