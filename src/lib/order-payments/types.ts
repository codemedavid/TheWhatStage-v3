import type { PaymentMethodKind } from '@/lib/payment-methods/types'

export type OrderPaymentStatus = 'submitted' | 'verified' | 'rejected'

export interface OrderPayment {
  id: string
  user_id: string
  submission_id: string
  business_order_id: string | null
  action_page_id: string
  payment_method_id: string

  method_kind: PaymentMethodKind
  method_name: string

  proof_url: string
  proof_file_id: string | null
  amount: number | null
  currency: string | null
  note: string | null

  status: OrderPaymentStatus
  verified_at: string | null
  verified_by: string | null
  rejection_reason: string | null

  created_at: string
  updated_at: string
}

export interface CreateOrderPaymentInput {
  user_id: string
  submission_id: string
  business_order_id: string | null
  action_page_id: string
  payment_method_id: string
  method_kind: PaymentMethodKind
  method_name: string
  proof_url: string
  proof_file_id: string | null
  amount: number | null
  currency: string | null
  note: string | null
}
