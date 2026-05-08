import type { ActionPageRow } from '@/app/(app)/dashboard/action-pages/_lib/queries'
import type { DeeplinkClaims } from '@/lib/action-pages/signing'
import type { PublicProductCard } from '@/lib/business/public-dto'
import type { PublicPaymentMethod } from '@/lib/payment-methods/public'
import { KindRenderer } from './KindRenderer'

export function ActionPageRenderer(props: {
  page: ActionPageRow
  claims: DeeplinkClaims | null
  rawToken: string | null
  variant: 'standalone' | 'embed'
  products?: PublicProductCard[]
  paymentMethods?: PublicPaymentMethod[]
  searchParams?: Record<string, string | string[] | undefined>
}) {
  return <KindRenderer {...props} />
}
