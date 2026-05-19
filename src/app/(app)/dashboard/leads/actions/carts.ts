'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export interface LeadCartItem {
  id: string
  product_id: string | null
  name: string
  quantity: number
  unit_price: number
  image_url: string | null
}

export interface LeadCart {
  id: string
  status: 'active' | 'abandoned' | 'converted'
  source: string | null
  currency: string
  total_amount: number | null
  action_page_title: string | null
  created_at: string
  updated_at: string
  abandoned_at: string | null
  converted_at: string | null
  items: LeadCartItem[]
}

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

export async function loadLeadCarts(leadId: string): Promise<LeadCart[]> {
  const { supabase } = await requireUser()
  const { data: carts, error } = await supabase
    .from('carts')
    .select(
      'id, status, source, currency, total_amount, action_page_id, created_at, updated_at, abandoned_at, converted_at, action_pages(title)',
    )
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(`loadLeadCarts: ${error.message}`)
  if (!carts || carts.length === 0) return []

  const cartIds = carts.map((c) => c.id as string)
  const { data: items, error: itemErr } = await supabase
    .from('cart_items')
    .select('id, cart_id, product_id, name, quantity, unit_price, image_url')
    .in('cart_id', cartIds)
    .order('created_at', { ascending: true })
  if (itemErr) throw new Error(`loadLeadCarts items: ${itemErr.message}`)

  const byCart = new Map<string, LeadCartItem[]>()
  for (const row of items ?? []) {
    const cid = row.cart_id as string
    const list = byCart.get(cid) ?? []
    list.push({
      id: row.id as string,
      product_id: (row.product_id as string | null) ?? null,
      name: row.name as string,
      quantity: Number(row.quantity),
      unit_price: Number(row.unit_price),
      image_url: (row.image_url as string | null) ?? null,
    })
    byCart.set(cid, list)
  }

  return carts.map((c) => {
    const ap = c.action_pages as { title?: string } | { title?: string }[] | null
    const apTitle = Array.isArray(ap) ? (ap[0]?.title ?? null) : (ap?.title ?? null)
    return {
      id: c.id as string,
      status: c.status as LeadCart['status'],
      source: (c.source as string | null) ?? null,
      currency: (c.currency as string) ?? 'USD',
      total_amount:
        c.total_amount === null || c.total_amount === undefined
          ? null
          : Number(c.total_amount),
      action_page_title: apTitle,
      created_at: c.created_at as string,
      updated_at: c.updated_at as string,
      abandoned_at: (c.abandoned_at as string | null) ?? null,
      converted_at: (c.converted_at as string | null) ?? null,
      items: byCart.get(c.id as string) ?? [],
    }
  })
}
