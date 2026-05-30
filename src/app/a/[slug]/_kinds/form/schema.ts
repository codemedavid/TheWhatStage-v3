import { z } from 'zod'

export const FIELD_KINDS = [
  'short_text',
  'long_text',
  'email',
  'phone',
  'number',
  'select',
  'checkbox',
  'radio',
] as const

export type FieldKind = (typeof FIELD_KINDS)[number]

export const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/

const fieldOptionSchema = z.object({
  label: z.string().min(1).max(120),
  value: z.string().min(1).max(120),
})

const headingBlockSchema = z.object({
  id: z.string(),
  type: z.literal('heading'),
  text: z.string().max(200).default(''),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
})

const descriptionBlockSchema = z.object({
  id: z.string(),
  type: z.literal('description'),
  text: z.string().max(2000).default(''),
})

const fieldBlockSchema = z.object({
  id: z.string(),
  type: z.literal('field'),
  key: z.string().regex(FIELD_KEY_RE),
  label: z.string().min(1).max(120),
  field_kind: z.enum(FIELD_KINDS),
  required: z.boolean().default(false),
  placeholder: z.string().max(200).optional(),
  options: z.array(fieldOptionSchema).optional(),
})

export const blockSchema = z.union([
  headingBlockSchema,
  descriptionBlockSchema,
  fieldBlockSchema,
])

/**
 * Accepts hex (`#rgb`/`#rrggbb`/`#rrggbbaa`) and simple `rgb()/rgba()` colors
 * and rejects anything carrying CSS-breakout payloads (`;`, `{`, `}`, `/*`,
 * `url(`, etc.). These values are interpolated into inline styles / color-mix(),
 * so an unsafe value must never reach the renderer.
 */
export function isSafeCssColor(value: string): boolean {
  if (/[;{}()]/.test(value)) {
    // Parens are only allowed in the explicit rgb()/rgba() forms checked below.
    if (!/^rgba?\([^;{}]*\)$/i.test(value)) return false
  }
  if (value.includes('/*') || value.includes('*/') || /url\(/i.test(value)) {
    return false
  }
  if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) {
    return true
  }
  if (
    /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i.test(
      value,
    )
  ) {
    return true
  }
  return false
}

// Permissive field that silently falls back to the default when an invalid or
// unsafe color is encountered, so the rest of the config still renders.
const safeColor = (def: string) =>
  z.string().refine(isSafeCssColor).catch(def).default(def)

export const themeSchema = z.object({
  background_color: safeColor('#ffffff'),
  accent_color: safeColor('#059669'),
  button_text_color: safeColor('#ffffff'),
})

export const brandingSchema = z.object({
  logo_url: z.string().url().optional(),
})

export const formConfigSchema = z.object({
  theme: themeSchema.default({
    background_color: '#ffffff',
    accent_color: '#059669',
    button_text_color: '#ffffff',
  }),
  branding: brandingSchema.default({}),
  blocks: z.array(blockSchema).default([]),
  submit_button_label: z.string().min(1).max(60).default('Submit'),
  success_message: z
    .string()
    .min(1)
    .max(400)
    .default('Thanks! We got your submission.'),
})

export type FormConfig = z.infer<typeof formConfigSchema>
export type FormBlock = z.infer<typeof blockSchema>
export type FieldBlock = z.infer<typeof fieldBlockSchema>
export type HeadingBlock = z.infer<typeof headingBlockSchema>
export type DescriptionBlock = z.infer<typeof descriptionBlockSchema>

export const DEFAULT_FORM_CONFIG: FormConfig = {
  theme: {
    background_color: '#ffffff',
    accent_color: '#059669',
    button_text_color: '#ffffff',
  },
  branding: {},
  blocks: [],
  submit_button_label: 'Submit',
  success_message: 'Thanks! We got your submission.',
}

export function parseFormConfig(input: unknown): FormConfig {
  const result = formConfigSchema.safeParse(input)
  if (result.success) return result.data
  return DEFAULT_FORM_CONFIG
}
