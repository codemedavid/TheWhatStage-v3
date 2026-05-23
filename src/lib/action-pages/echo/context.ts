import type { createAdminClient } from '@/lib/supabase/admin'
import type { ActionPageKind } from '@/lib/action-pages/kinds'
import type { ParsedSubmission } from '@/lib/action-pages/dispatch'
import {
  formatCurrency,
  formatDateInTz,
  formatDateTimeInTz,
  formatDurationMinutes,
  formatTimeInTz,
} from './format'
import { knownPathsForKind } from './variables'

type AdminClient = ReturnType<typeof createAdminClient>

export interface CatalogOrderLine {
  business_item_id: string
  title_snapshot: string
  quantity: number
  unit_amount: number
  line_total_amount: number
  currency: string
}

export interface CatalogOrderForContext {
  orderId: string
  lines: CatalogOrderLine[]
  subtotal: number
  currency: string
  customer: { name: string | null; phone: string | null; email: string | null; notes: string | null }
  customFields: Record<string, string>
  paymentStatus: 'unpaid' | 'pending' | 'paid'
}

export interface EchoPageRecord {
  id: string
  user_id: string
  kind: ActionPageKind
  slug: string
  config: Record<string, unknown>
  title?: string
  notification_template: { text?: string; echo_payment_proof?: boolean } | null
}

export interface BuildEchoContextArgs {
  admin: AdminClient
  page: EchoPageRecord
  parsed: ParsedSubmission
  catalogOrder?: CatalogOrderForContext | null
  leadId: string | null
  threadId: string | null
  psid: string | null
  fbPageId: string | null
}

export interface EchoContextResult {
  ctx: Record<string, unknown>
  known: Set<string>
  customKeys: string[]
}

const KINDS_WITH_CUSTOM: ReadonlySet<ActionPageKind> = new Set(['catalog', 'booking', 'realestate'])
const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')

export async function buildEchoContext(args: BuildEchoContextArgs): Promise<EchoContextResult> {
  const { admin, page, parsed, catalogOrder, leadId, threadId } = args

  const [lead, thread, paymentMethod] = await Promise.all([
    leadId ? loadLead(admin, leadId) : Promise.resolve(null),
    threadId ? loadThread(admin, threadId) : Promise.resolve(null),
    loadPaymentMethodFromParsed(admin, parsed),
  ])

  const customKeys = extractCustomKeys(page)
  const known = knownPathsForKind(page.kind, customKeys)

  const data = parsed.data as Record<string, unknown>
  const customerRaw = (data.customer as Record<string, unknown> | undefined) ?? {}
  const customer = {
    name: stringOrEmpty(customerRaw.name),
    phone: stringOrEmpty(customerRaw.phone),
    email: stringOrEmpty(customerRaw.email),
    notes: stringOrEmpty(customerRaw.notes),
  }

  const customMap: Record<string, string> = {}
  if (KINDS_WITH_CUSTOM.has(page.kind)) {
    const rawCustom = (customerRaw.custom as Record<string, unknown> | undefined) ?? {}
    const topLevel = (data.custom as Record<string, unknown> | undefined) ?? {}
    for (const key of customKeys) {
      const value = rawCustom[key] ?? topLevel[key]
      customMap[key] = stringOrEmpty(value)
    }
  }

  const ctx: Record<string, unknown> = {
    fb: { name: thread?.full_name ?? '' },
    lead: {
      name: lead?.name ?? '',
      phone: lead?.phone ?? '',
      email: lead?.email ?? '',
    },
    customer,
    page: {
      title: page.title ?? '',
      url: APP_URL ? `${APP_URL}/a/${page.slug}` : '',
    },
  }
  if (KINDS_WITH_CUSTOM.has(page.kind)) ctx.custom = customMap

  if (page.kind === 'booking') {
    const tz = pickBookingTimezone(page)
    const slotIso = stringOrEmpty(data.slot_iso)
    ctx.booking = {
      date: formatDateInTz(slotIso, tz),
      time: formatTimeInTz(slotIso, tz),
      datetime: formatDateTimeInTz(slotIso, tz),
      duration: formatDurationMinutes(pickBookingDuration(page)),
    }
  }

  if (page.kind === 'catalog' && catalogOrder) {
    const currency = catalogOrder.currency
    ctx.order = {
      items: catalogOrder.lines.map((l) => `${l.quantity}x ${l.title_snapshot}`).join(', '),
      items_lines: catalogOrder.lines
        .map((l) => `• ${l.quantity}x ${l.title_snapshot} — ${formatCurrency(l.line_total_amount, l.currency)}`)
        .join('\n'),
      subtotal: formatCurrency(catalogOrder.subtotal, currency),
      total: formatCurrency(catalogOrder.subtotal, currency),
      currency,
      count: String(catalogOrder.lines.reduce((s, l) => s + l.quantity, 0)),
    }
  }

  if (page.kind === 'sales') {
    const product = ((page.config.product as Record<string, unknown> | undefined) ?? {}).name
    const priceRaw = ((page.config.price as Record<string, unknown> | undefined) ?? {}).amount
    const currencyRaw = ((page.config.price as Record<string, unknown> | undefined) ?? {}).currency ?? 'PHP'
    ctx.sales = {
      product: stringOrEmpty(product),
      price: formatCurrency(toNumber(priceRaw), String(currencyRaw)),
    }
  }

  if (page.kind === 'realestate') {
    const addressRaw = (page.config.address as Record<string, unknown> | undefined) ?? {}
    const priceRaw = ((page.config.price as Record<string, unknown> | undefined) ?? {}).amount
    const currencyRaw = ((page.config.price as Record<string, unknown> | undefined) ?? {}).currency ?? 'PHP'
    ctx.property = {
      title: stringOrEmpty(page.title),
      price: formatCurrency(toNumber(priceRaw), String(currencyRaw)),
      address: composeAddress(addressRaw),
      unit_title: stringOrEmpty(data.source_property_unit_title),
    }
  }

  if (page.kind === 'catalog' || page.kind === 'sales') {
    const amount = toNumber(data.payment_amount)
    const currency = catalogOrder?.currency ?? 'PHP'
    ctx.payment = {
      method: paymentMethod?.label ?? '',
      amount: formatCurrency(amount, currency),
      note: stringOrEmpty(data.payment_note),
    }
  }

  return { ctx, known, customKeys }
}

