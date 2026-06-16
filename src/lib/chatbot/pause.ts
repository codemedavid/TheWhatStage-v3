/**
 * AI self-pause: the classifier may decide, per turn, that the bot should stop
 * replying and hand the conversation to a human — based on the user's
 * configured "# Auto-Pause Rules". These pure helpers keep that decision and
 * its timing logic unit-testable, separate from the supabase + LLM scaffolding.
 *
 * The pause itself reuses the existing human-takeover mechanism
 * (messenger_threads.bot_paused_until + chatbot_configs.human_takeover_minutes);
 * see {@link ./takeover}.
 */

/** Maximum stored length for the model-supplied pause reason. */
const MAX_REASON_LENGTH = 280

export interface PauseDecision {
  /** Short, human-readable reason for the handoff (which rule matched). */
  reason: string
}

/**
 * Validate the classifier's `pause` field. Strict on purpose: only an object
 * carrying a non-empty string `reason` counts as a pause. Everything else
 * (null, scalars, a bare `true`, a blank reason) returns null so a malformed
 * or hallucinated field never silently takes the bot offline.
 */
export function coercePauseDecision(raw: unknown): PauseDecision | null {
  if (!raw || typeof raw !== 'object') return null
  const reason = (raw as { reason?: unknown }).reason
  if (typeof reason !== 'string') return null
  const trimmed = reason.trim()
  if (!trimmed) return null
  return { reason: trimmed.slice(0, MAX_REASON_LENGTH) }
}

/**
 * Compute the `bot_paused_until` timestamp for an AI-initiated handoff.
 * Returns null when the duration is non-positive or non-finite — mirroring the
 * human-takeover semantics where `human_takeover_minutes = 0` disables pausing.
 */
export function computePauseUntil(now: Date, minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null
  return new Date(now.getTime() + minutes * 60_000).toISOString()
}
