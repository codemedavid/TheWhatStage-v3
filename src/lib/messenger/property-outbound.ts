import type { MessengerGenericElement } from '@/lib/facebook/messenger'
import type { RealestateProperty } from '@/app/a/[slug]/_kinds/realestate/schema'
import { deeplinkActionPageUrl } from '@/lib/action-pages/urls'
import { propertySlug } from '@/lib/action-pages/rag/property-rag-text'
import { sendOutbound, type SendKind } from '@/lib/messenger/outbound'
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

const ACTIVE_STATUSES = new Set(['for_sale', 'for_rent'])

const DEEPLINK_TTL_SECONDS = 30 * 24 * 60 * 60

function priceLabel(p: RealestateProperty['price']): string {
  if (p.display_label.trim()) return p.display_label.trim()
  if (p.amount == null) return ''
  return `${p.currency} ${p.amount.toLocaleString('en-PH', { minimumFractionDigits: 0 })}`
}

function locationLabel(addr: RealestateProperty['address']): string {
  return [addr.city, addr.region].map((s) => s.trim()).filter(Boolean).join(', ')
}

function pickImageUrl(gallery: RealestateProperty['gallery']): string | undefined {
  if (gallery.length === 0) return undefined
  const primary = gallery.find((g) => g.primary)
  return (primary ?? gallery[0]).url || undefined
}

function appendQuery(base: string, key: string, value: string): string {
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}${key}=${encodeURIComponent(value)}`
}

/**
 * Build Messenger generic-template carousel elements from a realestate
 * action page's properties. Filters to active listings, drops empty titles,
 * caps at 10, and follows Messenger's 80-char title/subtitle limits.
 */
export function buildRealestateCarouselElements(
  properties: RealestateProperty[],
  pageDeeplink: string,
  ctaLabel: string,
): MessengerGenericElement[] {
  const active = properties.filter(
    (p) => ACTIVE_STATUSES.has(p.status) && p.title.trim().length > 0,
  )
  return active.slice(0, 10).map((p) => {
    const slug = propertySlug(p.id)
    const productUrl = appendQuery(pageDeeplink, 'property', slug)
    const subtitleParts = [priceLabel(p.price), locationLabel(p.address)].filter(Boolean)
    return {
      title: p.title.slice(0, 80),
      subtitle: subtitleParts.join(' · ').slice(0, 80) || undefined,
      imageUrl: pickImageUrl(p.gallery),
      defaultActionUrl: productUrl,
      buttons: [
        { title: 'View property', url: productUrl },
        { title: ctaLabel || 'View all', url: pageDeeplink },
      ],
    }
  })
}

// ---------------------------------------------------------------------------
// sendPropertyRecommendation
// ---------------------------------------------------------------------------

export interface PropertyRecommendationSendInput {
  admin: AdminClient
  thread: { id: string; psid: string; last_inbound_at: string | null }
  pageToken: string
  /** Facebook page id (NOT the action page id) — required for the deeplink claims. */
  facebookPageId: string
  page: { id: string; slug: string; signing_secret: string }
  property: {
    id: string
    /** propertySlug(prop.id) — also used in the postback payload. */
    slug: string
    title: string
    price_label: string
    cover_image_url: string | null
    city: string
    region: string
  }
  /** Reranker confidence 0–1, recorded for dashboard observability. */
  confidence: number
  /** Caption shown above the card. Localized by the caller. */
  caption?: string
  kind?: SendKind
}

export interface PropertyRecommendationSendResult {
  sent: boolean
  messageIds: string[]
  imageSent: boolean
  reason?: string
  deeplinkUrl: string
}

function trimToBytes(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, Math.max(0, max - 1))}…`
}

export async function sendPropertyRecommendation(
  args: PropertyRecommendationSendInput,
): Promise<PropertyRecommendationSendResult> {
  const { admin, thread, pageToken, page, property, facebookPageId } = args
  const kind = args.kind ?? 'bot'

  const exp = Math.floor(Date.now() / 1000) + DEEPLINK_TTL_SECONDS
  const baseUrl = deeplinkActionPageUrl(page.signing_secret, {
    slug: page.slug,
    psid: thread.psid,
    pageId: facebookPageId,
    exp,
  })
  const sep = baseUrl.includes('?') ? '&' : '?'
  const deeplinkUrl = `${baseUrl}${sep}property=${encodeURIComponent(property.slug)}`

  const messageIds: string[] = []
  let imageSent = false

  if (property.cover_image_url) {
    const imgResult = await sendOutbound({
      admin,
      thread,
      pageToken,
      payload: { kind: 'image', imageUrl: property.cover_image_url },
      kind,
    })
    if (!imgResult.sent) {
      return { sent: false, messageIds: [], imageSent: false, reason: imgResult.reason, deeplinkUrl }
    }
    messageIds.push(imgResult.messageId)
    imageSent = true
  }

  const caption = args.caption?.trim() || 'Check this out 👇'
  const location = [property.city, property.region].filter((s) => s.trim()).join(', ')
  const subtitleParts = [property.price_label, location].filter(Boolean)
  const subtitle = trimToBytes(`${caption}\n${subtitleParts.join(' · ')}`, 80)

  const cardResult = await sendOutbound({
    admin,
    thread,
    pageToken,
    payload: {
      kind: 'generic_template',
      elements: [
        {
          title: trimToBytes(property.title, 80),
          subtitle,
          imageUrl: property.cover_image_url ?? undefined,
          defaultActionUrl: deeplinkUrl,
          buttons: [
            { title: 'View property', url: deeplinkUrl },
            { title: 'Inquire', postback: `rec_inquire:${property.slug}` },
          ],
        },
      ],
    },
    kind,
  })

  if (!cardResult.sent) {
    return {
      sent: messageIds.length > 0,
      messageIds,
      imageSent,
      reason: cardResult.reason,
      deeplinkUrl,
    }
  }
  messageIds.push(cardResult.messageId)
  return { sent: true, messageIds, imageSent, deeplinkUrl }
}
