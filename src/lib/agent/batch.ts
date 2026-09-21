// Helpers for working past PostgREST's per-response row ceiling (1000 rows,
// see supabase/config.toml `max_rows`) and its URL-length limit on `.in()`
// filters. Both bite as soon as an audience is larger than a few hundred
// leads, which is the normal case for a "send to everyone" campaign.

// Rows per page when walking a result set with `.range()`. Must not exceed
// PostgREST's max_rows or the server silently truncates the page.
export const PAGE_SIZE = 1000

// Ids per `.in()` filter. Each UUID is ~40 chars once URL-encoded, so 200 ids
// keeps a GET request comfortably under typical 8-16KB URL limits.
export const IN_CHUNK_SIZE = 200

export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error(`chunk: size must be > 0 (got ${size})`)
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

// Run `fetchPage(from, to)` repeatedly until a short page comes back.
// `fetchPage` receives inclusive 0-based bounds, matching supabase-js
// `.range(from, to)`.
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize: number = PAGE_SIZE,
): Promise<T[]> {
  const pages: T[][] = []
  let from = 0
  for (;;) {
    const page = await fetchPage(from, from + pageSize - 1)
    pages.push(page)
    if (page.length < pageSize) break
    from += pageSize
  }
  return pages.flat()
}

// Fan a list of ids out over several `.in()` queries and concatenate the rows.
export async function fetchByIdChunks<T>(
  ids: readonly string[],
  fetchChunk: (ids: string[]) => Promise<T[]>,
  size: number = IN_CHUNK_SIZE,
): Promise<T[]> {
  if (ids.length === 0) return []
  const results = await Promise.all(chunk(ids, size).map((c) => fetchChunk(c)))
  return results.flat()
}
