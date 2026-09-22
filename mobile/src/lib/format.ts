import { AVATAR_TINTS } from '@/theme/tokens'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

/** Messenger-style compact timestamp: "now", "5m", "3h", "Tue", "Mar 4". */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Math.max(0, now - t)
  if (diff < MINUTE) return 'now'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m`
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`
  if (diff < WEEK) return new Date(t).toLocaleDateString(undefined, { weekday: 'short' })
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Long-form timestamp for message groups: "Today 14:05", "Mon 09:12", "Mar 4, 2026". */
export function messageStamp(iso: string, now = Date.now()): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const diff = now - d.getTime()
  const sameDay = new Date(now).toDateString() === d.toDateString()
  if (sameDay) return `Today ${time}`
  if (diff < WEEK) return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function initials(name: string | null | undefined): string {
  const clean = (name ?? '').trim()
  if (!clean) return '?'
  const parts = clean.split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : ''
  return (first + last).toUpperCase() || '?'
}

export function avatarTint(seed: string | null | undefined) {
  const s = seed ?? ''
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0
  return AVATAR_TINTS[hash % AVATAR_TINTS.length]
}

export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? ''
}

export function money(value: number | string | null | undefined, currency = 'PHP'): string {
  const n = typeof value === 'string' ? Number(value) : value
  if (n == null || Number.isNaN(n)) return ''
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(n)
  } catch {
    return `${currency} ${Math.round(n).toLocaleString()}`
  }
}

export function truncate(text: string | null | undefined, max = 80): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** Substitute the campaign merge tags locally for previews. */
export function previewPersonalize(text: string, name: string | null | undefined): string {
  const full = (name ?? '').trim() || 'there'
  const first = firstName(name) || 'there'
  const parts = full.split(/\s+/)
  const last = parts.length > 1 ? parts[parts.length - 1] : 'there'
  return text.replace(/\[\s*([a-z_ ]+)\s*\]/gi, (m, raw: string) => {
    const key = raw.toLowerCase().replace(/[\s-]+/g, '_')
    if (['first_name', 'firstname', 'fname', 'given_name'].includes(key)) return first
    if (['name', 'full_name', 'fullname'].includes(key)) return full
    if (['last_name', 'lastname', 'lname', 'surname', 'family_name'].includes(key)) return last
    return m
  })
}
