import type { RealestateProperty } from '@/app/a/[slug]/_kinds/realestate/schema'

const STATUS_LABEL: Record<string, string> = {
  for_sale: 'For Sale',
  for_rent: 'For Rent',
  sold: 'Sold',
  reserved: 'Reserved',
  draft: 'Draft',
}

const PROPERTY_TYPE_LABEL: Record<string, string> = {
  house: 'House',
  condo: 'Condo',
  townhouse: 'Townhouse',
  lot: 'Lot',
  commercial: 'Commercial',
  other: 'Property',
}

function formatPrice(amount: number | null, currency: string, displayLabel: string): string {
  if (displayLabel.trim()) return displayLabel.trim()
  if (amount == null) return ''
  return `${currency} ${amount.toLocaleString('en-PH', { minimumFractionDigits: 0 })}`
}

function formatArea(value: number, unit: string): string {
  return `${value.toLocaleString('en-PH')} ${unit}`
}

export function buildPropertyRagText(p: RealestateProperty): string {
  const lines: string[] = []

  const statusLabel = STATUS_LABEL[p.status] ?? p.status
  const typeLabel = p.specs.property_type ? PROPERTY_TYPE_LABEL[p.specs.property_type] ?? 'Property' : 'Property'

  // Location + status line
  const locationParts: string[] = []
  if (p.address.city) locationParts.push(p.address.city)
  if (p.address.region) locationParts.push(p.address.region)
  if (p.address.country && !['Philippines', 'PH'].includes(p.address.country)) locationParts.push(p.address.country)
  const location = locationParts.join(', ')

  const metaParts: string[] = [`Status: ${statusLabel}`, `Type: ${typeLabel}`]
  if (location) metaParts.push(`Location: ${location}`)
  lines.push(metaParts.join(' · '))

  // Price
  const priceStr = formatPrice(p.price.amount, p.price.currency, p.price.display_label)
  if (priceStr) {
    const priceLabel = p.price.period === 'monthly' ? `${priceStr}/month` : p.price.period === 'yearly' ? `${priceStr}/year` : priceStr
    lines.push(`Price: ${priceLabel}`)
  }

  // Address
  const addrParts: string[] = []
  if (p.address.line1) addrParts.push(p.address.line1)
  if (p.address.line2) addrParts.push(p.address.line2)
  if (location) addrParts.push(location)
  if (p.address.postal) addrParts.push(p.address.postal)
  if (addrParts.length) lines.push(`Address: ${addrParts.join(', ')}`)

  // Specs
  const specParts: string[] = []
  if (p.specs.beds != null) specParts.push(`${p.specs.beds} bedroom${p.specs.beds !== 1 ? 's' : ''}`)
  if (p.specs.baths != null) specParts.push(`${p.specs.baths} bathroom${p.specs.baths !== 1 ? 's' : ''}`)
  if (p.specs.floor_area) specParts.push(`${formatArea(p.specs.floor_area.value, p.specs.floor_area.unit)} floor area`)
  if (p.specs.lot_area) specParts.push(`${formatArea(p.specs.lot_area.value, p.specs.lot_area.unit)} lot`)
  if (p.specs.parking != null && p.specs.parking > 0) specParts.push(`${p.specs.parking} parking slot${p.specs.parking !== 1 ? 's' : ''}`)
  if (p.specs.year_built != null) specParts.push(`built ${p.specs.year_built}`)
  if (specParts.length) lines.push(`Specs: ${specParts.join(' · ')}`)

  // Custom specs
  for (const cs of p.custom_specs) {
    if (cs.label && cs.value) lines.push(`${cs.label}: ${cs.value}`)
  }

  // Description
  if (p.description.trim()) {
    lines.push('')
    lines.push(p.description.trim())
  }

  // Amenities
  const amenities = p.amenities.filter(Boolean)
  if (amenities.length) {
    lines.push('')
    lines.push(`Amenities: ${amenities.join(', ')}`)
  }

  // Financing
  const finOpts = p.financing_options.filter((f) => f.label)
  if (finOpts.length || p.financing_notes.trim()) {
    lines.push('')
    lines.push('Financing options:')
    for (const f of finOpts) {
      const parts: string[] = [f.label]
      if (f.down_payment_amount != null) parts.push(`DP ${f.currency} ${f.down_payment_amount.toLocaleString('en-PH')}`)
      else if (f.down_payment_percent != null) parts.push(`DP ${f.down_payment_percent}%`)
      if (f.term_months != null) parts.push(`${f.term_months} months`)
      if (f.monthly_amount != null) parts.push(`${f.currency} ${f.monthly_amount.toLocaleString('en-PH')}/mo`)
      if (f.notes.trim()) parts.push(f.notes.trim())
      lines.push(`- ${parts.join(' · ')}`)
    }
    if (p.financing_notes.trim()) lines.push(p.financing_notes.trim())
  }

  return lines.join('\n').trim()
}

/**
 * Derive a stable business_item slug from a property's local ID.
 * Property IDs are `prop_{uuid}` — strip the prefix and prepend `p-`.
 */
export function propertySlug(propertyId: string): string {
  const bare = propertyId.replace(/^prop_/, '')
  // bare is a UUID (36 chars) or random alphanumeric — both valid slug chars
  return `p-${bare}`.slice(0, 80)
}
