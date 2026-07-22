import { segmentReply } from './reply-segments'
import { splitStructuredLines } from './structured-lines'
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
 */
export function selectReplySegments(reply: string, settings: ReplyDeliverySettings): string[] {
  if (settings.structuredMessagesEnabled) {
    return settings.structuredMessageLayout === 'bubbles'
      ? splitStructuredLines(reply, { maxBubbles: settings.splitMaxBubbles })
      : [reply]
  }
  if (settings.splitMessagesEnabled) {
    return segmentReply(reply, { maxBubbles: settings.splitMaxBubbles })
  }
  return [reply]
}
