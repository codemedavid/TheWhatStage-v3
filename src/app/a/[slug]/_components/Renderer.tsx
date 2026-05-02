import type { ActionPageRow } from '@/app/(app)/dashboard/action-pages/_lib/queries'
import type { DeeplinkClaims } from '@/lib/action-pages/signing'
import type { PublicProductCard } from '@/lib/business/public-dto'
import { KindRenderer } from './KindRenderer'

export function ActionPageRenderer(props: {
  page: ActionPageRow
  claims: DeeplinkClaims | null
  rawToken: string | null
  variant: 'standalone' | 'embed'
  products?: PublicProductCard[]
}) {
  return <KindRenderer {...props} />
}
