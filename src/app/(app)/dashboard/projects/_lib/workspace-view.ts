// Pure presentation helpers for the workspaces index (avatar, relative time,
// search + sort). No IO and no "use client" boundary so they can be unit-tested
// directly and reused from server or client.
import type { WorkspaceSummary } from './workspaces'

export type WorkspaceSort = 'recent' | 'name' | 'value' | 'projects'

export const WORKSPACE_SORTS: { value: WorkspaceSort; label: string }[] = [
  { value: 'recent', label: 'Recently updated' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'value', label: 'Pipeline value' },
  { value: 'projects', label: 'Most projects' },
]

// ── Avatar ────────────────────────────────────────────────────────────────

export type WorkspaceAvatar = { initial: string; bg: string; fg: string }

// Soft tints paired with a saturated foreground, mirroring the imported design.
const AVATAR_PALETTE: { bg: string; fg: string }[] = [
  { bg: '#FBEAE0', fg: '#C2622E' },
  { bg: '#E5EBFA', fg: '#3B5BD8' },
  { bg: '#F3E6F7', fg: '#8A3DA8' },
  { bg: '#FBF0DC', fg: '#B58319' },
  { bg: '#E0F0F2', fg: '#2C8A93' },
  { bg: '#F7E6E6', fg: '#C23E3E' },
]

// The default workspace always reads as the brand accent; others hash their id
// to a stable palette slot so the colour never shifts between renders.
export function workspaceAvatar(ws: Pick<WorkspaceSummary, 'id' | 'name' | 'is_default'>): WorkspaceAvatar {
  const initial = (ws.name.trim()[0] ?? '?').toUpperCase()
  if (ws.is_default) return { initial, bg: '#E6F0E9', fg: '#2F7A53' }
  let hash = 0
  for (let i = 0; i < ws.id.length; i++) hash = (hash * 31 + ws.id.charCodeAt(i)) >>> 0
  const slot = AVATAR_PALETTE[hash % AVATAR_PALETTE.length]
  return { initial, ...slot }
}

// ── Relative time ───────────────────────────────────────────────────────────

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

// Compact "Updated …" label. `nowMs` is injected (not read from Date.now here)
// so callers control the reference time and tests stay deterministic.
export function formatRelativeUpdated(iso: string | null, nowMs: number): string {
  if (!iso) return 'No activity yet'
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return 'No activity yet'
  const diff = Math.max(0, nowMs - then)
  if (diff < MINUTE) return 'Updated just now'
  if (diff < HOUR) return plural(Math.floor(diff / MINUTE), 'minute')
  if (diff < DAY) return plural(Math.floor(diff / HOUR), 'hour')
  if (diff < 2 * DAY) return 'Updated yesterday'
  if (diff < WEEK) return plural(Math.floor(diff / DAY), 'day')
  if (diff < 2 * WEEK) return 'Updated last week'
  return plural(Math.floor(diff / WEEK), 'week')
}

function plural(n: number, unit: string): string {
  return `Updated ${n} ${unit}${n === 1 ? '' : 's'} ago`
}

// ── Search + sort ────────────────────────────────────────────────────────────

// Filter by case-insensitive name/description substring, then sort. Returns a
// new array (never mutates the input) per the project's immutability rule.
export function filterAndSortWorkspaces(
  summaries: readonly WorkspaceSummary[],
  query: string,
  sort: WorkspaceSort,
): WorkspaceSummary[] {
  const q = query.trim().toLowerCase()
  const filtered = q
    ? summaries.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.description ?? '').toLowerCase().includes(q),
      )
    : [...summaries]

  return filtered.sort((a, b) => {
    switch (sort) {
      case 'name':
        return a.name.localeCompare(b.name)
      case 'value':
        return b.openValue - a.openValue
      case 'projects':
        return b.activeProjectCount - a.activeProjectCount
      case 'recent':
      default:
        return updatedMs(b) - updatedMs(a)
    }
  })
}

function updatedMs(s: WorkspaceSummary): number {
  const t = s.updated_at ? Date.parse(s.updated_at) : NaN
  return Number.isNaN(t) ? 0 : t
}
