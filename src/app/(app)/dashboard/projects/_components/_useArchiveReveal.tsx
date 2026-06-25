'use client'
import { createContext, useContext, useState, type ReactNode } from 'react'

type ArchiveRevealValue = {
  /** Whether archived cards are revealed inline on the board. */
  showArchived: boolean
  /** Flip the reveal. Instant, client-only — no URL/server round-trip. */
  toggleArchived: () => void
}

const ArchiveRevealContext = createContext<ArchiveRevealValue | null>(null)

/**
 * Holds the "Show archived" reveal as CLIENT state shared by the toolbar toggle
 * and the board. The board already fetches every project (archived included),
 * so revealing them never needed a server trip — the old `?archived=1` →
 * server re-render → prop path silently failed to re-render, so the toggle did
 * nothing. `initial` seeds from the URL so `?archived=1` deep-links still reveal
 * on first load, but every subsequent toggle is instant and local.
 */
export function ArchiveRevealProvider({
  initial = false,
  children,
}: {
  initial?: boolean
  children: ReactNode
}) {
  const [showArchived, setShowArchived] = useState(initial)
  const toggleArchived = () => setShowArchived((v) => !v)
  return (
    <ArchiveRevealContext.Provider value={{ showArchived, toggleArchived }}>
      {children}
    </ArchiveRevealContext.Provider>
  )
}

export function useArchiveReveal(): ArchiveRevealValue {
  const ctx = useContext(ArchiveRevealContext)
  if (!ctx) {
    throw new Error('useArchiveReveal must be used within an ArchiveRevealProvider')
  }
  return ctx
}
