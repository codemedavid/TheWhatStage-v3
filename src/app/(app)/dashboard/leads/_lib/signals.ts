// Client-safe lead helpers. Kept OUT of `queries.ts` because that module imports
// the server-only Supabase admin client; pulling any runtime value from it into
// a client component (e.g. LeadCard) drags `server-only` into the browser bundle
// and fails the build. This file has no server-only dependencies, so both server
// code (via the re-export in queries.ts) and client components can import it.

/**
 * Parse a stage-event `reason` string of the form
 * `matched: <signal>, <signal> — <free text>` into its matched signals and the
 * trailing free-form reason. Falls back to treating the whole string as the
 * free reason when it doesn't match that shape.
 */
export function parseMatchedSignals(
  reason: string | null | undefined,
): { matched: string[]; freeReason: string } {
  if (!reason) return { matched: [], freeReason: '' }
  const m = reason.match(/^matched:\s*([^—]+?)\s*—\s*(.*)$/)
  if (!m) return { matched: [], freeReason: reason }
  return {
    matched: m[1].split(',').map((x) => x.trim()).filter(Boolean),
    freeReason: m[2],
  }
}
