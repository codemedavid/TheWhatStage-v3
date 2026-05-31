import { z } from 'zod'

/**
 * Accepts hex (`#rgb`/`#rrggbb`/`#rrggbbaa`) and simple `rgb()/rgba()` colors
 * and rejects anything carrying CSS-breakout payloads (`;`, `{`, `}`, `/*`,
 * `url(`, etc.). Theme colors are interpolated into inline styles / color-mix(),
 * so an unsafe value must never reach the renderer.
 */
function isSafeCssColor(value: string): boolean {
  if (/[;{}()]/.test(value)) {
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

export const SalesThemeSchema = z.object({
  background_color: safeColor('#FFFFFF'),
  accent_color: safeColor('#059669'),
  button_text_color: safeColor('#FFFFFF'),
})

export const PRODUCT_TYPES = [
  'digital',
  'physical',
  'service',
  'course',
  'other',
] as const
export type ProductType = (typeof PRODUCT_TYPES)[number]

export const PRICE_PERIODS = ['one_time', 'monthly', 'yearly'] as const
export type PricePeriod = (typeof PRICE_PERIODS)[number]

export const DELIVERY_TYPES = [
  'instant_download',
  'email',
  'shipped',
  'scheduled',
  'manual',
] as const
export type DeliveryType = (typeof DELIVERY_TYPES)[number]

export const FALLBACK_FIELD_KEYS = [
  'full_name',
  'email',
  'phone',
  'message',
] as const
export type FallbackFieldKey = (typeof FALLBACK_FIELD_KEYS)[number]

export const SalesProductSchema = z.object({
  name: z.string().max(160).default(''),
  type: z.enum(PRODUCT_TYPES).default('digital'),
  headline: z.string().max(200).default(''),
  tagline: z.string().max(300).default(''),
  description: z.string().max(8000).default(''),
})

export const SalesPriceSchema = z.object({
  amount: z.number().nullable().default(null),
  currency: z.string().min(1).max(8).default('PHP'),
  compare_at_amount: z.number().nullable().default(null),
  display_label: z.string().max(80).default(''),
  period: z.enum(PRICE_PERIODS).nullable().default(null),
})

export const SalesGalleryItemSchema = z.object({
  id: z.string().min(1),
  fileId: z.string().min(1),
  url: z.string().url(),
  alt: z.string().max(200).default(''),
  position: z.number().int().min(0).default(0),
  primary: z.boolean().default(false),
})

export const SalesFeatureSchema = z.object({
  id: z.string().min(1),
  icon: z.string().max(8).default(''),
  title: z.string().max(120).default(''),
  body: z.string().max(500).default(''),
})

export const SalesBenefitSchema = z.object({
  id: z.string().min(1),
  text: z.string().max(200).default(''),
})

export const SalesTestimonialSchema = z.object({
  id: z.string().min(1),
  author: z.string().max(120).default(''),
  role: z.string().max(120).default(''),
  avatar_url: z.string().url().nullable().default(null),
  quote: z.string().max(800).default(''),
})

export const SalesFaqSchema = z.object({
  id: z.string().min(1),
  question: z.string().max(200).default(''),
  answer: z.string().max(2000).default(''),
})

export const SalesGuaranteeSchema = z.object({
  enabled: z.boolean().default(false),
  title: z.string().max(120).default(''),
  body: z.string().max(800).default(''),
})

export const SalesCtaSchema = z.object({
  primary_label: z.string().max(60).default('Get it now'),
  secondary_label: z.string().max(60).default(''),
  scroll_target: z.enum(['inline_form', 'top']).default('inline_form'),
})

export const SalesDeliverySchema = z.object({
  type: z.enum(DELIVERY_TYPES).default('email'),
  notes: z.string().max(1000).default(''),
})

export const SalesSocialProofSchema = z.object({
  id: z.string().min(1),
  stat_label: z.string().max(80).default(''),
  stat_value: z.string().max(40).default(''),
})

export const SalesFallbackFieldSchema = z.object({
  key: z.enum(FALLBACK_FIELD_KEYS),
  label: z.string().min(1).max(80),
  required: z.boolean().default(true),
  enabled: z.boolean().default(true),
})

export const SalesFallbackFormSchema = z.object({
  enabled: z.boolean().default(true),
  fields: z
    .array(SalesFallbackFieldSchema)
    .default([
      { key: 'full_name', label: 'Your name', required: true, enabled: true },
      { key: 'email', label: 'Email', required: true, enabled: true },
      { key: 'phone', label: 'Phone', required: false, enabled: true },
      { key: 'message', label: 'Message', required: false, enabled: false },
    ]),
  submit_button_label: z.string().max(40).default('Buy now'),
  success_message: z.string().max(400).default("Thanks! We'll be in touch shortly."),
})

export const SalesPaymentSchema = z.object({
  enabled: z.boolean().default(true),
  excluded_method_ids: z
    .array(z.unknown())
    .default([])
    .transform((arr) => arr.filter((x): x is string => typeof x === 'string' && x.length > 0)),
})

export const SalesConfigSchema = z.object({
  theme: SalesThemeSchema.default({
    background_color: '#FFFFFF',
    accent_color: '#059669',
    button_text_color: '#FFFFFF',
  }),
  product: SalesProductSchema.default({
    name: '',
    type: 'digital',
    headline: '',
    tagline: '',
    description: '',
  }),
  price: SalesPriceSchema.default({
    amount: null,
    currency: 'PHP',
    compare_at_amount: null,
    display_label: '',
    period: null,
  }),
  gallery: z.array(SalesGalleryItemSchema).default([]),
  features: z.array(SalesFeatureSchema).default([]),
  benefits: z.array(SalesBenefitSchema).default([]),
  testimonials: z.array(SalesTestimonialSchema).default([]),
  faqs: z.array(SalesFaqSchema).default([]),
  guarantee: SalesGuaranteeSchema.default({
    enabled: false,
    title: '',
    body: '',
  }),
  cta: SalesCtaSchema.default({
    primary_label: 'Get it now',
    secondary_label: '',
    scroll_target: 'inline_form',
  }),
  delivery: SalesDeliverySchema.default({
    type: 'email',
    notes: '',
  }),
  social_proof: z.array(SalesSocialProofSchema).default([]),
  linked_action_page_ids: z.array(z.string().uuid()).default([]),
  payment: SalesPaymentSchema.default({
    enabled: true,
    excluded_method_ids: [],
  }),
  fallback_form: SalesFallbackFormSchema.default({
    enabled: true,
    fields: [
      { key: 'full_name', label: 'Your name', required: true, enabled: true },
      { key: 'email', label: 'Email', required: true, enabled: true },
      { key: 'phone', label: 'Phone', required: false, enabled: true },
      { key: 'message', label: 'Message', required: false, enabled: false },
    ],
    submit_button_label: 'Buy now',
    success_message: "Thanks! We'll be in touch shortly.",
  }),
})

export type SalesConfig = z.infer<typeof SalesConfigSchema>
export type SalesProduct = z.infer<typeof SalesProductSchema>
export type SalesPrice = z.infer<typeof SalesPriceSchema>
export type SalesGalleryItem = z.infer<typeof SalesGalleryItemSchema>
export type SalesFeature = z.infer<typeof SalesFeatureSchema>
export type SalesBenefit = z.infer<typeof SalesBenefitSchema>
export type SalesTestimonial = z.infer<typeof SalesTestimonialSchema>
export type SalesFaq = z.infer<typeof SalesFaqSchema>
export type SalesGuarantee = z.infer<typeof SalesGuaranteeSchema>
export type SalesCta = z.infer<typeof SalesCtaSchema>
export type SalesDelivery = z.infer<typeof SalesDeliverySchema>
export type SalesSocialProof = z.infer<typeof SalesSocialProofSchema>
export type SalesFallbackField = z.infer<typeof SalesFallbackFieldSchema>
export type SalesFallbackForm = z.infer<typeof SalesFallbackFormSchema>
export type SalesPayment = z.infer<typeof SalesPaymentSchema>

export function defaultSalesConfig(): SalesConfig {
  return SalesConfigSchema.parse({})
}

export function parseSalesConfig(input: unknown): SalesConfig {
  const result = SalesConfigSchema.safeParse(input ?? {})
  if (result.success) return result.data
  return defaultSalesConfig()
}
