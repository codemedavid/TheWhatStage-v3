import type { ActionPageKind } from '@/lib/action-pages/kinds'

export interface VariableDef {
  path: string
  label: string
  sample: string
  group: string
}

const SHARED_BASE: VariableDef[] = [
  { path: 'fb.name', label: 'Facebook profile name', sample: 'Maria Santos', group: 'Facebook' },
  { path: 'lead.name', label: 'Lead name', sample: 'Maria Santos', group: 'Lead' },
  { path: 'lead.phone', label: 'Lead phone', sample: '+639171234567', group: 'Lead' },
  { path: 'lead.email', label: 'Lead email', sample: 'maria@example.com', group: 'Lead' },
  { path: 'page.title', label: 'Action page title', sample: 'Book a call', group: 'Page' },
  { path: 'page.url', label: 'Action page URL', sample: 'https://app.example.com/a/book-a-call', group: 'Page' },
]

const CUSTOMER: VariableDef[] = [
  { path: 'customer.name', label: 'Customer name', sample: 'Maria Santos', group: 'Customer' },
  { path: 'customer.phone', label: 'Customer phone', sample: '+639171234567', group: 'Customer' },
  { path: 'customer.email', label: 'Customer email', sample: 'maria@example.com', group: 'Customer' },
  { path: 'customer.notes', label: 'Customer notes', sample: 'Please call before delivery', group: 'Customer' },
]

const BOOKING: VariableDef[] = [
  { path: 'booking.date', label: 'Booking date', sample: 'May 28, 2026', group: 'Booking' },
  { path: 'booking.time', label: 'Booking time', sample: '2:30 PM', group: 'Booking' },
  { path: 'booking.datetime', label: 'Booking date + time', sample: 'May 28, 2026 at 2:30 PM', group: 'Booking' },
  { path: 'booking.duration', label: 'Booking duration', sample: '30 min', group: 'Booking' },
]

const ORDER: VariableDef[] = [
  { path: 'order.items_lines', label: 'Order items (multi-line)', sample: '• 1x Heavy Duty Helmet — ₱2,500.00\n• 4x Flashlight — ₱1,200.00', group: 'Order' },
  { path: 'order.items', label: 'Order items (inline)', sample: '1x Heavy Duty Helmet, 4x Flashlight', group: 'Order' },
  { path: 'order.subtotal', label: 'Order subtotal', sample: '₱3,700.00', group: 'Order' },
  { path: 'order.total', label: 'Order total', sample: '₱3,700.00', group: 'Order' },
  { path: 'order.currency', label: 'Order currency', sample: 'PHP', group: 'Order' },
  { path: 'order.count', label: 'Number of items', sample: '5', group: 'Order' },
]

const PAYMENT: VariableDef[] = [
  { path: 'payment.method', label: 'Payment method', sample: 'GCash', group: 'Payment' },
  { path: 'payment.amount', label: 'Payment amount', sample: '₱3,700.00', group: 'Payment' },
  { path: 'payment.note', label: 'Payment note', sample: 'Ref: GC-12345', group: 'Payment' },
]

const PROPERTY: VariableDef[] = [
  { path: 'property.title', label: 'Property title', sample: 'Skyline Residences', group: 'Property' },
  { path: 'property.price', label: 'Property price', sample: '₱8,500,000', group: 'Property' },
  { path: 'property.address', label: 'Property address', sample: 'Bonifacio Global City, Taguig', group: 'Property' },
  { path: 'property.unit_title', label: 'Property unit', sample: 'Unit 12B', group: 'Property' },
]

const SALES: VariableDef[] = [
  { path: 'sales.product', label: 'Sales product name', sample: 'Pro Plan', group: 'Sales' },
  { path: 'sales.price', label: 'Sales price', sample: '₱999.00', group: 'Sales' },
]

export const VARIABLES_BY_KIND: Record<ActionPageKind, VariableDef[]> = {
  form: [...SHARED_BASE, ...CUSTOMER],
  booking: [...SHARED_BASE, ...CUSTOMER, ...BOOKING],
  qualification: [...SHARED_BASE],
  sales: [...SHARED_BASE, ...CUSTOMER, ...SALES, ...PAYMENT],
  catalog: [...SHARED_BASE, ...CUSTOMER, ...ORDER, ...PAYMENT],
  realestate: [...SHARED_BASE, ...CUSTOMER, ...PROPERTY],
}

const KINDS_WITH_CUSTOM: ReadonlySet<ActionPageKind> = new Set(['catalog', 'booking', 'realestate'])

export function knownPathsForKind(kind: ActionPageKind, customKeys: readonly string[]): Set<string> {
  const out = new Set(VARIABLES_BY_KIND[kind].map((v) => v.path))
  if (KINDS_WITH_CUSTOM.has(kind)) {
    for (const key of customKeys) out.add(`custom.${key}`)
  }
  return out
}

export function sampleContextForKind(
  kind: ActionPageKind,
  customKeys: readonly string[],
): Record<string, unknown> {
  const ctx: Record<string, unknown> = {}
  for (const v of VARIABLES_BY_KIND[kind]) {
    setPath(ctx, v.path, v.sample)
  }
  if (KINDS_WITH_CUSTOM.has(kind)) {
    const custom = (ctx.custom as Record<string, unknown>) ?? {}
    for (const key of customKeys) custom[key] = `[${key} sample]`
    if (customKeys.length > 0) ctx.custom = custom
  }
  return ctx
}

function setPath(ctx: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.')
  let cur: Record<string, unknown> = ctx
  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = segments[i]
    const existing = cur[seg]
    if (!existing || typeof existing !== 'object') {
      cur[seg] = {}
    }
    cur = cur[seg] as Record<string, unknown>
  }
  cur[segments[segments.length - 1]] = value
}
