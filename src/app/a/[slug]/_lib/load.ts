import { createAdminClient } from '@/lib/supabase/admin'
import { verifyDeeplink, type DeeplinkClaims } from '@/lib/action-pages/signing'
import type { ActionPageRow } from '@/app/(app)/dashboard/action-pages/_lib/queries'

export interface PublicLoadResult {
  page: ActionPageRow
  claims: DeeplinkClaims | null
  attribution_error: 'missing' | 'expired' | 'bad_signature' | null
}

export async function loadPublicActionPage(
  slug: string,
  query: Record<string, string | string[] | undefined>,
): Promise<PublicLoadResult | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('action_pages')
    .select(
      'id, user_id, kind, slug, title, description, status, config, pipeline_rules, notification_template, signing_secret, created_at, updated_at',
    )
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw new Error(`loadPublicActionPage: ${error.message}`)
  if (!data) return null
  if (data.status !== 'published') return null

  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (typeof v === 'string') sp.set(k, v)
  }

  let claims: DeeplinkClaims | null = null
  let attribution_error: PublicLoadResult['attribution_error'] = null
  if (sp.get('p') || sp.get('g') || sp.get('t') || sp.get('e')) {
    const verified = verifyDeeplink(data.signing_secret as string, slug, sp)
    if (verified.ok && verified.claims) {
      claims = verified.claims
    } else {
      attribution_error = verified.reason ?? 'missing'
    }
  }

  return {
    page: {
      id: data.id as string,
      kind: data.kind as ActionPageRow['kind'],
      slug: data.slug as string,
      title: data.title as string,
      description: (data.description as string | null) ?? null,
      status: data.status as ActionPageRow['status'],
      config: (data.config as Record<string, unknown>) ?? {},
      pipeline_rules: (data.pipeline_rules as ActionPageRow['pipeline_rules']) ?? [],
      notification_template:
        (data.notification_template as ActionPageRow['notification_template']) ?? null,
      signing_secret: data.signing_secret as string,
      created_at: data.created_at as string,
      updated_at: data.updated_at as string,
    },
    claims,
    attribution_error,
  }
}
