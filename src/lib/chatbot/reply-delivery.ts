import { segmentReply } from './reply-segments'
import { breakInlineEnumeration, splitStructuredLines } from './structured-lines'
import type { StructuredMessageLayout } from './config'

/** The subset of chatbot config that governs how a reply is delivered. */
export interface ReplyDeliverySettings {
  structuredMessagesEnabled: boolean
  structuredMessageLayout: StructuredMessageLayout
  splitMessagesEnabled: boolean
  splitMaxBubbles: number
}

/**
 * Decide how a single generated reply is delivered to the customer, returning
 * the ordered list of message segments (bubbles) to send.
 *
 * Precedence: structured mode wins over the human-split toggle when both are on.
 *   - structured + 'single'  -> [reply] (one message, the model's line breaks kept)
 *   - structured + 'bubbles' -> one bubble per structured line
 *   - split-messages on      -> human-like sentence-based bubbles
 *   - otherwise              -> [reply] (unchanged legacy single-bubble behaviour)
 *
 * Each splitter returns a single-element array for a one-line/one-sentence
 * reply, so short replies stay as one bubble in every mode.
 *
 * In EVERY mode the reply first passes through breakInlineEnumeration: when the
 * model runs an "A) x B) y C) z" option list into one flat line, the options are
 * broken onto their own lines (and "X)" markers rewritten to "X." so Messenger
 * doesn't emoticon-convert "B)" into 😎) before any layout decision applies.
 * Callers sending a single segment should send segments[0], not the raw reply.
 */
export function selectReplySegments(reply: string, settings: ReplyDeliverySettings): string[] {
  const normalized = breakInlineEnumeration(reply)
  if (settings.structuredMessagesEnabled) {
    return settings.structuredMessageLayout === 'bubbles'
      ? splitStructuredLines(normalized, { maxBubbles: settings.splitMaxBubbles })
      : [normalized]
  }
  if (settings.splitMessagesEnabled) {
    return segmentReply(normalized, { maxBubbles: settings.splitMaxBubbles })
  }
  return [normalized]
}
