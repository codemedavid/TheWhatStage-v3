import { z } from 'zod'

export const RealestateThemeSchema = z.object({
  background_color: z.string().default('#FFFFFF'),
  accent_color: z.string().default('#0F766E'),
  button_text_color: z.string().default('#FFFFFF'),
})

export const PROPERTY_STATUSES = [
  'for_sale',
  'for_rent',
  'sold',
  'reserved',
  'draft',
] as const

export const PROPERTY_TYPES = [
  'house',
  'condo',
  'townhouse',
  'lot',
  'commercial',
  'other',
] as const

export const RealestateAddressSchema = z.object({
  line1: z.string().max(160).default(''),
  line2: z.string().max(160).default(''),
  city: z.string().max(80).default(''),
  region: z.string().max(80).default(''),
  postal: z.string().max(20).default(''),
  country: z.string().max(80).default(''),
})

export const RealestateGalleryItemSchema = z.object({
  id: z.string().min(1),
  fileId: z.string().min(1),
  url: z.string().url(),
  alt: z.string().max(200).default(''),
  position: z.number().int().min(0).default(0),
  primary: z.boolean().default(false),
})

export const RealestatePriceSchema = z.object({
  amount: z.number().nullable().default(null),
  currency: z.string().min(1).max(8).default('PHP'),
  period: z.enum(['monthly', 'yearly']).nullable().default(null),
  display_label: z.string().max(80).default(''),
})

export const RealestateAreaSchema = z.object({
  value: z.number().nonnegative(),
  unit: z.enum(['sqm', 'sqft']).default('sqm'),
})

export const RealestateSpecsSchema = z.object({
  property_type: z.enum(PROPERTY_TYPES).nullable().default(null),
  beds: z.number().int().nonnegative().nullable().default(null),
  baths: z.number().nonnegative().nullable().default(null),
  floor_area: RealestateAreaSchema.nullable().default(null),
  lot_area: RealestateAreaSchema.nullable().default(null),
  year_built: z.number().int().nullable().default(null),
  parking: z.number().int().nonnegative().nullable().default(null),
})

export const RealestateCustomFieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(80),
  value: z.string().max(500).default(''),
})

export const RealestateFinancingOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(80),
  down_payment_amount: z.number().nullable().default(null),
  down_payment_percent: z.number().nullable().default(null),
  term_months: z.number().int().nullable().default(null),
  monthly_amount: z.number().nullable().default(null),
  currency: z.string().min(1).max(8).default('PHP'),
  notes: z.string().max(500).default(''),
})

/**
 * A single property within a realestate action page.
 * One realestate page can list multiple properties (catalog-style).
 */
export const RealestatePropertySchema = z.object({
  id: z.string().min(1),
  title: z.string().max(160).default(''),
  status: z.enum(PROPERTY_STATUSES).default('for_sale'),
  price: RealestatePriceSchema.default({
    amount: null,
    currency: 'PHP',
    period: null,
    display_label: '',
  }),
  gallery: z.array(RealestateGalleryItemSchema).default([]),
  address: RealestateAddressSchema.default({
    line1: '',
    line2: '',
    city: '',
    region: '',
    postal: '',
    country: '',
  }),
  description: z.string().max(8000).default(''),
  specs: RealestateSpecsSchema.default({
    property_type: null,
    beds: null,
    baths: null,
    floor_area: null,
    lot_area: null,
    year_built: null,
    parking: null,
  }),
  custom_specs: z.array(RealestateCustomFieldSchema).default([]),
  amenities: z.array(z.string().min(1).max(60)).default([]),
  financing_options: z.array(RealestateFinancingOptionSchema).default([]),
  financing_notes: z.string().max(4000).default(''),
})

export const RealestateBrandSchema = z.object({
  name: z.string().max(100).default(''),
  tagline: z.string().max(160).default(''),
  description: z.string().max(500).default(''),
  logo_url: z.string().max(500).default(''),
})

export const RealestateGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  property_ids: z.array(z.string()).default([]),
})

export const RealestateConfigSchema = z.object({
  theme: RealestateThemeSchema.default({
    background_color: '#FFFFFF',
    accent_color: '#0F766E',
    button_text_color: '#FFFFFF',
  }),
  brand: RealestateBrandSchema.default({
    name: '',
    tagline: '',
    description: '',
    logo_url: '',
  }),
  groups: z.array(RealestateGroupSchema).default([]),
  properties: z.array(RealestatePropertySchema).default([]),
  linked_action_page_ids: z.array(z.string().uuid()).default([]),
})

export type RealestateConfig = z.infer<typeof RealestateConfigSchema>
export type RealestateBrand = z.infer<typeof RealestateBrandSchema>
export type RealestateGroup = z.infer<typeof RealestateGroupSchema>
export type RealestateAddress = z.infer<typeof RealestateAddressSchema>
export type RealestateGalleryItem = z.infer<typeof RealestateGalleryItemSchema>
export type RealestateSpecs = z.infer<typeof RealestateSpecsSchema>
export type RealestateCustomField = z.infer<typeof RealestateCustomFieldSchema>
export type RealestateFinancingOption = z.infer<typeof RealestateFinancingOptionSchema>
export type RealestatePrice = z.infer<typeof RealestatePriceSchema>
export type RealestateProperty = z.infer<typeof RealestatePropertySchema>
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number]
export type PropertyType = (typeof PROPERTY_TYPES)[number]

function genId(prefix = 'prop'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`
}

export function defaultRealestateProperty(title = ''): RealestateProperty {
  return RealestatePropertySchema.parse({ id: genId(), title })
}

export function defaultRealestateConfig(): RealestateConfig {
  return RealestateConfigSchema.parse({})
}

/**
 * Parse config, transparently migrating the legacy single-property shape
 * (where status/price/gallery/address/etc lived at the root) into a
 * properties[] array with one entry.
 */
export function parseRealestateConfig(input: unknown): RealestateConfig {
  const raw = (input ?? {}) as Record<string, unknown>

  // If it's already in new shape (has `properties` array), parse directly.
  if (Array.isArray(raw.properties)) {
    const result = RealestateConfigSchema.safeParse(raw)
    if (result.success) return result.data
    return defaultRealestateConfig()
  }

  // Legacy single-property migration: wrap top-level fields into properties[0].
  const hasLegacyShape =
    'status' in raw ||
    'price' in raw ||
    'gallery' in raw ||
    'address' in raw ||
    'description' in raw ||
    'specs' in raw ||
    'amenities' in raw ||
    'financing_options' in raw

  if (!hasLegacyShape) {
    const result = RealestateConfigSchema.safeParse(raw)
    if (result.success) return result.data
    return defaultRealestateConfig()
  }

  const propertyCandidate = {
    id: genId(),
    title: '',
    status: raw.status,
    price: raw.price,
    gallery: raw.gallery,
    address: raw.address,
    description: raw.description,
    specs: raw.specs,
    custom_specs: raw.custom_specs,
    amenities: raw.amenities,
    financing_options: raw.financing_options,
    financing_notes: raw.financing_notes,
  }
  const propertyResult = RealestatePropertySchema.safeParse(propertyCandidate)
  const property = propertyResult.success
    ? propertyResult.data
    : defaultRealestateProperty()

  const migrated = {
    theme: raw.theme,
    properties: [property],
    linked_action_page_ids: raw.linked_action_page_ids,
  }
  const result = RealestateConfigSchema.safeParse(migrated)
  if (result.success) return result.data
  return defaultRealestateConfig()
}
