import { z } from 'zod'

export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/)
export const BusinessItemStatusSchema = z.enum(['draft', 'published', 'archived'])
export const PricingModelSchema = z.enum(['fixed', 'starts_at', 'quote', 'free'])
export const InventoryStatusSchema = z.enum([
  'in_stock',
  'limited',
  'out_of_stock',
  'preorder',
  'not_tracked',
])

export const ProductDetailsSchema = z.object({
  features: z.array(z.string().trim().min(1).max(160)).max(30).default([]),
  specifications: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        value: z.string().trim().min(1).max(160),
      }),
    )
    .max(40)
    .default([]),
  included: z.array(z.string().trim().min(1).max(160)).max(30).default([]),
  availability_note: z.string().trim().max(240).nullable().default(null),
})

export const ProductRecommendationHintsSchema = z.object({
  budget_min: z.coerce.number().nonnegative().nullable().default(null),
  budget_max: z.coerce.number().nonnegative().nullable().default(null),
  desired_results: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  best_for: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  not_for: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  keywords: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
})

export const ProductFormInput = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(160),
    slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,79}$/),
    status: BusinessItemStatusSchema,
    summary: z.string().trim().max(280).nullable().default(null),
    description: z.string().trim().max(8000).nullable().default(null),
    price_amount: z.coerce.number().nonnegative().nullable().default(null),
    compare_at_amount: z.coerce.number().nonnegative().nullable().default(null),
    currency: CurrencyCode.default('PHP'),
    pricing_model: PricingModelSchema.default('fixed'),
    sku: z.string().trim().max(80).nullable().default(null),
    inventory_status: InventoryStatusSchema.default('not_tracked'),
    tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
    details: ProductDetailsSchema.default({
      features: [],
      specifications: [],
      included: [],
      availability_note: null,
    }),
    recommendation_hints: ProductRecommendationHintsSchema.default({
      budget_min: null,
      budget_max: null,
      desired_results: [],
      best_for: [],
      not_for: [],
      keywords: [],
    }),
    rag_enabled: z.boolean().default(true),
  })
  .superRefine((input, ctx) => {
    if (input.status !== 'published') return

    if (!input.summary && !input.description) {
      ctx.addIssue({
        code: 'custom',
        path: ['summary'],
        message: 'Published products require a summary or description.',
      })
    }

    if (
      (input.pricing_model === 'fixed' || input.pricing_model === 'starts_at') &&
      (input.price_amount === null || input.price_amount <= 0)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['price_amount'],
        message: 'Published fixed-price products require a positive price.',
      })
    }
  })

export type ProductFormInput = z.infer<typeof ProductFormInput>
