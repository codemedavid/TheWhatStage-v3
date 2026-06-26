// Pure helpers for the projects List view. Kept free of any "use client"
// boundary so they can be unit-tested in isolation and reused by the server
// component if needed. The board has no dedicated "deadline" or "priority"
// columns, so the List view DERIVES both from existing data:
//   - "Deadline" surfaces the project's last-updated date.
//   - "Priority" is derived from the stage kind (won/lost) or, for open
//     projects, bucketed from the deal value.
import type { ProjectCardRow } from './queries'

const EM_DASH = '—'

/**
 * Format a project's date for the List view's "Deadline" column. Returns an
 * em dash for empty or unparseable input rather than the literal "Invalid Date"
 * the platform formatter would otherwise produce.
 */
export function formatListDate(iso: string | null | undefined): string {
  if (!iso) return EM_DASH
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return EM_DASH
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date)
  } catch {
    return EM_DASH
  }
}

export type PriorityTone = 'won' | 'lost' | 'high' | 'medium' | 'low'

export type ProjectPriority = {
  label: string
  tone: PriorityTone
}

// Value bands for the derived priority badge. Heuristic (currency-agnostic)
// stand-ins for a real priority field — named so the intent reads clearly and
// the thresholds aren't magic numbers buried in a conditional.
const HIGH_VALUE_THRESHOLD = 50_000
const MEDIUM_VALUE_THRESHOLD = 10_000

/**
 * Derive the List view's "Priority" badge from a project. Won/lost stages take
 * precedence (the deal's outcome is more meaningful than its size); open
 * projects fall back to value bands. A missing stage kind is treated as open
 * and a missing value as the lowest band.
 */
export function deriveProjectPriority(project: ProjectCardRow): ProjectPriority {
  if (project.stage_kind === 'won') return { label: 'Won', tone: 'won' }
  if (project.stage_kind === 'lost') return { label: 'Lost', tone: 'lost' }

  const value = project.value ?? 0
  if (value >= HIGH_VALUE_THRESHOLD) return { label: 'High', tone: 'high' }
  if (value >= MEDIUM_VALUE_THRESHOLD) return { label: 'Medium', tone: 'medium' }
  return { label: 'Low', tone: 'low' }
}
