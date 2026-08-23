/**
 * structured-lines.ts
 *
 * Split a structured bot reply into an ordered list of chat "bubbles" for the
 * "bubbles" layout of the structured-messages feature. When the bot writes a
 * stairway / 1-3-1 reply — a short lead line, options each on their own line,
 * then a closing line — each meaningful LINE becomes its own bubble:
 *
 *   "Ano po plano niyo?\nFor ordering\nFor monitoring sales"
 *     -> "Ano po plano niyo?"
 *     -> "For ordering"
 *     -> "For monitoring sales"
 *
 * The split is a deterministic heuristic (NOT an LLM call): it splits purely on
 * newlines, so it costs nothing and is fully unit-testable. Sibling to
 * reply-segments.ts (which splits prose on sentence boundaries); this one trusts
 * the line breaks the model already produced under the structured prompt.
 *
 * Guards keep it safe: blank separator lines are dropped, surrounding whitespace
 * is trimmed, and a hard cap collapses any overflow into the last bubble so a
 * long list never spams as many tiny messages. Content is never dropped — only
 * whitespace and blank lines are collapsed; rejoining the bubbles with "\n"
 * reproduces every non-empty line in order.
 *
 * Pure module — no imports. Each returned bubble is still expected to pass
 * through splitMessengerText at send time for the 2000-char Graph safety net.
 */

/** Conservative default so a long option list never explodes into many bubbles. */
export const DEFAULT_STRUCTURED_MAX_BUBBLES = 3

/** A run must have at least this many markers to count as an option list —
 *  a single "B)" in prose is conversation, not an enumeration. */
const MIN_ENUMERATION_RUN = 2

/** Matches an option marker: "A)" / "a." / "1)" / "12." preceded by start-of-text
 *  or whitespace and followed by whitespace + content. Group 2 = label, 3 = punct. */
const ENUM_MARKER_RE = /(^|\s)([A-Ha-h]|\d{1,2})([).])(?=\s+\S)/g

interface EnumMarker {
  /** Index of the label character (after the leading space, if any). */
  start: number
  /** Index just past the marker punctuation. */
  end: number
  label: string
}

/** Sequence position of a marker label: A/a=1, B/b=2, ... or the number itself. */
function markerOrdinal(label: string): number {
  return /\d/.test(label) ? parseInt(label, 10) : label.toUpperCase().charCodeAt(0) - 64
}

/**
 * Safety net for the structured-messages feature: when the model runs an option
 * list into ONE line — "Ano po goal niyo? A) Better ordering B) Mas malaki
 * orders" — break each option onto its own line so the reply is readable on a
 * phone. Markers are rewritten from "X)" to "X." because Messenger converts
 * inline "B)" / "8)" into emoticons (😎), which is exactly how the bug was spotted.
 *
 * Deliberately conservative: it only fires when the text is a single line
 * containing a run of >= 2 same-kind markers that starts the sequence (A or 1)
 * and ascends consecutively. Anything else — prose mentioning "option B)",
 * non-consecutive numbers, text the model already line-broke — passes through
 * byte-identical.
 */
export function breakInlineEnumeration(text: string): string {
  if (!text.trim()) return text
  // Trust line breaks the model already produced.
  if (text.split('\n').filter((l) => l.trim()).length > 1) return text

  const markers: EnumMarker[] = []
  for (const m of text.matchAll(ENUM_MARKER_RE)) {
    markers.push({
      start: (m.index ?? 0) + m[1].length,
      end: (m.index ?? 0) + m[0].length,
      label: m[2],
    })
  }
  if (markers.length < MIN_ENUMERATION_RUN) return text

  // All markers must be the same kind and form A, B, C… / 1, 2, 3… from the top.
  const allNumeric = markers.every((m) => /\d/.test(m.label))
  const allLetters = markers.every((m) => /[A-Ha-h]/.test(m.label))
  if (!allNumeric && !allLetters) return text
  const isConsecutiveFromStart = markers.every((m, i) => markerOrdinal(m.label) === i + 1)
  if (!isConsecutiveFromStart) return text

  const lines: string[] = []
  const lead = text.slice(0, markers[0].start).trim()
  if (lead) lines.push(lead)
  markers.forEach((marker, i) => {
    const contentEnd = i + 1 < markers.length ? markers[i + 1].start : text.length
    const content = text.slice(marker.end, contentEnd).trim()
    lines.push(`${marker.label}. ${content}`)
  })
  return lines.join('\n')
}

export interface StructuredSplitOptions {
  /** Hard ceiling on bubble count; trailing overflow merges into the last one. */
  maxBubbles?: number
}

/**
 * Split `text` into an ordered list of bubbles, one per non-empty line. Returns
 * `[]` for empty/whitespace input and `[trimmed]` when there is a single line.
 */
export function splitStructuredLines(
  text: string,
  opts: StructuredSplitOptions = {},
): string[] {
  if (!text.trim()) return []
  const maxBubbles =
    opts.maxBubbles && opts.maxBubbles > 0 ? opts.maxBubbles : DEFAULT_STRUCTURED_MAX_BUBBLES

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  if (lines.length <= 1) return [text.trim()]
  if (lines.length <= maxBubbles) return lines

  // Keep the first (maxBubbles - 1) lines standalone and fold the remaining
  // lines into the last bubble, preserving their line breaks and order.
  const kept = lines.slice(0, maxBubbles - 1)
  const tail = lines.slice(maxBubbles - 1).join('\n')
  return [...kept, tail]
}
