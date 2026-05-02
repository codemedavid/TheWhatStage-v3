import type { ActionPageRow } from '@/app/(app)/dashboard/action-pages/_lib/queries'
import type { DeeplinkClaims } from '@/lib/action-pages/signing'
import type { PublicProductCard } from '@/lib/business/public-dto'

/**
 * Contract every kind renderer must satisfy.
 *
 * The renderer owns the public-facing UI between the page header and the
 * footer.  It must include a `<form action="/api/action-pages/submit"
 * method="post">` with hidden inputs for `slug` and (when claims are set)
 * `p`, `g`, `e`, `t`. Field names with the `data.` prefix are unwrapped
 * server-side into the submission's `data` jsonb.
 */
export interface KindRendererProps {
  page: ActionPageRow
  claims: DeeplinkClaims | null
  rawToken: string | null
  variant: 'standalone' | 'embed'
  products?: PublicProductCard[]
}
