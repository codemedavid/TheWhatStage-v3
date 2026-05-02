import {
  ProductDetailsSchema,
  ProductRecommendationHintsSchema,
} from './schemas'
import type { ProductRagInput } from './types'

function addLine(lines: string[], label: string, value: unknown): void {
  if (typeof value === 'string' && value.trim()) lines.push(`${label}: ${value.trim()}`)
  if (typeof value === 'number') lines.push(`${label}: ${value}`)
}

function addList(lines: string[], label: string, values: string[]): void {
  const clean = values.map((v) => v.trim()).filter(Boolean)
  if (clean.length) lines.push(`${label}: ${clean.join(', ')}`)
}

export function buildProductRagText(input: ProductRagInput): string {
  const details = ProductDetailsSchema.parse(input.details ?? {})
  const hints = ProductRecommendationHintsSchema.parse(input.recommendation_hints ?? {})
  const lines: string[] = [`Product: ${input.title}`]

  addLine(lines, 'Summary', input.summary)
  addLine(lines, 'Description', input.description)

  if (input.pricing_model === 'quote') {
    lines.push('Price: Contact for price')
  } else if (input.pricing_model === 'free') {
    lines.push('Price: Free')
  } else if (input.price_amount !== null) {
    const prefix = input.pricing_model === 'starts_at' ? 'Starts at' : 'Price'
    lines.push(`${prefix}: ${input.currency} ${input.price_amount}`)
  }

  addList(lines, 'Features', details.features)
  addList(lines, 'Included', details.included)
  for (const spec of details.specifications) {
    lines.push(`${spec.name}: ${spec.value}`)
  }
  addLine(lines, 'Availability', details.availability_note)

  if (hints.budget_min !== null || hints.budget_max !== null) {
    lines.push(`Budget range: ${hints.budget_min ?? 0} to ${hints.budget_max ?? 'any'} ${input.currency}`)
  }
  addList(lines, 'Desired results', hints.desired_results)
  addList(lines, 'Best for', hints.best_for)
  addList(lines, 'Not for', hints.not_for)
  addList(lines, 'Keywords', hints.keywords)

  return lines.join('\n')
}
