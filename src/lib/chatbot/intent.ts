export type ReplyIntent = 'smalltalk' | 'faq' | 'sales' | 'support' | 'other'

/**
 * Classify a raw user message into a ReplyIntent using keyword/pattern heuristics.
 * Pure, synchronous, no LLM calls, never throws, safe on empty or very long input.
 * Handles English and Tagalog/Taglish.
 *
 * Precedence when multiple categories match: support > sales > faq > smalltalk > other.
 * Support is checked before sales so an existing-order issue ("order ko po status?")
 * is not mislabelled as buying intent by the bare "order" keyword. This ordering is
 * routing-neutral (both sales and support keep the strong model) but keeps the label honest.
 */
export function classifyIntentHeuristic(message: string): ReplyIntent {
  // Normalize once: lowercase and trim
  const msg = message.toLowerCase().trim()

  // --- SUPPORT (existing order / issue) ---
  // English: status, refund, cancel, complaint
  // Tagalog/Taglish: order ko, booking ko, reklamo, hindi dumating, saan na
  const supportPatterns = [
    /order ko/,
    /booking ko/,
    /\bstatus\b/,
    /\brefund\b/,
    /\bcancel\b/,
    /\breklamo\b/,
    /hindi dumating/,
    /saan na/,
    /\bcomplaint\b/,
  ]
  if (supportPatterns.some((p) => p.test(msg))) return 'support'

  // --- SALES (buying intent) ---
  // English: book, order, buy, avail, reserve, interested, sign up
  // Tagalog/Taglish: kukunin, bibili, magkano lahat, magbayad, book na, kunin ko
  const salesPatterns = [
    /\bbook\b/,
    /\border\b/,
    /\bbuy\b/,
    /\bavail\b/,
    /\breserve\b/,
    /\binterested\b/,
    /\bsign[\s-]?up\b/,
    /\bkukunin\b/,
    /\bbibili\b/,
    /magkano lahat/,
    /\bmagbayad\b/,
    /book na/,
    /kunin ko/,
  ]
  if (salesPatterns.some((p) => p.test(msg))) return 'sales'

  // --- FAQ (informational question) ---
  // English: how, what, where, when, price, hours, location
  // Tagalog/Taglish: magkano, saan, kailan, anong oras, paano, may ... ba
  const faqPatterns = [
    /\bmagkano\b/,
    /\bsaan\b/,
    /\bkailan\b/,
    /anong oras/,
    /\bpaano\b/,
    /\bhow\b/,
    /\bwhat\b/,
    /\bwhere\b/,
    /\bwhen\b/,
    /\bprice\b/,
    /\bhours\b/,
    /\blocation\b/,
    /may .+ ba/,
  ]
  if (faqPatterns.some((p) => p.test(msg))) return 'faq'

  // --- SMALLTALK (greeting / closing / thanks) ---
  // English: hi, hello, hey, good morning/afternoon/evening, thanks, ok, okay
  // Tagalog/Taglish: kumusta, salamat, sige, g po
  const smalltalkPatterns = [
    /\bhi\b/,
    /\bhello\b/,
    /\bhey\b/,
    /\bkumusta\b/,
    /good morning/,
    /good afternoon/,
    /good evening/,
    /\bsalamat\b/,
    /\bthanks\b/,
    /\bthank you\b/,
    /\bok\b/,
    /\bokay\b/,
    /\bsige\b/,
    /\bg po\b/,
  ]
  if (smalltalkPatterns.some((p) => p.test(msg))) return 'smalltalk'

  // --- OTHER (default fallback) ---
  return 'other'
}

/**
 * Detect a "proceed / consent / defer-to-you" signal — the customer is telling
 * us to go ahead, to take care of it, or that they have already done their part
 * (e.g. info is on their page), WITHOUT necessarily filling a form. Examples:
 *   "Kayo na po bahala"               → you take care of it / go ahead
 *   "Check niyo na lang po page namin" → just use our page (and proceed)
 *   "sige, ituloy na natin"           → okay, let's continue
 *
 * Pure, synchronous, no LLM calls, never throws, safe on empty/long input,
 * case-insensitive, handles English and Tagalog/Taglish.
 *
 * This is a CHEAP PRE-GATE only: it biases and cross-checks the LLM's
 * authoritative `proceed_intent` (see classify.ts) and is never the sole
 * trigger for a chat-implied submission. Precision is favoured over recall —
 * the LLM handles the ambiguous long tail.
 */
export function hasProceedIntent(message: string): boolean {
  const msg = message.toLowerCase().trim()
  if (!msg) return false

  // Disengage / negation guard — an explicit "don't" or "no more" overrides any
  // proceed token in the same message ("wag na po ituloy", "ayaw ko na").
  const disengagePatterns = [
    /\bayaw\b/,
    /hindi na/,
    /\bdi na\b/,
    /\bwag\b/,
    /\bhuwag\b/,
    /\bcancel\b/,
    /not interested/,
  ]
  if (disengagePatterns.some((p) => p.test(msg))) return false

  // Defer-to-you: "bahala" paired with a 2nd-person pronoun. The pronoun guard
  // separates "kayo na bahala" (defer to us) from fatalistic "bahala na" (que
  // sera sera), which is NOT a proceed signal.
  if (/\bbahala\b/.test(msg) && /\b(?:kayo|ikaw|inyo|niyo|nyo)\b/.test(msg)) {
    return true
  }

  // "check / tingnan ... page namin" — they did their part; proceed from it.
  if (/\b(?:check|tingnan|tignan|tsignan)\b[^\n]{0,40}\bpage\s+(?:namin|namon|nmn)\b/.test(msg)) {
    return true
  }

  // Explicit proceed / continue / commit verbs.
  const proceedPatterns = [
    /\bproceed\b/,
    /\bituloy\b/,
    /\btuloy\s+na\b/,
    /\bpush\s+(?:na|po|natin|namin)\b/,
    /\bgo\s+ahead\b/,
    /\bgo\s+na\b/,
    /\btara\s+(?:na|po)\b/,
    /\bgame\s+(?:na|po|ako)\b/,
    /\bdeal\s+(?:na|po)\b/,
    /\btrust\b[^\n]{0,20}\b(?:inyo|niyo)\b/,
  ]
  return proceedPatterns.some((p) => p.test(msg))
}
