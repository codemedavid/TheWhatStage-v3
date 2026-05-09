const MS_PER_MIN = 60 * 1000
const MS_PER_HOUR = 60 * MS_PER_MIN
const MS_PER_DAY = 24 * MS_PER_HOUR
const MAX_ABS_MS = 30 * MS_PER_DAY

const PATTERN = /^([+-]?)(\d+)([mhd])?$/

/**
 * Parse a booking-offset string like '-3d', '+1h', '-10m', '0'.
 * Returns milliseconds delta (negative=before event, positive=after).
 * Returns null for invalid input or values beyond ±30 days.
 */
export function parseOffset(s: string): number | null {
  if (typeof s !== 'string' || s.length === 0) return null
  const m = PATTERN.exec(s)
  if (!m) return null
  const [, sign, num, unit] = m
  const n = Number(num)
  if (!Number.isFinite(n)) return null

  if (n === 0) return 0
  if (!unit) return null

  let ms: number
  if (unit === 'm') ms = n * MS_PER_MIN
  else if (unit === 'h') ms = n * MS_PER_HOUR
  else if (unit === 'd') ms = n * MS_PER_DAY
  else return null

  if (sign === '-') ms = -ms
  if (Math.abs(ms) > MAX_ABS_MS) return null
  return ms
}

/**
 * Inverse of parseOffset for canonical values. Picks the largest unit
 * that divides evenly. 0 is rendered as '0'.
 */
export function formatOffset(ms: number): string {
  if (ms === 0) return '0'
  const sign = ms < 0 ? '-' : '+'
  const abs = Math.abs(ms)
  if (abs % MS_PER_DAY === 0) return `${sign}${abs / MS_PER_DAY}d`
  if (abs % MS_PER_HOUR === 0) return `${sign}${abs / MS_PER_HOUR}h`
  return `${sign}${Math.round(abs / MS_PER_MIN)}m`
}
