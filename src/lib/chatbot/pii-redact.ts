/**
 * pii-redact.ts
 *
 * Pure, serverless-safe utility — no imports, no side-effects, no I/O.
 * Safe to call in Edge runtimes and Node.js alike.
 *
 * Masks PII (phone numbers and email addresses) in a string before the text
 * is forwarded to an LLM, replacing each match with a stable token so the
 * model cannot inadvertently learn or echo real contact details.
 *
 * Design notes
 * ─────────────
 * • Email regex mirrors `findUngroundedContacts` in answer.ts so the two
 *   layers stay in sync: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi
 *
 * • Phone regex also mirrors answer.ts — a leading optional '+', a digit,
 *   then 6+ characters that may be digits or common separators (space, dash,
 *   dot, parens), ending on a digit.  The *digit-count* threshold (7+) is
 *   then applied after stripping non-digit characters so that:
 *     - 4-6 digit short strings (prices like "1500", years like "2026",
 *       quantities) are NOT masked — they don't cross the 7-digit floor.
 *     - Real phone numbers (09171234567, +63 917 123 4567, (0917) 123 4567,
 *       0917-123-4567) ARE masked — all normalize to ≥7 digits.
 *
 * • The function is idempotent: the placeholder tokens '[email]' and '[phone]'
 *   do not match either regex, so running redactForLlm twice returns the same
 *   string as running it once.
 */

// Mirrors the email regex in answer.ts (findUngroundedContacts ~line 242).
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,24}/gi

// Mirrors the phone regex in answer.ts (findUngroundedContacts ~line 217).
// Captures: optional leading '+', a digit, 6+ digit-or-separator chars, a digit.
// The digit count is validated separately (must be ≥ 7 after stripping non-digits)
// to avoid masking short numbers like prices or years.
const PHONE_CANDIDATE_RE = /\+?\d[\d\s\-().]{6,}\d/g

/**
 * Replace email addresses and phone numbers in `text` with '[email]' and
 * '[phone]' respectively.
 *
 * @param text - Raw string that may contain PII.
 * @returns Redacted string, or '' when the input is falsy / not a string.
 */
export function redactForLlm(text: string): string {
  // Guard: never throw; return a safe empty string for bad inputs.
  if (typeof text !== 'string' || !text) return ''

  // 1. Mask email addresses.
  let result = text.replace(EMAIL_RE, '[email]')

  // 2. Mask phone-like sequences.
  //    We use a replacer function so we can apply the 7+ digit threshold
  //    AFTER a candidate has been matched by the structural regex.
  result = result.replace(PHONE_CANDIDATE_RE, (match) => {
    // Strip everything except digits to get the raw digit count.
    // Threshold: 7+ digits = phone number; fewer = price / year / quantity.
    const digits = match.replace(/\D/g, '')
    return digits.length >= 7 ? '[phone]' : match
  })

  return result
}
