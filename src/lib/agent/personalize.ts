// Merge-tag personalization for bulk sends.
//
// A user composing a campaign writes `Hi [first_name], ...` once; every
// recipient gets their own name substituted at render time. Two rules matter
// more than anything else here:
//
//   1. A literal tag must never reach a customer. A lead with no name still
//      gets a readable greeting via NAME_FALLBACK.
//   2. Rendering must be idempotent and single-pass, so it is safe to run
//      again at send time as a backstop after the preview already rendered it.

export interface PersonalizeLead {
  name: string | null
  // Carried so callers can pass a lead row straight through. Custom fields are
  // deliberately NOT substitutable here — see the note on TAG_RE below.
  custom_fields?: Record<string, unknown> | null
}

export interface PersonalizeOptions {
  // Stands in for any name tag that resolves to nothing.
  fallback?: string
}

// Reads naturally in a greeting: "Hi there, ..." — the same word the AI
// drafter's own fallback template uses.
export const NAME_FALLBACK = 'there'

// Advertised in the composer UI. Order is the order shown to the user.
export const PERSONALIZATION_TAGS = [
  { tag: '[first_name]', label: 'First name', example: 'Juan' },
  { tag: '[name]', label: 'Full name', example: 'Juan Dela Cruz' },
  { tag: '[last_name]', label: 'Last name', example: 'Dela Cruz' },
] as const

// Any bracketed run of letters, digits, underscores, spaces or hyphens.
//
// Only the three documented name tags are ever substituted. Bracketed prose an
// operator writes — "ask about [budget]", "see the [notes] tab" — is left
// verbatim, deliberately: resolving arbitrary keys would let a stray bracket
// turn into internal CRM data and send different text to each customer with no
// warning. Template mode already has an explicit `lead_field` rule for that.
const TAG_RE = /\[\s*([a-z0-9_ -]+?)\s*\]/gi

const FULL_NAME_KEYS = new Set(['name', 'full_name', 'fullname'])
const FIRST_NAME_KEYS = new Set(['first_name', 'firstname', 'fname', 'given_name'])
const LAST_NAME_KEYS = new Set(['last_name', 'lastname', 'lname', 'surname', 'family_name'])

// "First Name", "first-name" and "firstname" all mean the same tag.
function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

function cleanName(name: string | null | undefined): string {
  return (name ?? '').trim().replace(/\s+/g, ' ')
}

export function firstNameOf(name: string | null | undefined): string {
  const cleaned = cleanName(name)
  if (!cleaned) return ''
  return cleaned.split(' ')[0]
}

export function lastNameOf(name: string | null | undefined): string {
  const cleaned = cleanName(name)
  if (!cleaned) return ''
  const parts = cleaned.split(' ')
  // A mononym is its own surname — "Mr. Madonna" beats "Mr. there".
  if (parts.length === 1) return parts[0]
  return parts.slice(1).join(' ')
}

/**
 * Replace every known merge tag in `text` with this lead's values.
 * Unknown bracket text is preserved verbatim.
 */
export function personalize(
  text: string,
  lead: PersonalizeLead,
  options: PersonalizeOptions = {},
): string {
  if (!text) return text
  const fallback = options.fallback ?? NAME_FALLBACK

  // One pass: a substituted value is never rescanned, so a lead literally
  // named "[first_name]" cannot cause a second substitution.
  return text.replace(TAG_RE, (match, rawKey: string) => {
    const key = normalizeKey(rawKey)

    if (FULL_NAME_KEYS.has(key)) return cleanName(lead.name) || fallback
    if (FIRST_NAME_KEYS.has(key)) return firstNameOf(lead.name) || fallback
    if (LAST_NAME_KEYS.has(key)) return lastNameOf(lead.name) || fallback

    return match
  })
}

/** True when `text` still holds a tag that `personalize` would substitute. */
export function hasPersonalizationTags(text: string): boolean {
  if (!text) return false
  TAG_RE.lastIndex = 0
  for (const match of text.matchAll(TAG_RE)) {
    const key = normalizeKey(match[1])
    if (FULL_NAME_KEYS.has(key) || FIRST_NAME_KEYS.has(key) || LAST_NAME_KEYS.has(key)) {
      return true
    }
  }
  return false
}
