import type { CommentDecision } from './classify'

/**
 * Detect short price / buying-intent comments that an LLM classifier often
 * misreads as `needs_no_action` because, stripped of business context, they
 * look like noise. The canonical case is "hm?" — Taglish shorthand for
 * "magkano / how much" — which previously got no reply and no DM.
 *
 * Pure, synchronous, never throws, safe on empty or very long input. English
 * and Tagalog/Taglish. Anchored on word boundaries so substrings (e.g. the
 * "pm" inside "3pm", the "hm" inside "rhythm") do not misfire.
 */
const INQUIRY_PATTERNS: readonly RegExp[] = [
  // "hm" / "hmm" / "hm po?" — shorthand for "how much"
  /\bh+m+\b/,
  // explicit price questions
  /\bmagkano\b/,
  /\bhow much\b/,
  /\bpresyo\b/,
  /\bprice\b/,
  /\bpricelist\b/,
  // private-message / buying / availability intent
  /\bpm\b/,
  /\binterested\b/,
  /\bavail\b/,
  /\bavailable\b/,
  /\bstocks?\b/,
  /\bin stock\b/,
  /\bcod\b/,
  /\border\b/,
  /\bumorder\b/,
  /\bhow to order\b/,
  /\bpaano\b/,
]

export function isPriceInquiry(message: string): boolean {
  const msg = message.toLowerCase().trim()
  if (!msg) return false
  return INQUIRY_PATTERNS.some((pattern) => pattern.test(msg))
}

const PRIVATE_REPLY_PLACEHOLDER = 'Hi! Sending you the details now 😊'
const PUBLIC_REPLY_PLACEHOLDER = 'Hi! We sent you a message with the details 😊'

/**
 * Guaranteed decision for a recognised price/buying inquiry. Both reply fields
 * are non-null placeholders: the RAG step replaces them with the real answer,
 * and the public placeholder keeps the public-reply fallback in
 * chooseGraphAction working when private replies are not permitted.
 */
export function priceInquiryDecision(): CommentDecision {
  return {
    category: 'question',
    confidence: 'high',
    publicReply: PUBLIC_REPLY_PLACEHOLDER,
    privateReply: PRIVATE_REPLY_PLACEHOLDER,
    moderationAction: 'private_reply',
    reason: 'Recognized price/buying inquiry (deterministic short-circuit)',
  }
}
