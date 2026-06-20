import type { SupabaseClient } from '@supabase/supabase-js'

// Matches common international phone formats (7–15 digits, optional +/separators).
// Requires at least one digit boundary on each side to avoid matching pure years
// or other numeric strings.
const PHONE_RE =
  /(?<![0-9])(\+?(?:\d[\s\-.()/]?){6,14}\d)(?![0-9])/g

// Standard email pattern.
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g

// Anchored single-value email check (non-global; safe for .test()).
const EMAIL_EXACT_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function extractPhones(text: string): string[] {
  const raw = text.match(PHONE_RE) ?? []
  return [...new Set(raw.map((p) => p.replace(/[\s\-.()/]/g, '').trim()).filter(Boolean))]
}

export function extractEmails(text: string): string[] {
  const raw = text.match(EMAIL_RE) ?? []
  return [...new Set(raw.map((e) => e.toLowerCase().trim()).filter(Boolean))]
}

export type ContactSource = 'form' | 'booking' | 'catalog' | 'messenger' | 'manual'

// Field keys/labels that strongly imply a phone number even when the form
// builder set a generic field_kind (e.g. "number" or "short_text").
const PHONE_HINT_RE = /phone|mobile|contact|tel|whatsapp|viber|cellphone|cel|hp/i

// A value is treated as a phone when its digits form a plausible 7-15 digit
// number AND either the field hints at a phone or it matches a PH mobile shape.
function looksLikePhone(value: string, hinted: boolean): boolean {
  const digits = value.replace(/[^0-9]/g, '')
  if (digits.length < 7 || digits.length > 15) return false
  if (hinted) return true
  return /^(\+?63|0)9\d{9}$/.test(value.replace(/[^0-9+]/g, ''))
}

/**
 * Classify a single form/booking field value as a phone, email, or neither.
 * Mirrors the historical backfill: emails by pattern; phones by digit shape
 * combined with a field_kind/key/label hint, so phone fields configured as
 * "number" or "short_text" are still captured.
 */
function classifyFieldValue(
  value: string,
  fieldKind: string | undefined,
  key: string | undefined,
  label: string | undefined,
): 'phone' | 'email' | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (EMAIL_EXACT_RE.test(trimmed)) return 'email'
  if (fieldKind === 'email') return null
  const hinted =
    fieldKind === 'phone' ||
    fieldKind === 'number' ||
    fieldKind === 'tel' ||
    PHONE_HINT_RE.test(key ?? '') ||
    PHONE_HINT_RE.test(label ?? '')
  if (looksLikePhone(trimmed, hinted)) return 'phone'
  return null
}

/**
 * Atomically append contact values to a lead's phones/emails arrays and to the
 * normalized lead_contact_values table. Best-effort: logs but never throws.
 */
export async function appendLeadContacts(
  admin: SupabaseClient,
  leadId: string,
  contacts: { phones?: string[]; emails?: string[]; source?: ContactSource },
): Promise<void> {
  const phones = (contacts.phones ?? []).filter(Boolean)
  const emails = (contacts.emails ?? []).filter(Boolean)
  if (!phones.length && !emails.length) return

  const { error } = await admin.rpc('append_lead_contacts', {
    p_lead_id: leadId,
    p_phones: phones,
    p_emails: emails,
    p_source: contacts.source ?? 'manual',
  })
  if (error) {
    console.warn('[lead.contacts] append failed', { leadId, error: error.message })
  }
}

/**
 * Extract contacts from an action-page parsed submission and config.
 * Returns the phones/emails found, or empty arrays if none.
 */
export function extractContactsFromSubmission(
  kind: string,
  data: Record<string, unknown>,
  config: Record<string, unknown>,
): { phones: string[]; emails: string[] } {
  const phones: string[] = []
  const emails: string[] = []

  if (kind === 'form' || kind === 'booking') {
    const blocks =
      kind === 'form'
        ? ((config.blocks as Array<Record<string, unknown>> | undefined) ?? [])
        : (((config.form as Record<string, unknown> | undefined)
            ?.fields as Array<Record<string, unknown>> | undefined) ?? [])
    const fields = (data.fields as Record<string, unknown> | undefined) ?? {}
    for (const block of blocks) {
      // form uses block.type === 'field'; booking field defs have no type.
      if (kind === 'form' && block.type !== 'field') continue
      const key = block.key as string
      const value = typeof fields[key] === 'string' ? (fields[key] as string).trim() : ''
      if (!value) continue
      const classified = classifyFieldValue(
        value,
        block.field_kind as string | undefined,
        key,
        block.label as string | undefined,
      )
      if (classified === 'email') emails.push(value.toLowerCase())
      else if (classified === 'phone') phones.push(value)
    }
  } else if (kind === 'catalog') {
    const customer = (data.customer as Record<string, unknown> | undefined) ?? {}
    if (typeof customer.email === 'string' && customer.email.trim())
      emails.push(customer.email.trim().toLowerCase())
    if (typeof customer.phone === 'string' && customer.phone.trim())
      phones.push(customer.phone.trim())
  }

  return {
    phones: [...new Set(phones)],
    emails: [...new Set(emails)],
  }
}
