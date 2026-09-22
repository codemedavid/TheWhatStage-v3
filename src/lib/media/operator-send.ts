import type { SupabaseClient } from '@supabase/supabase-js'
import { MEDIA_ASSETS_BUCKET } from '@/lib/messenger/attachments'
import { dispatchOperatorSendFor, type SendResult } from '@/lib/messenger/operator-send'
import { buildMediaPayload, loadSendableAssets, mediaMessageBody } from './send'
import { mediaKindFromMime } from './kind'

// Operator-initiated "send one library asset" (mobile + future dashboard use).
// Goes through dispatchOperatorSendFor so it gets the same side effects as a
// typed reply: HUMAN_AGENT policy, audit row, bot-pause stamp, workflow release.

const SIGNED_URL_TTL_SECONDS = 60 * 60

export async function sendMediaAssetFor(
  supabase: SupabaseClient,
  userId: string,
  leadId: string,
  assetId: string,
): Promise<SendResult> {
  const [asset] = await loadSendableAssets(supabase, userId, [assetId])
  if (!asset) return { ok: false, error: 'media_not_found' }
  const kind = mediaKindFromMime(asset.mimeType)
  if (!kind) return { ok: false, error: 'media_unsupported' }

  const { data: signed, error: signErr } = await supabase.storage
    .from(MEDIA_ASSETS_BUCKET)
    .createSignedUrl(asset.storagePath, SIGNED_URL_TTL_SECONDS)
  if (signErr || !signed?.signedUrl) return { ok: false, error: 'media_sign_failed' }
  const url = signed.signedUrl

  return dispatchOperatorSendFor({
    supabase,
    userId,
    context: 'sendMediaAssetAsOperator',
    leadId,
    build: () => ({
      payload: buildMediaPayload(asset.mimeType, url),
      body: mediaMessageBody(asset),
      attachments: [{ type: kind, media_asset_id: asset.id, storage_path: asset.storagePath, name: asset.name }],
    }),
  })
}
