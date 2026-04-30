import type { ActionPageRow } from '@/app/(app)/dashboard/action-pages/_lib/queries'
import type { DeeplinkClaims } from '@/lib/action-pages/signing'
import { KindRenderer } from './KindRenderer'

export function ActionPageRenderer(props: {
  page: ActionPageRow
  claims: DeeplinkClaims | null
  rawToken: string | null
  variant: 'standalone' | 'embed'
}) {
  return <KindRenderer {...props} />
}
