'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export interface LeadOrderItem {
  id: string
  title_snapshot: string
  sku_snapshot: string | null
  quantity: number
  unit_amount: number
  currency: string
  line_total_amount: number
}

export interface LeadOrder {
  id: string
  status: 'new' | 'confirmed' | 'cancelled' | 'fulfilled'
  payment_status: string
  currency: string
  subtotal_amount: number
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  customer_notes: string | null
  created_at: string
  items: LeadOrderItem[]
}

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

/**
 * Load product-catalog orders attributed to a lead, newest first, with their
 * line items. Used by the Lead drawer's "Orders" tab.
 */
export async function loadLeadOrders(leadId: string): Promise<LeadOrder[]> {
  const { supabase } = await requireUser()
  const { data: orders, error } = await supabase
    .from('business_orders')
    .select(
      'id, status, payment_status, currency, subtotal_amount, customer_name, customer_email, customer_phone, customer_notes, created_at',
    )
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(`loadLeadOrders: ${error.message}`)
  if (!orders || orders.length === 0) return []

  const orderIds = orders.map((o) => o.id as string)
  const { data: items, error: itemErr } = await supabase
    .from('business_order_items')
    .select(
      'id, order_id, title_snapshot, sku_snapshot, quantity, unit_amount, currency, line_total_amount',
    )
    .in('order_id', orderIds)
    .order('created_at', { ascending: true })
  if (itemErr) throw new Error(`loadLeadOrders items: ${itemErr.message}`)

  const byOrder = new Map<string, LeadOrderItem[]>()
  for (const row of items ?? []) {
    const oid = row.order_id as string
    const list = byOrder.get(oid) ?? []
    list.push({
      id: row.id as string,
      title_snapshot: row.title_snapshot as string,
      sku_snapshot: (row.sku_snapshot as string | null) ?? null,
      quantity: Number(row.quantity),
      unit_amount: Number(row.unit_amount),
      currency: row.currency as string,
      line_total_amount: Number(row.line_total_amount),
    })
    byOrder.set(oid, list)
  }

  return orders.map((o) => ({
    id: o.id as string,
    status: o.status as LeadOrder['status'],
    payment_status: o.payment_status as string,
    currency: o.currency as string,
    subtotal_amount: Number(o.subtotal_amount),
    customer_name: (o.customer_name as string | null) ?? null,
    customer_email: (o.customer_email as string | null) ?? null,
    customer_phone: (o.customer_phone as string | null) ?? null,
    customer_notes: (o.customer_notes as string | null) ?? null,
    created_at: o.created_at as string,
    items: byOrder.get(o.id as string) ?? [],
  }))
}
