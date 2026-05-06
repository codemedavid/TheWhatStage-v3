import type { SupabaseClient } from '@supabase/supabase-js'
import { formatPrice } from './pricing'
import type { PricingModel } from './types'

export interface PublicProductCard {
  id: string
  title: string
  slug: string
  summary: string | null
  description: string | null
  price_amount: number | null
  currency: string
  pricing_model: PricingModel
  price_label: string
  inventory_status: string
  tags: string[]
  cover_image_url: string | null
}

interface CatalogPageConfig {
  product_ids?: string[]
  categories?: { id: string; name: string; product_ids: string[] }[]
  theme?: { accent_color?: string }
}

export async function fetchPublicCatalogProducts(
  supabase: SupabaseClient,
  userId: string,
  config?: CatalogPageConfig,
): Promise<PublicProductCard[]> {
  let query = supabase
    .from('business_items')
    .select(
      'id, title, slug, summary, description, price_amount, currency, pricing_model, inventory_status, tags, cover_image_url',
    )
    .eq('user_id', userId)
    .eq('kind', 'product')
    .eq('status', 'published')

  // Filter to specific product IDs when the catalog is configured with a selection.
  const selectedIds = config?.product_ids
  if (selectedIds && selectedIds.length > 0) {
    query = query.in('id', selectedIds)
  }

  query = query.order('updated_at', { ascending: false })

  const { data, error } = await query
  if (error) throw new Error(`fetchPublicCatalogProducts: ${error.message}`)

  const rows = (data ?? []).map((row) => {
    const pricingModel = row.pricing_model as PricingModel
    return {
      id: row.id as string,
      title: row.title as string,
      slug: row.slug as string,
      summary: (row.summary as string | null) ?? null,
      description: (row.description as string | null) ?? null,
      price_amount:
        row.price_amount === null || row.price_amount === undefined
          ? null
          : Number(row.price_amount),
      currency: row.currency as string,
      pricing_model: pricingModel,
      price_label: formatPrice({
        amount:
          row.price_amount === null || row.price_amount === undefined
            ? null
            : Number(row.price_amount),
        currency: row.currency as string,
        pricingModel,
      }),
      inventory_status: row.inventory_status as string,
      tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
      cover_image_url: (row.cover_image_url as string | null) ?? null,
    }
  })

  // Respect configured order when product_ids are explicit.
  if (selectedIds && selectedIds.length > 0) {
    const order = new Map(selectedIds.map((id, i) => [id, i]))
    rows.sort((a, b) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999))
  }

  return rows
}
