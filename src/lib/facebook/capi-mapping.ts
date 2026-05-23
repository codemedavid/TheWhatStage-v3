import type { ActionPageKind } from '@/lib/action-pages/kinds'

export const CAPI_STANDARD_EVENTS = [
  'Lead',
  'Schedule',
  'Purchase',
  'InitiateCheckout',
  'CompleteRegistration',
  'Contact',
  'Subscribe',
  'SubmitApplication',
  'AddToCart',
  'ViewContent',
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
      return outcome === 'submitted' ? 'Lead' : null
    case 'booking':
      return outcome === 'booked' ? 'Schedule' : null
    case 'qualification':
      return outcome === 'qualified' ? 'Lead' : null
    case 'sales':
      return outcome === 'submitted' ? (hasPayment ? 'Purchase' : 'InitiateCheckout') : null
    case 'catalog':
      return outcome === 'checked_out' ? (hasPayment ? 'Purchase' : 'InitiateCheckout') : null
    case 'realestate':
      if (outcome === 'inquiry_submitted') return 'Lead'
      if (outcome === 'viewing_booked') return 'Schedule'
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
