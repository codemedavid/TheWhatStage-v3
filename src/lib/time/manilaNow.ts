// Shared "now in Asia/Manila" helper. Manila is fixed UTC+08:00 (no DST),
// so the formatting is deterministic and safe for system-prompt injection.

export const MANILA_TZ = 'Asia/Manila'

export interface ManilaNow {
  iso: string // "2026-05-18 14:32"
  weekday: string // "Monday"
  dateLong: string // "Monday, May 18, 2026"
  utcIso: string // "2026-05-18T06:32:00.000Z"
}

function partsInManila(d: Date): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MANILA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'long',
  })
  return Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]))
}

function monthLong(d: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: MANILA_TZ,
    month: 'long',
  }).format(d)
}

export function manilaNow(d: Date = new Date()): ManilaNow {
  const p = partsInManila(d)
  const hour = p.hour === '24' ? '00' : p.hour // Intl quirk on some Node versions
  const iso = `${p.year}-${p.month}-${p.day} ${hour}:${p.minute}`
  const month = monthLong(d)
  const dateLong = `${p.weekday}, ${month} ${Number(p.day)}, ${p.year}`
  return {
    iso,
    weekday: p.weekday,
    dateLong,
    utcIso: d.toISOString(),
  }
}

export function manilaNowBlock(d: Date = new Date()): string {
  const n = manilaNow(d)
  const time = n.iso.slice(11) // "14:32"
  return `Current time: ${n.dateLong}, ${time} (Asia/Manila, UTC+08:00).`
}
