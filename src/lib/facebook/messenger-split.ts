/**
 * messenger-split.ts
 *
 * Split long text into Messenger-safe chunks.
 *
 * The Messenger Send API rejects a text message longer than 2000 characters
 * with Graph error code 100 (subcode 2018048, "message exceeds maximum
 * length") and delivers NOTHING — the whole send fails. A verbose bot reply or
 * a long operator paste therefore silently disappears unless we split it first.
 *
 * Splitting prefers the most natural boundary that still fits: paragraph break,
 * then line break, then sentence end, then word boundary, and only as a last
 * resort a hard character cut (which is kept surrogate-pair-safe so emoji are
 * never sliced in half). No non-whitespace content is ever dropped; only the
 * whitespace at a chosen split point is collapsed between chunks.
 *
 * Pure module — no imports, safe to use from the low-level send wrappers.
 */

// Conservative ceiling. Meta counts characters; JS `String.length` counts
// UTF-16 code units (>= character count), so staying at/under this by `.length`
// guarantees we never exceed Meta's limit even with multi-byte characters.
export const MESSENGER_TEXT_LIMIT = 2000

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff
}

/**
 * Index at which to cut `s` so the first piece is <= `limit` and lands on the
 * most natural boundary available. `s.length` is assumed > `limit`.
 */
function findCutIndex(s: string, limit: number): number {
  // Look one char past the limit so a boundary sitting exactly at `limit`
  // (e.g. a newline) is still considered.
  const window = s.slice(0, limit + 1)

  const paragraph = window.lastIndexOf('\n\n')
  if (paragraph > 0) return paragraph

  const line = window.lastIndexOf('\n')
  if (line > 0) return line

  // Last sentence terminator (.,!,?,…) followed by whitespace, cutting AFTER
  // the punctuation so it stays with its sentence.
  const sentenceRe = /[.!?…](?=\s)/g
  let sentenceEnd = -1
  for (let m = sentenceRe.exec(window); m; m = sentenceRe.exec(window)) {
    if (m.index < limit) sentenceEnd = m.index + 1
  }
  if (sentenceEnd > 0) return sentenceEnd

  const space = window.slice(0, limit).lastIndexOf(' ')
  if (space > 0) return space

  // No natural boundary — hard cut at the limit, but never between the two
  // halves of a surrogate pair.
  let cut = limit
  if (isHighSurrogate(s.charCodeAt(cut - 1))) cut -= 1
  return Math.max(cut, 1)
}

/**
 * Split `text` into an ordered list of chunks, each at most `limit` characters.
 * Returns `[]` for empty/whitespace-only input and `[text]` when it already
 * fits.
 */
export function splitMessengerText(text: string, limit = MESSENGER_TEXT_LIMIT): string[] {
  const safeLimit = limit > 0 ? limit : MESSENGER_TEXT_LIMIT
  if (!text.trim()) return []
  if (text.length <= safeLimit) return [text]

  const chunks: string[] = []
  let remaining = text
  while (remaining.length > safeLimit) {
    const cut = findCutIndex(remaining, safeLimit)
    const head = remaining.slice(0, cut).trimEnd()
    if (head) chunks.push(head)
    remaining = remaining.slice(cut).trimStart()
  }
  if (remaining) chunks.push(remaining)
  return chunks
}
