import { createHash } from 'node:crypto'
import type { ActionPageKind } from '@/lib/action-pages/kinds'
import type { CapiStandardEvent } from './capi-mapping'

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
}

// Meta rejects client_ip_address / client_user_agent / event_source_url
// for action_source: "business_messaging" (error subcode 2804064), so
// they are intentionally absent from this shape.
export interface UserData {
  page_id: string
  page_scoped_user_id: string
  em?: string[]
  ph?: string[]
  fn?: string[]
  ln?: string[]
  external_id?: string[]
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

  return out
}

export interface CatalogOrderForCapi {
  subtotal: number
  currency: string
  lines: { business_item_id: string; quantity: number }[]
  paymentStatus: 'unpaid' | 'pending' | 'paid'
}

export interface BuildCustomDataInput {
  kind: ActionPageKind
  actionPageId: string
  parsedData: Record<string, unknown>
  pageConfig: Record<string, unknown>
  businessOrderId: string | null
  catalogOrder: CatalogOrderForCapi | null
  submissionId?: string
  hasPayment?: boolean
}

export interface CustomData {
  currency?: string
  value?: number
  content_ids?: string[]
  content_type?: 'product'
  num_items?: number
  order_id?: string
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}
function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export function buildCustomData(input: BuildCustomDataInput): CustomData {
  if (input.kind === 'catalog' && input.catalogOrder && input.businessOrderId) {
    const lines = input.catalogOrder.lines
    return {
      currency: input.catalogOrder.currency,
      value: input.catalogOrder.subtotal,
      content_ids: lines.map((l) => l.business_item_id),
      content_type: 'product',
      num_items: lines.reduce((s, l) => s + l.quantity, 0),
      order_id: input.businessOrderId,
    }
  }

  if (input.kind === 'sales' && input.hasPayment) {
    const cd: CustomData = {
      content_ids: [input.actionPageId],
      content_type: 'product',
    }
    const currency =
      asString(input.parsedData.payment_currency) ??
      asString((input.pageConfig.price as Record<string, unknown> | undefined)?.currency)
    const value = asNumber(input.parsedData.payment_amount)
    if (currency && value !== null) {
      cd.currency = currency
      cd.value = value
      if (input.submissionId) cd.order_id = input.submissionId
    }
    return cd
  }

  return {
    content_ids: [input.actionPageId],
    content_type: 'product',
  }
}

export interface CapiEvent {
  event_name: CapiStandardEvent
  event_time: number
  event_id: string
  action_source: 'business_messaging'
  messaging_channel: 'messenger'
  user_data: UserData
  custom_data?: CustomData
}

export interface BuildEnvelopeInput {
  eventName: CapiStandardEvent
  eventId: string
  eventTimeMs: number
  userData: UserData
  customData: CustomData | null
}

export function buildEventEnvelope(input: BuildEnvelopeInput): CapiEvent {
  const out: CapiEvent = {
    event_name: input.eventName,
    event_time: Math.floor(input.eventTimeMs / 1000),
    event_id: input.eventId,
    action_source: 'business_messaging',
    messaging_channel: 'messenger',
    user_data: input.userData,
  }
  if (input.customData) out.custom_data = input.customData
  return out
}
