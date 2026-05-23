import type { ActionPageKind } from '@/lib/action-pages/kinds'

// Event names accepted by Meta when action_source is "business_messaging".
// "Lead"/"Schedule"/"Contact"/etc. that work for action_source "website"
// are rejected here (error subcode 2804066). Source:
// https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging/
export const CAPI_STANDARD_EVENTS = [
  'Purchase',
  'LeadSubmitted',
  'InitiateCheckout',
  'AddToCart',
  'ViewContent',
  'OrderCreated',
  'OrderShipped',
  'OrderDelivered',
  'OrderCanceled',
  'OrderReturned',
  'CartAbandoned',
  'QualifiedLead',
  'RatingProvided',
  'ReviewProvided',
] as const

export type CapiStandardEvent = (typeof CAPI_STANDARD_EVENTS)[number]

export interface MappingInput {
  kind: ActionPageKind
  outcome: string
  hasPayment: boolean
  override: string | null
}

export type MappingResult =
  | { send: false; reason: 'outcome_skip' }
  | { send: true; eventName: CapiStandardEvent }

function defaultEventName(kind: ActionPageKind, outcome: string, hasPayment: boolean): CapiStandardEvent | null {
  switch (kind) {
    case 'form':
      return outcome === 'submitted' ? 'LeadSubmitted' : null
    case 'booking':
      // business_messaging has no "Schedule" event; a confirmed booking is
      // a high-intent lead.
      return outcome === 'booked' ? 'LeadSubmitted' : null
    case 'qualification':
      return outcome === 'qualified' ? 'QualifiedLead' : null
    case 'sales':
      return outcome === 'submitted' ? (hasPayment ? 'Purchase' : 'InitiateCheckout') : null
    case 'catalog':
      return outcome === 'checked_out' ? (hasPayment ? 'Purchase' : 'InitiateCheckout') : null
    case 'realestate':
      if (outcome === 'inquiry_submitted') return 'LeadSubmitted'
      if (outcome === 'viewing_booked') return 'LeadSubmitted'
      return null
    default:
      return null
  }
}

export function resolveEventName(input: MappingInput): MappingResult {
  const { kind, outcome, hasPayment, override } = input
  if (override === 'SKIP') return { send: false, reason: 'outcome_skip' }
  if (override && (CAPI_STANDARD_EVENTS as readonly string[]).includes(override)) {
    return { send: true, eventName: override as CapiStandardEvent }
  }
  const def = defaultEventName(kind, outcome, hasPayment)
  if (!def) return { send: false, reason: 'outcome_skip' }
  return { send: true, eventName: def }
}
