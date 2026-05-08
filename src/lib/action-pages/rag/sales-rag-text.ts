import type { SalesConfig } from '@/app/a/[slug]/_kinds/sales/schema'

const PRODUCT_TYPE_LABEL: Record<string, string> = {
  digital: 'Digital product',
  physical: 'Physical product',
  service: 'Service',
  course: 'Online course',
  other: 'Product',
}

const PERIOD_LABEL: Record<string, string> = {
  one_time: 'one-time',
  monthly: '/month',
  yearly: '/year',
}

function formatPrice(amount: number | null, currency: string, displayLabel: string, period: string | null): string {
  if (displayLabel.trim()) return displayLabel.trim()
  if (amount == null) return ''
  const price = `${currency} ${amount.toLocaleString('en-PH', { minimumFractionDigits: 0 })}`
  const suffix = period ? ` ${PERIOD_LABEL[period] ?? period}` : ''
  return `${price}${suffix}`
}

export function buildSalesRagText(config: SalesConfig): string {
  const { product, price, features, faqs, guarantee, delivery } = config
  const lines: string[] = []

  const typeLabel = PRODUCT_TYPE_LABEL[product.type] ?? 'Product'
  lines.push(`Type: ${typeLabel}`)

  if (product.headline.trim()) lines.push(`Headline: ${product.headline.trim()}`)
  if (product.tagline.trim()) lines.push(`Tagline: ${product.tagline.trim()}`)

  const priceStr = formatPrice(price.amount, price.currency, price.display_label, price.period)
  if (priceStr) lines.push(`Price: ${priceStr}`)
  if (price.compare_at_amount != null && price.compare_at_amount > 0 && price.amount != null) {
    lines.push(`Original price: ${price.currency} ${price.compare_at_amount.toLocaleString('en-PH')}`)
  }

  const deliveryLabel: Record<string, string> = {
    instant_download: 'Instant download',
    email: 'Delivered by email',
    shipped: 'Shipped',
    scheduled: 'Scheduled',
    manual: 'Manual delivery',
  }
  if (delivery.type) {
    const dLabel = deliveryLabel[delivery.type] ?? delivery.type
    lines.push(`Delivery: ${dLabel}${delivery.notes.trim() ? ` — ${delivery.notes.trim()}` : ''}`)
  }

  if (product.description.trim()) {
    lines.push('')
    lines.push(product.description.trim())
  }

  const activeFeatures = features.filter((f) => f.title.trim())
  if (activeFeatures.length) {
    lines.push('')
    lines.push('Features:')
    for (const f of activeFeatures) {
      lines.push(`- ${f.title.trim()}${f.body.trim() ? `: ${f.body.trim()}` : ''}`)
    }
  }

  if (guarantee.enabled && guarantee.title.trim()) {
    lines.push('')
    lines.push(`Guarantee: ${guarantee.title.trim()}${guarantee.body.trim() ? ` — ${guarantee.body.trim()}` : ''}`)
  }

  const activeFaqs = faqs.filter((f) => f.question.trim() && f.answer.trim())
  if (activeFaqs.length) {
    lines.push('')
    lines.push('FAQs:')
    for (const f of activeFaqs) {
      lines.push(`Q: ${f.question.trim()}`)
      lines.push(`A: ${f.answer.trim()}`)
    }
  }

  return lines.join('\n').trim()
}
