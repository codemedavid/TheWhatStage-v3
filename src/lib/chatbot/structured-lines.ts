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
