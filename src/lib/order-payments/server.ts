import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  CreateOrderPaymentInput,
  OrderPayment,
  OrderPaymentStatus,
} from './types'
import type { PaymentMethod, PaymentMethodKind } from '@/lib/payment-methods/types'

export function snapshotMethod(m: Pick<PaymentMethod, 'kind' | 'name'>) {
  return { method_kind: m.kind, method_name: m.name }
}

export function resolveStatusForOrder(
  s: OrderPaymentStatus,
): 'pending' | 'paid' | 'failed' {
  if (s === 'verified') return 'paid'
  if (s === 'rejected') return 'failed'
  return 'pending'
}

export async function createFromSubmission(
  admin: SupabaseClient,
  input: CreateOrderPaymentInput,
): Promise<OrderPayment> {
  const { data, error } = await admin
    .from('order_payments')
    .insert(input)
    .select('*')
    .single<OrderPayment>()
  if (error || !data) {
    throw new Error(`order_payments insert failed: ${error?.message}`)
  }
  return data
}

export async function verifyPayment(
  admin: SupabaseClient,
  id: string,
  userId: string,
  verifiedBy: string,
): Promise<void> {
  const { error } = await admin
    .from('order_payments')
    .update({
      status: 'verified',
      verified_at: new Date().toISOString(),
      verified_by: verifiedBy,
      rejection_reason: null,
    })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`verifyPayment: ${error.message}`)
}

export async function rejectPayment(
  admin: SupabaseClient,
  id: string,
  userId: string,
  reason: string,
): Promise<void> {
  const r = reason.trim().slice(0, 500)
  if (!r) throw new Error('Rejection reason required.')
  const { error } = await admin
    .from('order_payments')
    .update({ status: 'rejected', rejection_reason: r })
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`rejectPayment: ${error.message}`)
}

export async function listBySubmissionIds(
  admin: SupabaseClient,
  userId: string,
  submissionIds: string[],
): Promise<Map<string, OrderPayment>> {
  if (!submissionIds.length) return new Map()
  const { data, error } = await admin
    .from('order_payments')
    .select('*')
    .eq('user_id', userId)
    .in('submission_id', submissionIds)
  if (error || !data) return new Map()
  const map = new Map<string, OrderPayment>()
  for (const row of data as OrderPayment[]) map.set(row.submission_id, row)
  return map
}

export type { PaymentMethodKind }
