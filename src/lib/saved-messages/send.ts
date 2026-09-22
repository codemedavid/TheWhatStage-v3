import type { SupabaseClient } from '@supabase/supabase-js'
import { hasPersonalizationTags, personalize } from '@/lib/agent/personalize'
import { MEDIA_ASSETS_BUCKET } from '@/lib/messenger/attachments'
import {
  dispatchOperatorSendFor,
  type OperatorAttachment,
  type SendResult,
} from '@/lib/messenger/operator-send'
import { resolveSavedMessage, type DeeplinkablePage, type ResolveContext } from './resolve'
import { usesCards, type SavedButton, type SavedCard, type SavedLayout } from './template'

// Operator send of a stored saved message. The stored row only *references* an
// action page or a library image; both are resolved per send — the deeplink is
// signed for this recipient, and the image URL is signed fresh because stored
// ones expire. See ./resolve.ts for the layout-to-payload mapping.

const DEEPLINK_TTL_SECONDS = 30 * 24 * 60 * 60
const IMAGE_URL_TTL_SECONDS = 60 * 60

export interface SavedMessageRow {
  id: string
  title: string
  body: string
  layout: SavedLayout
  buttons: SavedButton[]
  cards: SavedCard[]
}

const ROW_COLUMNS = 'id, title, body, layout, buttons, cards'

/** Every action page referenced by this message, wherever it sits. */
function referencedPageIds(row: SavedMessageRow): string[] {
  const fromCards = row.cards.flatMap((card) => card.buttons)
  return [...row.buttons, ...fromCards]
    .filter((button) => button.type === 'action_page')
    .map((button) => button.action_page_id)
    .filter(Boolean)
}

function referencedAssetIds(row: SavedMessageRow): string[] {
  return row.cards.map((card) => card.image_asset_id).filter((id): id is string => !!id)
}

/**
 * Published action pages by id. Unpublished and deleted pages are simply
 * absent, which drops their buttons at resolve time instead of blocking a send.
 */
async function loadPages(
  supabase: SupabaseClient,
  userId: string,
  ids: string[],
): Promise<Map<string, DeeplinkablePage>> {
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase
    .from('action_pages')
    .select('id, slug, signing_secret')
    .eq('user_id', userId)
    .eq('status', 'published')
    .in('id', ids)
  if (error) throw new Error(`sendSavedMessage: ${error.message}`)
  return new Map(
    (data ?? []).map((page) => [
      page.id as string,
      { slug: page.slug as string, signing_secret: page.signing_secret as string },
    ]),
  )
}

/**
 * Signed image URLs by asset id. Meta fetches the image itself, so the URL has
 * to be reachable for the life of the fetch — an hour is ample.
 */
async function loadImageUrls(
  supabase: SupabaseClient,
  userId: string,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase
    .from('media_assets')
    .select('id, storage_path')
    .eq('user_id', userId)
    .eq('is_archived', false)
    .in('id', ids)
  if (error) throw new Error(`sendSavedMessage: ${error.message}`)

  const assets = (data ?? []) as Array<{ id: string; storage_path: string }>
  if (assets.length === 0) return new Map()

  const { data: signed, error: signErr } = await supabase.storage
    .from(MEDIA_ASSETS_BUCKET)
    .createSignedUrls(
      assets.map((asset) => asset.storage_path),
      IMAGE_URL_TTL_SECONDS,
    )
  // A signing failure costs the card its image, not the whole message.
  if (signErr || !signed) return new Map()

  const byPath = new Map(signed.map((entry) => [entry.path ?? '', entry.signedUrl]))
  const urls = new Map<string, string>()
  for (const asset of assets) {
    const url = byPath.get(asset.storage_path)
    if (url) urls.set(asset.id, url)
  }
  return urls
}

/**
 * A merge-tag renderer for this recipient, or a pass-through when nothing in
 * the message carries a tag — the lead read is skipped entirely in that case,
 * which is the common one. `personalize` is idempotent and substitutes its own
 * fallback name, so a literal `[first_name]` can never reach a customer.
 */
async function tagRenderer(
  supabase: SupabaseClient,
  userId: string,
  leadId: string,
  texts: string[],
): Promise<((text: string) => string) | undefined> {
  if (!texts.some(hasPersonalizationTags)) return undefined
  const { data: lead } = await supabase
    .from('leads')
    .select('name')
    .eq('id', leadId)
    .eq('user_id', userId)
    .maybeSingle<{ name: string | null }>()
  return (text) => personalize(text, { name: lead?.name ?? null })
}

/** Every piece of copy in this message that a customer will read. */
function customerFacingTexts(row: SavedMessageRow, body: string): string[] {
  return [body, ...row.cards.flatMap((card) => [card.title, card.subtitle ?? ''])]
}

/** Timeline attachment describing what the layout actually put on screen. */
function attachmentsFor(
  layout: SavedLayout,
  rendered: ReturnType<typeof resolveSavedMessage>['rendered'],
): OperatorAttachment[] | undefined {
  if (usesCards(layout) && rendered.cards?.length) {
    return [{ type: 'card', cards: rendered.cards }]
  }
  if (rendered.buttons?.length) {
    return [{ type: 'buttons', buttons: rendered.buttons }]
  }
  return undefined
}

/**
 * Send a stored saved message to a lead. `overrideText` is the operator's
 * edit in the composer; it applies to the text layouts only, since a card
 * message carries its text inside the cards.
 */
export async function sendSavedMessageFor(
  supabase: SupabaseClient,
  userId: string,
  leadId: string,
  savedMessageId: string,
  overrideText?: string,
): Promise<SendResult> {
  const { data, error } = await supabase
    .from('saved_messages')
    .select(ROW_COLUMNS)
    .eq('id', savedMessageId)
    .eq('user_id', userId)
    .maybeSingle<SavedMessageRow>()
  if (error) throw new Error(`sendSavedMessage: ${error.message}`)
  if (!data) throw new Error('sendSavedMessage: saved message not found')

  const row: SavedMessageRow = {
    ...data,
    buttons: Array.isArray(data.buttons) ? data.buttons : [],
    cards: Array.isArray(data.cards) ? data.cards : [],
  }
  const body = usesCards(row.layout) ? row.body : overrideText?.trim() || row.body

  // Independent lookups — one round trip instead of three.
  const [pages, images, render] = await Promise.all([
    loadPages(supabase, userId, referencedPageIds(row)),
    loadImageUrls(supabase, userId, referencedAssetIds(row)),
    tagRenderer(supabase, userId, leadId, customerFacingTexts(row, body)),
  ])

  return dispatchOperatorSendFor({
    supabase,
    userId,
    context: 'sendSavedMessageAsOperator',
    leadId,
    build: (thread) => {
      const ctx: ResolveContext = {
        pages,
        images,
        psid: thread.psid,
        pageId: thread.page_id,
        exp: Math.floor(Date.now() / 1000) + DEEPLINK_TTL_SECONDS,
        render,
      }
      const resolved = resolveSavedMessage(
        { layout: row.layout, body, buttons: row.buttons, cards: row.cards },
        ctx,
      )
      return {
        payload: resolved.payload,
        body: resolved.body,
        attachments: attachmentsFor(row.layout, resolved.rendered),
      }
    },
  })
}
