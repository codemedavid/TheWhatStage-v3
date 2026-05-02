import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProductDetails, ProductRecommendationHints } from '@/lib/business/types'

export interface ProductListItem {
  id: string
  title: string
  slug: string
  status: 'draft' | 'published' | 'archived'
  summary: string | null
  price_amount: number | null
  currency: string
  pricing_model: 'fixed' | 'starts_at' | 'quote' | 'free'
  inventory_status: string
  tags: string[]
  updated_at: string
}

export interface ProductEditorRow extends ProductListItem {
  description: string | null
  compare_at_amount: number | null
  sku: string | null
  details: ProductDetails
  recommendation_hints: ProductRecommendationHints
  rag_enabled: boolean
  rag_text: string | null
}

export interface OrderListItem {
  id: string
  status: 'new' | 'confirmed' | 'cancelled' | 'fulfilled'
  payment_status: string
  currency: string
  subtotal_amount: number
  customer_name: string | null
  customer_phone: string | null
  created_at: string
}

export interface OrderDetail extends OrderListItem {
  customer_email: string | null
  customer_notes: string | null
  items: {
    id: string
    title_snapshot: string
    quantity: number
    unit_amount: number
    currency: string
    line_total_amount: number
  }[]
}

export async function fetchProducts(
  supabase: SupabaseClient,
  userId: string,
  opts: { q?: string; status?: string } = {},
): Promise<ProductListItem[]> {
  let query = supabase
    .from('business_items')
    .select(
      'id, title, slug, status, summary, price_amount, currency, pricing_model, inventory_status, tags, updated_at',
    )
    .eq('user_id', userId)
    .eq('kind', 'product')
    .order('updated_at', { ascending: false })

  if (opts.status && opts.status !== 'all') query = query.eq('status', opts.status)
  if (opts.q?.trim()) {
    const q = opts.q.trim().replace(/[%_]/g, '')
    query = query.ilike('title', `%${q}%`)
  }

  const { data, error } = await query
  if (error) throw new Error(`fetchProducts: ${error.message}`)
  return (data ?? []) as ProductListItem[]
}

export async function fetchProduct(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<ProductEditorRow | null> {
  const { data, error } = await supabase
    .from('business_items')
    .select(
      'id, title, slug, status, summary, description, price_amount, compare_at_amount, currency, pricing_model, sku, inventory_status, tags, details, recommendation_hints, rag_enabled, rag_text, updated_at',
    )
    .eq('user_id', userId)
    .eq('kind', 'product')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`fetchProduct: ${error.message}`)
  return (data ?? null) as ProductEditorRow | null
}

export async function fetchOrders(
  supabase: SupabaseClient,
  userId: string,
): Promise<OrderListItem[]> {
  const { data, error } = await supabase
    .from('business_orders')
    .select('id, status, payment_status, currency, subtotal_amount, customer_name, customer_phone, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`fetchOrders: ${error.message}`)
  return (data ?? []) as OrderListItem[]
}

export interface BusinessStats {
  totalProducts: number
  draftProducts: number
  publishedProducts: number
  archivedProducts: number
  totalOrders: number
  newOrders: number
  recentProducts: ProductListItem[]
  recentOrders: OrderListItem[]
}

export async function fetchBusinessStats(
  supabase: SupabaseClient,
  userId: string,
): Promise<BusinessStats> {
  const [products, orders] = await Promise.all([
    supabase
      .from('business_items')
      .select(
        'id, title, slug, status, summary, price_amount, currency, pricing_model, inventory_status, tags, updated_at',
      )
      .eq('user_id', userId)
      .eq('kind', 'product')
      .order('updated_at', { ascending: false }),
    supabase
      .from('business_orders')
      .select(
        'id, status, payment_status, currency, subtotal_amount, customer_name, customer_phone, created_at',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
  ])

  if (products.error) throw new Error(`fetchBusinessStats products: ${products.error.message}`)
  if (orders.error) throw new Error(`fetchBusinessStats orders: ${orders.error.message}`)

  const allProducts = (products.data ?? []) as ProductListItem[]
  const allOrders = (orders.data ?? []) as OrderListItem[]

  return {
    totalProducts: allProducts.length,
    draftProducts: allProducts.filter((p) => p.status === 'draft').length,
    publishedProducts: allProducts.filter((p) => p.status === 'published').length,
    archivedProducts: allProducts.filter((p) => p.status === 'archived').length,
    totalOrders: allOrders.length,
    newOrders: allOrders.filter((o) => o.status === 'new').length,
    recentProducts: allProducts.slice(0, 5),
    recentOrders: allOrders.slice(0, 5),
  }
}

export async function fetchOrder(
  supabase: SupabaseClient,
  userId: string,
  id: string,
): Promise<OrderDetail | null> {
  const { data: order, error } = await supabase
    .from('business_orders')
    .select(
      'id, status, payment_status, currency, subtotal_amount, customer_name, customer_phone, customer_email, customer_notes, created_at',
    )
    .eq('user_id', userId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`fetchOrder: ${error.message}`)
  if (!order) return null

  const { data: items, error: itemErr } = await supabase
    .from('business_order_items')
    .select('id, title_snapshot, quantity, unit_amount, currency, line_total_amount')
    .eq('user_id', userId)
    .eq('order_id', id)
    .order('created_at', { ascending: true })
  if (itemErr) throw new Error(`fetchOrder items: ${itemErr.message}`)
  return { ...(order as OrderListItem), items: (items ?? []) as OrderDetail['items'] } as OrderDetail
}
