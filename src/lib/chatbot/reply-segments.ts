/**
 * reply-segments.ts
 *
 * Split ONE generated bot reply into a small ordered list of chat "bubbles" so
 * the bot reads like a human cutting a thought across a couple of messages:
 * greeting/acknowledgement first, then the follow-up question on its own line.
 *
 *   "Hello po bossing! Salamat sa message. Ano po name ng business niyo?"
 *     -> "Hello po bossing! Salamat sa message."
 *     -> "Ano po name ng business niyo?"
 *
 * The split is a deterministic heuristic (NOT an LLM call), so it costs nothing
 * and is fully unit-testable. The rule that produces the human feel: a QUESTION
 * sentence ends the current bubble and stands on its own; consecutive statements
 * ride together in one bubble. Guards keep it from ever fragmenting into spam
 * (min length + a hard bubble cap) and from ever dropping content — only the
 * whitespace at a chosen boundary is collapsed between bubbles.
 *
 * Pure module — no imports. Each returned bubble is still expected to pass
 * through splitMessengerText at send time for the 2000-char Graph safety net.
 */

/** Conservative default so replies never explode into a wall of tiny bubbles. */
export const DEFAULT_SPLIT_MAX_BUBBLES = 3

/** A statement bubble shorter than this rides along with its neighbour instead
 *  of standing alone. Kept low so genuine short greetings ("Hello po!", "Sige
 *  po.") still get their own bubble — only ultra-short interjections ("Ok.",
 *  "Oo.") are too small to stand alone. */
const DEFAULT_MIN_BUBBLE_CHARS = 5

export interface SegmentOptions {
  /** Hard ceiling on bubble count; trailing overflow merges into the last one. */
  maxBubbles?: number
  /** Minimum length for a standalone statement bubble. */
  minChars?: number
}

/** True when a sentence reads as a question the bot is asking the customer. */
function isQuestion(sentence: string): boolean {
  return sentence.trimEnd().endsWith('?')
}

/**
 * Break `text` into sentences, preserving terminal punctuation and treating a
 * newline as a hard sentence boundary. Whitespace between sentences is dropped.
 */
function toSentences(text: string): string[] {
  const sentences: string[] = []
  // Split on a run of whitespace that follows a sentence terminator, OR on any
  // newline. The capturing lookbehind-free approach: walk with a regex that
  // matches up to and including the terminator/newline.
  const re = /[^\n]*?(?:[.!?…]+(?=\s|$)|\n|$)/g
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const piece = m[0].trim()
    if (piece) sentences.push(piece)
    // Guard against zero-width matches at end-of-string looping forever.
    if (m.index === re.lastIndex) re.lastIndex++
    if (re.lastIndex > text.length) break
  }
  return sentences
}

/**
 * Group sentences into bubbles: accumulate statements, and whenever a question
 * appears, flush the accumulated statements as one bubble and emit the question
 * as its own bubble.
 */
function groupIntoBubbles(sentences: string[]): string[] {
  const bubbles: string[] = []
  let buffer: string[] = []
  const flush = () => {
    if (buffer.length) {
      bubbles.push(buffer.join(' '))
      buffer = []
    }
  }
  for (const s of sentences) {
    if (isQuestion(s)) {
      flush()
      bubbles.push(s)
    } else {
      buffer.push(s)
    }
  }
  flush()
  return bubbles
}

/**
 * Merge any statement bubble shorter than `minChars` into an adjacent bubble so
 * a tiny "Ok."-style fragment never spams as its own message. Questions are
 * left intact (a short question like "Ano po?" is a legitimate standalone).
 */
function mergeShortBubbles(bubbles: string[], minChars: number): string[] {
  const out: string[] = []
  // A too-short LEADING statement has no previous bubble to fold into, so it
  // waits here and folds into the NEXT bubble instead.
  let pendingLead: string | null = null
  for (const bubble of bubbles) {
    if (pendingLead !== null) {
      out.push(`${pendingLead} ${bubble}`)
      pendingLead = null
      continue
    }
    const tooShort = bubble.length < minChars && !isQuestion(bubble)
    if (!tooShort) {
      out.push(bubble)
    } else if (out.length > 0) {
      out[out.length - 1] = `${out[out.length - 1]} ${bubble}`
    } else {
      pendingLead = bubble
    }
  }
  // The only bubble was itself too short — keep it rather than drop it.
  if (pendingLead !== null) out.push(pendingLead)
  return out
}

/** Collapse bubbles beyond `maxBubbles` into the last allowed bubble. */
function capBubbles(bubbles: string[], maxBubbles: number): string[] {
  if (bubbles.length <= maxBubbles) return bubbles
  const kept = bubbles.slice(0, maxBubbles - 1)
  const tail = bubbles.slice(maxBubbles - 1).join(' ')
  return [...kept, tail]
}

/**
 * Split `text` into an ordered list of human-like bubbles. Returns `[]` for
 * empty/whitespace input and `[trimmed]` when the reply is a single sentence or
 * has no question to break on.
 */
export function segmentReply(text: string, opts: SegmentOptions = {}): string[] {
  if (!text.trim()) return []
  const maxBubbles = opts.maxBubbles && opts.maxBubbles > 0 ? opts.maxBubbles : DEFAULT_SPLIT_MAX_BUBBLES
  const minChars = opts.minChars && opts.minChars > 0 ? opts.minChars : DEFAULT_MIN_BUBBLE_CHARS

  const sentences = toSentences(text)
  if (sentences.length <= 1) return [text.trim()]

  const grouped = groupIntoBubbles(sentences)
  const merged = mergeShortBubbles(grouped, minChars)
  const capped = capBubbles(merged, maxBubbles)
  return capped.filter((b) => b.trim().length > 0)
}
