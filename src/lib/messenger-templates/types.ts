// Shared types for messenger utility templates.
// See supabase/migrations/20260518000000_messenger_message_templates.sql

export type TemplateButtonType = 'url' | 'postback' | 'phone_number'

export interface TemplateButton {
  type: TemplateButtonType
  text: string
  url?: string
  payload?: string
  phone_number?: string
}

export interface TemplateHeader {
  type: 'text'
  text: string
}

export type TemplateMetaStatus =
  | 'draft'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'disabled'

export interface MessengerMessageTemplate {
  id: string
  user_id: string
  page_id: string | null
  name: string
  display_name: string
  category: 'utility'
  language: string
  body_text: string
  variable_count: number
  sample_values: string[]
  buttons: TemplateButton[]
  header: TemplateHeader | null
  footer: string | null
  meta_template_id: string | null
  meta_status: TemplateMetaStatus
  meta_rejection_reason: string | null
  submitted_at: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

export interface TemplateFormInput {
  name: string
  display_name: string
  language?: string
  body_text: string
  sample_values?: string[]
  buttons?: TemplateButton[]
  header?: TemplateHeader | null
  footer?: string | null
  page_id?: string | null
}

// Counts {{1}}, {{2}}, ... placeholders. Returns the highest index seen,
// since Meta requires sample values to cover every slot up to the max.
export function countVariables(body: string): number {
  const matches = body.matchAll(/\{\{(\d+)\}\}/g)
  let max = 0
  for (const m of matches) {
    const idx = Number(m[1])
    if (Number.isFinite(idx) && idx > max) max = idx
  }
  return max
}

// Renders a template body by substituting {{1}}..{{N}} with the provided
// values. Missing values are left as the original placeholder so the caller
// can detect under-fill.
export function renderTemplate(body: string, values: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (whole, n) => {
    const idx = Number(n) - 1
    return values[idx] ?? whole
  })
}

// Meta accepts only [a-z0-9_]+ for template names; we pre-validate so the
// dashboard rejects bad names before a submit.
export function isValidTemplateName(name: string): boolean {
  return /^[a-z0-9_]{1,64}$/.test(name)
}

export function validateButtons(buttons: TemplateButton[]): string | null {
  if (buttons.length > 3) return 'A template can have at most 3 buttons.'
  for (const b of buttons) {
    if (!b.text?.trim()) return 'Every button needs a label.'
    if (b.text.length > 20) return 'Button labels must be 20 characters or fewer.'
    if (b.type === 'url' && !b.url?.trim()) return 'URL buttons require a URL.'
    if (b.type === 'postback' && !b.payload?.trim()) {
      return 'Postback buttons require a payload.'
    }
    if (b.type === 'phone_number' && !b.phone_number?.trim()) {
      return 'Phone buttons require a phone number.'
    }
  }
  return null
}

export interface TemplateCategory {
  id: string
  slug: string
  label: string
  is_system: boolean
  sort_order: number
}

export interface MessengerMessageTemplateWithCategories extends MessengerMessageTemplate {
  categories: TemplateCategory[]
}
