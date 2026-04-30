/**
 * Pure helpers for the Booking kind: weekly availability + duration/buffer +
 * date-range -> concrete time slots for a given calendar date.
 *
 * Kept React/Next-free so it can be unit tested in isolation
 * (see booking.slots.test.ts).
 *
 * Time-zone strategy
 * ------------------
 * Each booking page declares an IANA `timezone` (e.g. "Asia/Manila"). For a
 * requested local date `YYYY-MM-DD` we want to emit ISO timestamps whose
 * wall-clock time in `timezone` matches the configured window starts.
 *
 * Approach (no external date lib): for each candidate (year, month, day,
 * hour, minute) in the target zone, compute the matching UTC instant by
 * formatting an arbitrary UTC anchor with `Intl.DateTimeFormat` to discover
 * the zone offset, then subtracting that offset. We re-check after the first
 * pass because DST can shift the offset between the anchor and the candidate.
 */

export interface BookingWindow {
  start: string // 'HH:MM'
  end: string // 'HH:MM'
}

export interface BookingDayAvailability {
  // Accept any number so we line up with the zod-derived shape (which infers
  // `number` from `z.number().int().min(0).max(6)`); range checked at runtime.
  weekday: number
  enabled: boolean
  windows: BookingWindow[]
}

export interface BookingSlotsConfig {
  appointment: {
    duration_min: number
    buffer_min: number
    timezone: string
  }
  availability: BookingDayAvailability[]
  date_range: { from: string | null; to: string | null }
  slots_per_window: number
}

export interface ComputedSlot {
  start_iso: string
  end_iso: string
  taken: number
  capacity: number
  available: number
}

const HHMM_RE = /^(\d{2}):(\d{2})$/

function parseHHMM(value: string): { hour: number; minute: number } | null {
  const m = HHMM_RE.exec(value)
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null
  return { hour, minute }
}

function ymdToUtcMidnight(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null
  return new Date(Date.UTC(y, mo - 1, d))
}

/**
 * Returns the offset (minutes east of UTC) for a given UTC instant in `tz`.
 * Positive for zones east of UTC (e.g. +480 for Asia/Manila).
 */
function tzOffsetMinutes(instant: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts = dtf.formatToParts(instant)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  const hour = get('hour') === 24 ? 0 : get('hour')
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    hour,
    get('minute'),
    get('second'),
  )
  return Math.round((asUtc - instant.getTime()) / 60000)
}

function zonedWallTimeToUtc(
  ymd: string,
  hour: number,
  minute: number,
  tz: string,
): Date | null {
  const baseUtc = ymdToUtcMidnight(ymd)
  if (!baseUtc) return null
  const naiveUtc = new Date(baseUtc.getTime() + (hour * 60 + minute) * 60_000)
  const guessOffset = tzOffsetMinutes(naiveUtc, tz)
  const firstPass = new Date(naiveUtc.getTime() - guessOffset * 60_000)
  const adjustedOffset = tzOffsetMinutes(firstPass, tz)
  return new Date(naiveUtc.getTime() - adjustedOffset * 60_000)
}

function weekdayInZone(ymd: string, tz: string): 0 | 1 | 2 | 3 | 4 | 5 | 6 | null {
  const noonUtc = zonedWallTimeToUtc(ymd, 12, 0, tz)
  if (!noonUtc) return null
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
  })
  const label = dtf.format(noonUtc)
  const map: Record<string, 0 | 1 | 2 | 3 | 4 | 5 | 6> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  return map[label] ?? null
}

function isWithinDateRange(
  ymd: string,
  range: { from: string | null; to: string | null },
): boolean {
  if (range.from && ymd < range.from) return false
  if (range.to && ymd > range.to) return false
  return true
}

export interface ComputeSlotsArgs {
  config: BookingSlotsConfig
  dateYmd: string
  taken: Map<string, number>
  now: Date
}

/**
 * Generate the slot list for a single calendar date in the configured TZ.
 * Returns [] when the date is disabled, outside the range, or has no windows.
 * Past slots (start <= now) are filtered out.
 */
export function computeSlotsForDate(args: ComputeSlotsArgs): ComputedSlot[] {
  const { config, dateYmd, taken, now } = args
  const { duration_min, buffer_min, timezone } = config.appointment
  if (!Number.isFinite(duration_min) || duration_min < 5 || duration_min > 480) return []
  if (!Number.isFinite(buffer_min) || buffer_min < 0 || buffer_min > 120) return []
  if (!isWithinDateRange(dateYmd, config.date_range)) return []

  const weekday = weekdayInZone(dateYmd, timezone)
  if (weekday === null) return []

  const dayCfg = config.availability.find((d) => d.weekday === weekday)
  if (!dayCfg || !dayCfg.enabled || dayCfg.windows.length === 0) return []

  const capacity = Math.max(1, Math.floor(config.slots_per_window || 1))
  const stepMin = duration_min + buffer_min
  const out: ComputedSlot[] = []

  for (const window of dayCfg.windows) {
    const start = parseHHMM(window.start)
    const end = parseHHMM(window.end)
    if (!start || !end) continue
    const startMinutes = start.hour * 60 + start.minute
    const endMinutes = end.hour * 60 + end.minute
    if (endMinutes <= startMinutes) continue

    for (let m = startMinutes; m + duration_min <= endMinutes; m += stepMin) {
      const startUtc = zonedWallTimeToUtc(
        dateYmd,
        Math.floor(m / 60),
        m % 60,
        timezone,
      )
      const endUtc = zonedWallTimeToUtc(
        dateYmd,
        Math.floor((m + duration_min) / 60),
        (m + duration_min) % 60,
        timezone,
      )
      if (!startUtc || !endUtc) continue
      if (startUtc.getTime() <= now.getTime()) continue
      const start_iso = startUtc.toISOString()
      const end_iso = endUtc.toISOString()
      const t = taken.get(start_iso) ?? 0
      out.push({
        start_iso,
        end_iso,
        taken: t,
        capacity,
        available: Math.max(0, capacity - t),
      })
    }
  }

  return out
}

/**
 * Format an ISO instant as a wall-clock label in the configured timezone,
 * e.g. "9:00 AM".
 */
export function formatSlotLabel(iso: string, tz: string): string {
  const d = new Date(iso)
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d)
}

/**
 * Enumerate the next N calendar dates (in the configured TZ) that have at
 * least one window, are enabled, and fall inside `date_range`.
 */
export function listEnabledDates(
  config: BookingSlotsConfig,
  options: { now: Date; horizonDays?: number },
): string[] {
  const horizon = options.horizonDays ?? 30
  const tz = config.appointment.timezone
  const out: string[] = []
  const today = formatYmdInZone(options.now, tz)
  for (let i = 0; i < horizon; i++) {
    const ymd = addDaysYmd(today, i)
    if (!isWithinDateRange(ymd, config.date_range)) continue
    const wd = weekdayInZone(ymd, tz)
    if (wd === null) continue
    const dayCfg = config.availability.find((d) => d.weekday === wd)
    if (!dayCfg || !dayCfg.enabled || dayCfg.windows.length === 0) continue
    out.push(ymd)
  }
  return out
}

export function formatYmdInZone(instant: Date, tz: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return dtf.format(instant)
}

export function addDaysYmd(ymd: string, days: number): string {
  const base = ymdToUtcMidnight(ymd)
  if (!base) return ymd
  const next = new Date(base.getTime() + days * 86_400_000)
  const y = next.getUTCFullYear()
  const m = String(next.getUTCMonth() + 1).padStart(2, '0')
  const d = String(next.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
