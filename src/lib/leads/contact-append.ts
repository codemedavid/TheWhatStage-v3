import type { SupabaseClient } from '@supabase/supabase-js'

// Matches common international phone formats (7–15 digits, optional +/separators).
// Requires at least one digit boundary on each side to avoid matching pure years
// or other numeric strings.
const PHONE_RE =
  /(?<![0-9])(\+?(?:\d[\s\-.()/]?){6,14}\d)(?![0-9])/g

// Standard email pattern.
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g

export function extractPhones(text: string): string[] {
  const raw = text.match(PHONE_RE) ?? []
  return [...new Set(raw.map((p) => p.replace(/[\s\-.()/]/g, '').trim()).filter(Boolean))]
}

export function extractEmails(text: string): string[] {
  const raw = text.match(EMAIL_RE) ?? []
  return [...new Set(raw.map((e) => e.toLowerCase().trim()).filter(Boolean))]
}

export type ContactSource = 'form' | 'booking' | 'catalog' | 'messenger' | 'manual'

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

  if (kind === 'form') {
    const blocks = (config.blocks as Array<Record<string, unknown>> | undefined) ?? []
    const fields = (data.fields as Record<string, unknown> | undefined) ?? {}
    for (const block of blocks) {
      if (block.type !== 'field') continue
      const key = block.key as string
      const fieldKind = block.field_kind as string
      const value = typeof fields[key] === 'string' ? (fields[key] as string).trim() : ''
      if (!value) continue
      if (fieldKind === 'email') emails.push(value.toLowerCase())
      else if (fieldKind === 'phone') phones.push(value)
    }
  } else if (kind === 'booking') {
    const formFields =
      ((config.form as Record<string, unknown> | undefined)
        ?.fields as Array<Record<string, unknown>> | undefined) ?? []
    const fields = (data.fields as Record<string, unknown> | undefined) ?? {}
    for (const fieldDef of formFields) {
      const key = fieldDef.key as string
      const fieldKind = fieldDef.field_kind as string
      const value = typeof fields[key] === 'string' ? (fields[key] as string).trim() : ''
      if (!value) continue
      if (fieldKind === 'email') emails.push(value.toLowerCase())
      else if (fieldKind === 'phone') phones.push(value)
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
