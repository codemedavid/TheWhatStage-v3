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
}

export async function fetchPublicCatalogProducts(
  supabase: SupabaseClient,
  userId: string,
): Promise<PublicProductCard[]> {
  const { data, error } = await supabase
    .from('business_items')
    .select(
      'id, title, slug, summary, description, price_amount, currency, pricing_model, inventory_status, tags',
    )
    .eq('user_id', userId)
    .eq('kind', 'product')
    .eq('status', 'published')
    .order('updated_at', { ascending: false })

  if (error) throw new Error(`fetchPublicCatalogProducts: ${error.message}`)

  return (data ?? []).map((row) => {
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
    }
  })
}
