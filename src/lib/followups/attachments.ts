import type { SupabaseClient } from '@supabase/supabase-js'
import { deeplinkActionPageUrl } from '@/lib/action-pages/urls'

const SIGNED_URL_TTL_SECONDS = 60 * 60          // 1 hour
const DEEPLINK_TTL_SECONDS = 30 * 24 * 60 * 60  // 30 days

export async function mintMediaAssetUrl(
  admin: SupabaseClient,
  assetId: string,
  userId: string,
): Promise<string | null> {
  const { data: asset } = await admin
    .from('media_assets')
    .select('storage_path, is_archived')
    .eq('id', assetId)
    .eq('user_id', userId)
    .maybeSingle<{ storage_path: string; is_archived: boolean }>()
  if (!asset || asset.is_archived) return null

  const { data: signed, error } = await admin.storage
    .from('media-assets')
    .createSignedUrl(asset.storage_path, SIGNED_URL_TTL_SECONDS)
  if (error || !signed?.signedUrl) return null
  return signed.signedUrl
}

export interface ActionPageDeeplink {
  url: string
  /** Configured button label — fallback when no AI label is generated. */
  ctaLabel: string
  /** Page title — context for the CTA generator. */
  title: string
  /** bot_send_instructions — context for the CTA generator. */
  instructions: string
}

export async function mintActionPageDeeplink(
  admin: SupabaseClient,
  pageId: string,
  userId: string,
  recipient: { psid: string; pageId: string },
): Promise<ActionPageDeeplink | null> {
  const { data: page } = await admin
    .from('action_pages')
    .select('slug, signing_secret, cta_label, title, bot_send_instructions')
    .eq('id', pageId)
    .eq('user_id', userId)
    .maybeSingle<{
      slug: string
      signing_secret: string
      cta_label: string | null
      title: string | null
      bot_send_instructions: string | null
    }>()
  if (!page) return null

  const exp = Math.floor(Date.now() / 1000) + DEEPLINK_TTL_SECONDS
  const url = deeplinkActionPageUrl(page.signing_secret, {
    slug: page.slug,
    psid: recipient.psid,
    pageId: recipient.pageId,
    exp,
  })
  return {
    url,
    ctaLabel: page.cta_label?.trim() || '',
    title: page.title?.trim() || '',
    instructions: page.bot_send_instructions?.trim() || '',
  }
}
