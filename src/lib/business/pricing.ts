import type { PricingModel } from './types'

export function formatPrice(args: {
  amount: number | null
  currency: string
  pricingModel: PricingModel
}): string {
  if (args.pricingModel === 'free') return 'Free'
  if (args.pricingModel === 'quote') return 'Contact for price'
  if (args.amount === null) return 'Contact for price'
  const formatted = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: args.currency,
    maximumFractionDigits: 2,
  }).format(args.amount)
  return args.pricingModel === 'starts_at' ? `Starts at ${formatted}` : formatted
}

export function lineTotal(unitAmount: number, quantity: number): number {
  return Math.round(unitAmount * quantity * 100) / 100
}
