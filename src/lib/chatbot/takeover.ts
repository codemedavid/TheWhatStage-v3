/**
 * True iff the operator-takeover pause is still in effect for this thread.
 * Returns false for NULL, past timestamps, and malformed input — the bot
 * should reply normally in all those cases.
 */
export function isBotPaused(
  bot_paused_until: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!bot_paused_until) return false
  const ts = Date.parse(bot_paused_until)
  if (Number.isNaN(ts)) return false
  return ts > now.getTime()
}
