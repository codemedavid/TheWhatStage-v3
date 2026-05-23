export function formatCurrency(amount: number | null | undefined, currency: string): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return ''
  try {
    const fmt = new Intl.NumberFormat('en-PH', { style: 'currency', currency })
    const parts = fmt.formatToParts(amount)
    const symbolPart = parts.find((p) => p.type === 'currency')
    // If the "symbol" is the raw ISO code (no proper symbol found), use plain fallback
    if (symbolPart && /^[A-Z]{3}$/.test(symbolPart.value)) {
      return `${amount.toFixed(2)} ${currency}`
    }
    return fmt.format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

export function formatDateInTz(iso: string | null | undefined, tz: string): string {
  const d = parseIso(iso)
  if (!d) return ''
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, dateStyle: 'medium' }).format(d)
  } catch {
    return ''
  }
}

export function formatTimeInTz(iso: string | null | undefined, tz: string): string {
  const d = parseIso(iso)
  if (!d) return ''
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeStyle: 'short' }).format(d)
  } catch {
    return ''
  }
}

export function formatDateTimeInTz(iso: string | null | undefined, tz: string): string {
  const date = formatDateInTz(iso, tz)
  const time = formatTimeInTz(iso, tz)
  if (!date && !time) return ''
  if (!date) return time
  if (!time) return date
  return `${date} at ${time}`
}

export function formatDurationMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return ''
  return `${minutes} min`
}

function parseIso(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d
}
