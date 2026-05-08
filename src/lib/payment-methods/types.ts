export type PaymentMethodKind = 'gcash' | 'bank_transfer' | 'other'

export interface PaymentMethodDetails {
  account_name?: string
  account_number?: string
  bank_name?: string
  branch?: string
  qr_image_url?: string
  [key: string]: string | undefined
}

export interface PaymentMethod {
  id: string
  user_id: string
  kind: PaymentMethodKind
  name: string
  instructions: string | null
  details: PaymentMethodDetails
  enabled: boolean
  position: number
  created_at: string
  updated_at: string
}

export interface PaymentMethodInput {
  kind: PaymentMethodKind
  name: string
  instructions: string
  details: PaymentMethodDetails
  enabled: boolean
}

export const PAYMENT_METHOD_KINDS: { value: PaymentMethodKind; label: string }[] = [
  { value: 'gcash', label: 'GCash' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'other', label: 'Other' },
]

export function paymentMethodKindLabel(kind: PaymentMethodKind): string {
  return PAYMENT_METHOD_KINDS.find((k) => k.value === kind)?.label ?? 'Other'
}
