/**
 * reply-guard.ts
 *
 * Self-contained anti-hallucination guard for chatbot replies.
 * Extracted from answer.ts so it can be imported without pulling in the full
 * RAG / Supabase / LLM dependency graph.
 *
 * No imports — fully self-contained module.
 */

/**
 * Find phone numbers, URLs, and email addresses in `reply` that do not appear
 * in `grounding`. Returns the offending strings so they can be logged.
 * Normalises phone formatting (strips spaces, dashes, parens) before
 * comparing so "0917-123-4567" matches "09171234567" in the knowledge base.
 */
export function findUngroundedContacts(reply: string, grounding: string): string[] {
  const normDigits = grounding.replace(/\D/g, '')
  const groundingLower = grounding.toLowerCase()
  const out: string[] = []

  // Phone numbers: 7+ digits, optional + and common separators.
  const phoneRe = /(?:\+?\d[\d\s\-().]{6,}\d)/g
  for (const m of reply.match(phoneRe) ?? []) {
    const digits = m.replace(/\D/g, '')
    if (digits.length >= 7 && !normDigits.includes(digits)) {
      out.push(m.trim())
    }
  }

  // URLs / bare domains. Skip obvious non-claims like "e.g." by requiring
  // a known TLD-ish tail and at least one dot.
  const urlRe = /\b(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}(?:\/[^\s),.;!?]*)?/gi
  for (const m of reply.match(urlRe) ?? []) {
    const host = m
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      .toLowerCase()
    // Ignore filename-looking matches (e.g. "file.json") with no real TLD.
    const tld = host.split('.').pop() ?? ''
    if (tld.length < 2) continue
    if (!groundingLower.includes(host)) {
      out.push(m)
    }
  }

  // Emails.
  const emailRe = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi
  for (const m of reply.match(emailRe) ?? []) {
    if (!groundingLower.includes(m.toLowerCase())) {
      out.push(m)
    }
  }

  return out
}

/**
 * Strip dashes the model leans on as a tell. " — " becomes ", ", a bare em/en
 * dash becomes a comma. Keeps regular ASCII hyphens untouched.
 */
export function sanitizeDashes(raw: string): string {
  return raw
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/,\s*,/g, ',')
    .trim()
}

/**
 * Run the full reply guard pipeline:
 * 1. Sanitize dashes in the reply text.
 * 2. Check for ungrounded contact details (phone, URL, email).
 * 3. If any ungrounded contacts are found, drop the reply and return the
 *    fallback message; otherwise return the sanitized text.
 *
 * Treats empty or undefined text safely — returns fallback only when
 * ungrounded contacts are detected, not on empty input.
 */
export function guardReply(args: {
  text: string
  grounding: string
  fallbackMessage: string
}): { text: string; dropped: boolean; ungrounded: string[] } {
  const raw = args.text ?? ''
  const sanitized = sanitizeDashes(raw)
  const ungrounded = findUngroundedContacts(sanitized, args.grounding)

  if (ungrounded.length > 0) {
    return { text: args.fallbackMessage, dropped: true, ungrounded }
  }

  return { text: sanitized, dropped: false, ungrounded: [] }
}
