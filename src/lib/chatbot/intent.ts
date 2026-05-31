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
