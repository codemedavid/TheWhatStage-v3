export type BusinessItemKind = 'product' | 'property' | 'digital' | 'service'
export type BusinessItemStatus = 'draft' | 'published' | 'archived'
export type PricingModel = 'fixed' | 'starts_at' | 'quote' | 'free'
export type InventoryStatus =
  | 'in_stock'
  | 'limited'
  | 'out_of_stock'
  | 'preorder'
  | 'not_tracked'

export interface ProductDetails {
  features: string[]
  specifications: { name: string; value: string }[]
  included: string[]
  availability_note: string | null
}

export interface ProductRecommendationHints {
  budget_min: number | null
  budget_max: number | null
  desired_results: string[]
  best_for: string[]
  not_for: string[]
  keywords: string[]
}

export interface ProductRagInput {
  title: string
  summary: string | null
  description: string | null
  price_amount: number | null
  currency: string
  pricing_model: PricingModel
  details: unknown
  recommendation_hints: unknown
}
