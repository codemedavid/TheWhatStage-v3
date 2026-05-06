import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { formatPrice } from '@/lib/business/pricing'
import type { PricingModel } from '@/lib/business/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('business_items')
    .select(
      'id, title, slug, summary, price_amount, currency, pricing_model, inventory_status, status, cover_image_url',
    )
    .eq('user_id', user.id)
    .eq('kind', 'product')
    .in('status', ['draft', 'published'])
    .order('updated_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const products = (data ?? []).map((p) => ({
    id: p.id as string,
    title: p.title as string,
    summary: (p.summary as string | null) ?? null,
    status: p.status as string,
    cover_image_url: (p.cover_image_url as string | null) ?? null,
    price_label: formatPrice({
      amount: p.price_amount === null ? null : Number(p.price_amount),
      currency: p.currency as string,
      pricingModel: p.pricing_model as PricingModel,
    }),
  }))

  return NextResponse.json({ products })
}
