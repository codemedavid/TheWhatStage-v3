// Curated per-position fallback lines. Used when pre-generation fails AND
// fire-time refresh also fails. Uses {name} as the substitution token.

import { sanitizeFollowup } from '@/lib/followups/sanitize'
import { SEQUENCE_LENGTH } from './sequence'

export const SEQUENCE_FALLBACKS: readonly string[] = [
  'Hi {name}, balik lang po ako gaya ng usap natin. Pwede pa po ba tayong mag chat ngayon?',
  'Hi {name}, follow up lang po. May oras po ba kayo today para i tuloy yung usapan natin?',
  'Hi {name}, sabihan niyo lang po kung may gusto kayong i clarify or i breakdown.',
  'Hi {name}, nandito lang po ako kung gusto niyong balikan ulit.',
  'Hi {name}, may bago akong idea para sa inyo. Pwede po ba i discuss?',
  'Hi {name}, last in depth check po. May specific concern po ba kayo na pwede kong sagutin?',
  'Hi {name}, kahit anong oras po kayong handa na, dito lang ako. Salamat po sa oras niyo!',
] as const

if (SEQUENCE_FALLBACKS.length !== SEQUENCE_LENGTH) {
  throw new Error('SEQUENCE_FALLBACKS length must match SEQUENCE_LENGTH')
}

function firstToken(name: string | null): string {
  if (!name) return ''
  return name.trim().split(/\s+/)[0] ?? ''
}

export function fallbackForPosition(pos: number, leadName: string | null): string {
  if (!Number.isInteger(pos) || pos < 0 || pos >= SEQUENCE_LENGTH) {
    throw new RangeError(`sequence position must be 0..${SEQUENCE_LENGTH - 1}, got ${pos}`)
  }
  const fn = firstToken(leadName) || 'there'
  return sanitizeFollowup(SEQUENCE_FALLBACKS[pos].replace('{name}', fn))
}
