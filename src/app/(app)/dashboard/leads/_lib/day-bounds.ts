/**
 * Day-boundary helpers for the leads date filters.
 *
 * The Toolbar's `from`/`to` chips and the `range` presets are expressed as
 * Asia/Manila calendar days (YYYY-MM-DD). The leads live in Postgres with
 * `timestamptz` columns, so a Manila day must be converted to the precise UTC
 * instant window it covers before it can be compared. Manila is a fixed UTC+8
 * offset (no DST), so the mapping is deterministic.
 */

const MANILA_OFFSET = '+08:00'

/** Inclusive lower bound: 00:00:00.000 Manila of `day`, as a UTC ISO instant. */
export function manilaDayStartIso(day: string): string {
  return new Date(`${day}T00:00:00.000${MANILA_OFFSET}`).toISOString()
}

/** Inclusive upper bound: 23:59:59.999 Manila of `day`, as a UTC ISO instant. */
export function manilaDayEndIso(day: string): string {
  return new Date(`${day}T23:59:59.999${MANILA_OFFSET}`).toISOString()
}
