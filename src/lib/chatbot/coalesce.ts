/**
 * Coalesce a burst of inbound customer messages into a single customer "turn".
 *
 * When a customer fires several Messenger messages in quick succession, the
 * worker should answer ALL of them in one reply instead of one-reply-per-message
 * (which reads as robotic). This pure helper takes the inbound rows that make up
 * the current turn (everything since the last bot/operator outbound message) and
 * produces the combined text the LLM sees plus the id set the caller must exclude
 * from conversation history (so the same messages don't appear both as the
 * current turn AND as prior history).
 */

/** Maximum number of inbound messages folded into a single coalesced turn. A
 *  generous ceiling — beyond this we keep only the most recent messages so a
 *  pathological flood can't blow up the prompt. */
export const MAX_COALESCED_MESSAGES = 10

export interface CoalesceRow {
  id: string
  body: string | null
  created_at: string
}

export interface CoalesceResult {
  /** Non-empty message bodies joined by newlines, in chronological order. */
  combinedText: string
  /** Ids of every row in the kept window — excluded from history by the caller. */
  messageIds: string[]
}

/**
 * Combine inbound rows into one turn. Rows are sorted chronologically
 * (created_at, then id for ties), capped to the most recent
 * {@link MAX_COALESCED_MESSAGES}, and their trimmed non-empty bodies joined with
 * newlines. Empty/whitespace/null bodies contribute no text but their ids are
 * still returned so history exclusion stays exhaustive.
 */
export function coalesceInbound(rows: CoalesceRow[]): CoalesceResult {
  if (!rows.length) return { combinedText: '', messageIds: [] }

  const sorted = [...rows].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  // Over the cap → keep only the most recent window.
  const window =
    sorted.length > MAX_COALESCED_MESSAGES ? sorted.slice(-MAX_COALESCED_MESSAGES) : sorted

  const combinedText = window
    .map((r) => (r.body ?? '').trim())
    .filter((t) => t.length > 0)
    .join('\n')

  return { combinedText, messageIds: window.map((r) => r.id) }
}
