// Resolves an `agent_campaigns.template_variables` map into the array of
// body parameters expected by the Messenger Send API for a single lead.
//
// Supported rule kinds:
//   { kind: 'static', text }           — same literal value for every recipient
//   { kind: 'lead_field', field }      — pulls from the lead row
//   { kind: 'booking_field', field }   — pulls from booking context
//   { kind: 'property_field', field }  — pulls from property context

import type { TemplateButton } from './types'

export type VariableRule =
  | { kind: 'static'; text: string }
  | { kind: 'lead_field'; field: string }
  | { kind: 'booking_field'; field: 'event_at' | 'event_at_relative' | 'title' }
  | { kind: 'property_field'; field: 'title' | 'address' | 'price' | 'deeplink_url' }

export type VariableMap = Record<string, VariableRule>

export interface BookingForRender {
  event_at: string
  event_at_relative: string
  title: string
}

export interface PropertyForRender {
  title: string
  address: string
  price: string
  deeplink_url: string
}

export interface LeadForRender {
  name: string | null
  custom_fields: Record<string, unknown> | null
  booking?: BookingForRender
  property?: PropertyForRender
}

export function renderTemplateVariables(
  variables: VariableMap,
  variableCount: number,
  lead: LeadForRender,
): string[] {
  const out: string[] = []
  for (let i = 1; i <= variableCount; i++) {
    const rule = variables[String(i)]
    out.push(resolveRule(rule, lead))
  }
  return out
}

function resolveRule(rule: VariableRule | undefined, lead: LeadForRender): string {
  if (!rule) return ''
  if (rule.kind === 'static') return rule.text ?? ''
  if (rule.kind === 'lead_field') {
    if (rule.field === 'name') return (lead.name ?? '').trim()
    const v = lead.custom_fields?.[rule.field]
    return typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v)
  }
  if (rule.kind === 'booking_field') {
    const b = lead.booking
    if (!b) return ''
    return b[rule.field] ?? ''
  }
  if (rule.kind === 'property_field') {
    const p = lead.property
    if (!p) return ''
    return p[rule.field] ?? ''
  }
  return ''
}

// Find the first URL-type button on a template, returning its index (or -1).
export function findFirstUrlButtonIndex(buttons: TemplateButton[]): number {
  return buttons.findIndex((b) => b.type === 'url')
}
