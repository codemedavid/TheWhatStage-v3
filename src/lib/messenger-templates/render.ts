// Resolves an `agent_campaigns.template_variables` map into the array of
// body parameters expected by the Messenger Send API for a single lead.
//
// The map is keyed by 1-based variable index ("1", "2", ...) — matching the
// {{1}}, {{2}}, ... placeholders in the approved template body.
//
// Supported rule kinds:
//   { kind: 'static', text }        — same literal value for every recipient
//   { kind: 'lead_field', field }   — pulls from the lead row (currently
//                                     'name' or any key in custom_fields)

import type { TemplateButton } from './types'

export type VariableRule =
  | { kind: 'static'; text: string }
  | { kind: 'lead_field'; field: string }

export type VariableMap = Record<string, VariableRule>

export interface LeadForRender {
  name: string | null
  custom_fields: Record<string, unknown> | null
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
  return ''
}

// Find the first URL-type button on a template, returning its index (or -1).
// Used to pick a sensible default override target when an action page is
// attached and the user hasn't explicitly chosen a button index.
export function findFirstUrlButtonIndex(buttons: TemplateButton[]): number {
  return buttons.findIndex((b) => b.type === 'url')
}