async function loadLead(admin: AdminClient, leadId: string) {
  const { data } = await admin
    .from('leads')
    .select('id, name, email, phone')
    .eq('id', leadId)
    .maybeSingle<{ id: string; name: string | null; email: string | null; phone: string | null }>()
  return data
}

async function loadThread(admin: AdminClient, threadId: string) {
  const { data } = await admin
    .from('messenger_threads')
    .select('id, full_name')
    .eq('id', threadId)
    .maybeSingle<{ id: string; full_name: string | null }>()
  return data
}

async function loadPaymentMethodFromParsed(admin: AdminClient, parsed: ParsedSubmission) {
  const id = (parsed.data as Record<string, unknown>).payment_method_id
  if (typeof id !== 'string' || !id) return null
  const { data } = await admin
    .from('payment_methods')
    .select('id, label')
    .eq('id', id)
    .maybeSingle<{ id: string; label: string }>()
  return data
}

function extractCustomKeys(page: EchoPageRecord): string[] {
  if (page.kind === 'catalog') {
    const fields = (page.config.checkout_fields as Array<Record<string, unknown>> | undefined) ?? []
    return fields
      .map((f) => (typeof f.key === 'string' ? f.key : ''))
      .filter((k) => k.length > 0)
  }
  if (page.kind === 'booking') {
    const form = (page.config.form as Record<string, unknown> | undefined) ?? {}
    const fields = (form.fields as Array<Record<string, unknown>> | undefined) ?? []
    return fields
      .map((f) => (typeof f.key === 'string' ? f.key : ''))
      .filter((k) => k.length > 0)
  }
  return []
}

function pickBookingTimezone(page: EchoPageRecord): string {
  const appt = page.config.appointment as Record<string, unknown> | undefined
  const tz = appt && typeof appt.timezone === 'string' ? appt.timezone : 'Asia/Manila'
  return tz
}

function pickBookingDuration(page: EchoPageRecord): number | null {
  const appt = page.config.appointment as Record<string, unknown> | undefined
  if (!appt) return null
  const d = appt.duration_min
  return typeof d === 'number' ? d : null
}

function composeAddress(raw: Record<string, unknown>): string {
  const parts = ['line1', 'line2', 'city', 'region', 'postal', 'country']
    .map((k) => raw[k])
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
  return parts.join(', ')
}

function stringOrEmpty(v: unknown): string {
  if (v === undefined || v === null) return ''
  return String(v)
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
