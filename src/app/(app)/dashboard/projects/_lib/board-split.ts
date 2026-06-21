import type { ProjectCardRow } from './queries'

export type StageSplit = {
  /** Cards rendered in the column's sortable list (never archived). */
  active: ProjectCardRow[]
  /** Archived cards to show below the list — only populated when revealing. */
  archived: ProjectCardRow[]
  /** Count of archived cards in this stage, regardless of `showArchived`. */
  archivedCount: number
}

/**
 * Partition a stage's cards into the active set the board renders and the
 * archived set. Archived cards are always excluded from `active` (they must not
 * enter the sortable/drag list); they only appear in `archived` when the
 * operator has toggled "Show archived". `archivedCount` is independent of the
 * toggle so the column header can always surface "N archived". Pure and
 * order-preserving so the board and tests agree.
 */
export function splitStageProjects(
  projects: ProjectCardRow[],
  showArchived: boolean,
): StageSplit {
  const active: ProjectCardRow[] = []
  const archived: ProjectCardRow[] = []
  for (const p of projects) {
    if (p.is_archived) archived.push(p)
    else active.push(p)
  }
  return {
    active,
    archived: showArchived ? archived : [],
    archivedCount: archived.length,
  }
}
