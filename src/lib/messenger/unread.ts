// Unread / missed message counting helpers, shared across the dashboard
// surfaces that show "a client is waiting on us" badges (projects board, lead
// cards, conversation header, submissions list, global nav counter).
//
// Two counters live on messenger_threads (one thread per lead):
//   - unread_count: messages waiting; reset when the team OPENS the conversation
//     or clicks "Mark as read".
//   - missed_count: running tally; reset ONLY on an explicit "Mark as read"
//     click (or when the lead's project is created). Survives a passive glance,
//     so the team can still see what they never personally attended to.

const DEFAULT_BADGE_MAX = 99

export interface ThreadCounts {
  unread_count: number
  missed_count: number
}

type ThreadCountJoin =
  | { unread_count?: number | null; missed_count?: number | null }
  | { unread_count?: number | null; missed_count?: number | null }[]
  | null
  | undefined

function clampCount(value: number | null | undefined): number {
  const n = value ?? 0
  return n > 0 ? n : 0
}

// Normalize a PostgREST `messenger_threads(unread_count, missed_count)` join —
// which can arrive as an object, a single-element array, or null — into a flat,
// non-negative count pair.
export function normalizeThreadCounts(join: ThreadCountJoin): ThreadCounts {
  const thread = Array.isArray(join) ? (join[0] ?? null) : (join ?? null)
  return {
    unread_count: clampCount(thread?.unread_count),
    missed_count: clampCount(thread?.missed_count),
  }
}

// Render a count for a badge: '' when there's nothing to show (so callers can
// hide the badge), otherwise the floored integer, capped as `${max}+`.
export function formatBadgeCount(count: number, max: number = DEFAULT_BADGE_MAX): string {
  if (!Number.isFinite(count) || count <= 0) return ''
  const n = Math.floor(count)
  return n > max ? `${max}+` : String(n)
}

// Sum unread across a set of threads (e.g. for the global nav counter when
// counts are fetched client-side rather than aggregated in SQL).
export function sumUnread(counts: Array<{ unread_count?: number | null }>): number {
  return counts.reduce((total, c) => total + clampCount(c.unread_count), 0)
}
