import type { ProjectCardRow } from './queries'

/** The tabs the project drawer can open on. */
export const DRAWER_TABS = ['overview', 'submissions', 'conversation', 'followup'] as const
export type DrawerTab = (typeof DRAWER_TABS)[number]

/**
 * Resolve which tab the drawer should open on. Untrusted at the boundary (the
 * card's Read button and any deep link can request a tab), so an unknown value
 * falls back to 'overview' rather than rendering a blank panel.
 */
export function resolveInitialDrawerTab(requested?: string | null): DrawerTab {
  return DRAWER_TABS.includes(requested as DrawerTab) ? (requested as DrawerTab) : 'overview'
}

/** View-model for the project drawer's top action toolbar. */
export type ProjectToolbarModel = {
  /** Archive / unarchive toggle. The button is styled green for "Archive". */
  archive: {
    isArchived: boolean
    label: 'Archive' | 'Unarchive'
  }
  /** Quick "read messages" button — jumps to the conversation and clears badges. */
  read: {
    /** Only render the button when there is something to read. */
    show: boolean
    /** Count surfaced on the button (unread takes precedence over missed). */
    count: number
    /** 'unread' (red) = waiting on us; 'missed' (amber) = we never attended. */
    variant: 'unread' | 'missed'
    /** Human label, e.g. "Read 3 messages" / "Read 1 message" / "Read 2 missed". */
    label: string
  }
}

const clamp = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)

/**
 * Derive the top-toolbar state from a project card. Pure so the drawer and its
 * tests agree. The read button mirrors the card badge rule: surface unread when
 * any is waiting, otherwise fall back to the running "missed" tally.
 */
export function buildProjectToolbarModel(project: ProjectCardRow): ProjectToolbarModel {
  const isArchived = project.is_archived
  const unread = clamp(project.unread_count)
  const missed = clamp(project.missed_count)

  const read = unread > 0
    ? { show: true, count: unread, variant: 'unread' as const, label: `Read ${unread} message${unread === 1 ? '' : 's'}` }
    : missed > 0
      ? { show: true, count: missed, variant: 'missed' as const, label: `Read ${missed} missed` }
      : { show: false, count: 0, variant: 'unread' as const, label: 'Read messages' }

  return {
    archive: { isArchived, label: isArchived ? 'Unarchive' : 'Archive' },
    read,
  }
}
