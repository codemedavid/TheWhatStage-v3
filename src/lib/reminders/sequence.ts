// Schedule shape for the dedicated reminder follow-up sequence. Cumulative
// day offsets from the anchor (the customer's requested follow-up time).

export const SEQUENCE_OFFSETS_DAYS = [0, 1, 2, 3, 5, 8, 13] as const
export const SEQUENCE_LENGTH = SEQUENCE_OFFSETS_DAYS.length

const DAY_MS = 86_400_000

const POSITION_ROLES: readonly string[] = [
  'The promised delivery — honors the requested follow-up directly, references the topic, and asks what the customer would like to do next.',
  'First light nudge one day later. Gentle, references the topic.',
  'Two days after anchor. Offer to clarify or break down something specific about the topic.',
  'Three days after anchor. Brief, low-pressure check-in. Shorter than earlier touchpoints.',
  'Five days after anchor. Re-engage from a fresh angle — propose a new value-add or ask a different question.',
  'Eight days after anchor. Last substantive ping. Could mention flexibility, alternatives, or a specific next step.',
  'Thirteen days after anchor. Gracious final close. Door-open exit: invite them back anytime, no pressure.',
] as const

function assertPos(pos: number): void {
  if (!Number.isInteger(pos) || pos < 0 || pos >= SEQUENCE_LENGTH) {
    throw new RangeError(`sequence position must be 0..${SEQUENCE_LENGTH - 1}, got ${pos}`)
  }
}

export function scheduledAtForPosition(anchor: Date, pos: number): Date {
  assertPos(pos)
  return new Date(anchor.getTime() + SEQUENCE_OFFSETS_DAYS[pos] * DAY_MS)
}

export function roleForPosition(pos: number): string {
  assertPos(pos)
  return POSITION_ROLES[pos]
}
