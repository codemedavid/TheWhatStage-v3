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

export async function mintActionPageDeeplink(
  admin: SupabaseClient,
  pageId: string,
  recipient: { psid: string; pageId: string },
): Promise<string | null> {
  const { data: page } = await admin
    .from('action_pages')
    .select('slug, signing_secret')
    .eq('id', pageId)
    .maybeSingle<{ slug: string; signing_secret: string }>()
  if (!page) return null

  const exp = Math.floor(Date.now() / 1000) + DEEPLINK_TTL_SECONDS
  return deeplinkActionPageUrl(page.signing_secret, {
    slug: page.slug,
    psid: recipient.psid,
    pageId: recipient.pageId,
    exp,
  })
}
