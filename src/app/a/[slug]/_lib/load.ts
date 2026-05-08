import { unstable_cache } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyDeeplink, type DeeplinkClaims } from '@/lib/action-pages/signing'
import {
  fetchPublicCatalogProducts,
  type PublicProductCard,
} from '@/lib/business/public-dto'
import {
  loadPublicPaymentMethods,
  type PublicPaymentMethod,
} from '@/lib/payment-methods/public'
import type { ActionPageRow } from '@/app/(app)/dashboard/action-pages/_lib/queries'

type LoadedActionPage = ActionPageRow & { user_id: string }

export interface PublicLoadResult {
  page: ActionPageRow
  claims: DeeplinkClaims | null
  attribution_error: 'missing' | 'expired' | 'bad_signature' | null
  products?: PublicProductCard[]
  paymentMethods?: PublicPaymentMethod[]
}

export function actionPageSlugTag(slug: string) {
  return `action-page:slug:${slug}`
}

async function fetchPublishedPageBySlug(
  slug: string,
): Promise<LoadedActionPage | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('action_pages')
    .select(
      'id, user_id, kind, slug, title, description, status, config, pipeline_rules, notification_template, cta_label, bot_send_instructions, signing_secret, created_at, updated_at',
    )
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw new Error(`loadPublicActionPage: ${error.message}`)
  if (!data) return null
  if (data.status !== 'published') return null

  return {
    id: data.id as string,
    user_id: data.user_id as string,
    kind: data.kind as ActionPageRow['kind'],
    slug: data.slug as string,
    title: data.title as string,
    description: (data.description as string | null) ?? null,
    status: data.status as ActionPageRow['status'],
    config: (data.config as Record<string, unknown>) ?? {},
    pipeline_rules: (data.pipeline_rules as ActionPageRow['pipeline_rules']) ?? [],
    notification_template:
      (data.notification_template as ActionPageRow['notification_template']) ?? null,
    cta_label: (data.cta_label as string | null) ?? null,
    bot_send_instructions: (data.bot_send_instructions as string | null) ?? null,
    signing_secret: data.signing_secret as string,
    created_at: data.created_at as string,
    updated_at: data.updated_at as string,
  }
}

function getPublishedPage(slug: string) {
  return unstable_cache(
    () => fetchPublishedPageBySlug(slug),
    ['action-page-by-slug', slug],
    { tags: [actionPageSlugTag(slug)], revalidate: 3600 },
  )()
}

export async function loadPublicActionPage(
  slug: string,
  query: Record<string, string | string[] | undefined>,
): Promise<PublicLoadResult | null> {
  const page = await getPublishedPage(slug)
  if (!page) return null
  const {
    user_id: userId,
    signing_secret: signingSecret,
    ...safePage
  } = page
  const publicPage = safePage as ActionPageRow

  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (typeof v === 'string') sp.set(k, v)
  }

  let claims: DeeplinkClaims | null = null
  let attribution_error: PublicLoadResult['attribution_error'] = null
  if (sp.get('p') || sp.get('g') || sp.get('t') || sp.get('e')) {
    const verified = verifyDeeplink(signingSecret, slug, sp)
    if (verified.ok && verified.claims) {
      claims = verified.claims
    } else {
      attribution_error = verified.reason ?? 'missing'
    }
  }

  if (publicPage.kind === 'catalog') {
    const admin = createAdminClient()
    const products = await fetchPublicCatalogProducts(
      admin,
      userId,
      publicPage.config as Parameters<typeof fetchPublicCatalogProducts>[2],
    )
    const paymentMethodIds = Array.isArray(
      (publicPage.config as Record<string, unknown>).payment_method_ids,
    )
      ? ((publicPage.config as Record<string, unknown>).payment_method_ids as unknown[])
          .filter((x): x is string => typeof x === 'string')
      : []
    const paymentMethods = paymentMethodIds.length
      ? await loadPublicPaymentMethods(userId, paymentMethodIds)
      : []
    return { page: publicPage, claims, attribution_error, products, paymentMethods }
  }

  return { page: publicPage, claims, attribution_error }
}
