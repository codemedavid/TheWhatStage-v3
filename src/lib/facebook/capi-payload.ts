import { createHash } from 'node:crypto'

export function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

export function normalizeEmail(raw: string): string | null {
  const v = raw.trim().toLowerCase()
  return v.length > 0 ? v : null
}

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D+/g, '')
  return digits.length > 0 ? digits : null
}

export function splitName(raw: string): { first: string | null; last: string | null } {
  const trimmed = raw.trim()
  if (!trimmed) return { first: null, last: null }
  const idx = trimmed.search(/\s+/)
  if (idx === -1) return { first: trimmed.toLowerCase(), last: null }
  const first = trimmed.slice(0, idx).toLowerCase()
  const last = trimmed.slice(idx).trim().toLowerCase()
  return { first: first || null, last: last || null }
}

/**
 * Hash pre-normalised values. Pass values through normalizeEmail /
 * normalizePhone / splitName before calling this function.
 */
export function hashList(values: Array<string | null | undefined>): string[] | null {
  const out: string[] = []
  for (const v of values) {
    if (!v) continue
    const trimmed = v.trim()
    if (!trimmed) continue
    out.push(sha256(trimmed))
  }
  return out.length > 0 ? out : null
}

export interface BuildUserDataInput {
  fbPageId: string
  psid: string
  leadId: string | null
  leadName: string | null
  leadPhones: string[]
  leadEmails: string[]
  clientIp: string | null
  clientUserAgent: string | null
}

export interface UserData {
  page_id: string
  page_scoped_user_id: string
  em?: string[]
  ph?: string[]
  fn?: string[]
  ln?: string[]
  external_id?: string[]
  client_ip_address?: string
  client_user_agent?: string
}

export function buildUserData(input: BuildUserDataInput): UserData {
  const out: UserData = {
    page_id: input.fbPageId,
    page_scoped_user_id: input.psid,
  }

  const normalizedEmails = input.leadEmails
    .map((e) => normalizeEmail(e))
    .filter((v): v is string => v !== null)
  const em = hashList(normalizedEmails)
  if (em) out.em = em

  const normalizedPhones = input.leadPhones
    .map((p) => normalizePhone(p))
    .filter((v): v is string => v !== null)
  const ph = hashList(normalizedPhones)
  if (ph) out.ph = ph

  if (input.leadName) {
    const { first, last } = splitName(input.leadName)
    const fn = hashList([first])
    const ln = hashList([last])
    if (fn) out.fn = fn
    if (ln) out.ln = ln
  }

  if (input.leadId) {
    const ext = hashList([input.leadId])
    if (ext) out.external_id = ext
  }

  if (input.clientIp) out.client_ip_address = input.clientIp
  if (input.clientUserAgent) out.client_user_agent = input.clientUserAgent

  return out
}
