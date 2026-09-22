import type { MessengerButtonSpec, MessengerGenericElement } from '@/lib/facebook/messenger'
import type { OutboundPayload } from '@/lib/messenger/outbound'
import { deeplinkActionPageUrl } from '@/lib/action-pages/urls'
import {
  BUTTONS_MAX,
  CARDS_MAX,
  CARD_SUBTITLE_MAX,
  CARD_TITLE_MAX,
  LABEL_MAX,
  REPLY_MAX,
  isSendableUrl,
  textMaxFor,
  usesCards,
  type SavedButton,
  type SavedCard,
  type SavedMessageShape,
} from './template'

// Turning a *stored* saved message into an *outbound* payload. Everything the
// stored shape only references — an action page, a media-library image — is
// resolved here against data the caller already fetched, so this stays a pure
// function and the whole layout matrix is testable without a database.

/** Prefix on the postback payload of a "trigger a bot reply" button. */
export const SAY_POSTBACK_PREFIX = 'btn_say'

export interface DeeplinkablePage {
  slug: string
  signing_secret: string
}

export interface ResolveContext {
  /** Published action pages by id. A missing id means unpublished or deleted. */
  pages: Map<string, DeeplinkablePage>
  /** Freshly signed image URLs by media-asset id. */
  images: Map<string, string>
  psid: string
  pageId: string
  /** Deeplink expiry, as a unix timestamp in seconds. */
  exp: number
  /**
   * Renders merge tags ([first_name] and friends) in every piece of copy that
   * reaches the customer. Defaults to leaving text untouched so the layout
   * mapping can be tested without a lead.
   */
  render?: (text: string) => string
}

function renderWith(ctx: ResolveContext, text: string): string {
  return ctx.render ? ctx.render(text) : text
}

/** Timeline record of what was sent — the operator's own inbox rendering. */
export interface RenderedButton {
  label: string
  url?: string
}

export interface RenderedCard {
  title: string
  subtitle?: string
  image_url?: string
  buttons?: RenderedButton[]
}

/**
 * One button, resolved for this recipient — or null when its target no longer
 * exists or is not safe to send. A deleted or unpublished action page drops its
 * button rather than failing the send: the rest of the message is still worth
 * delivering.
 *
 * Buttons are JSONB written straight through PostgREST, so the editor's
 * validation is not a guarantee — anything a customer could tap is re-checked
 * here. In particular only http(s) links are ever handed to Messenger, so a
 * `javascript:` or `data:` URL in a stored row can never reach a webview.
 */
function resolveButton(
  button: SavedButton,
  ctx: ResolveContext,
): { spec: MessengerButtonSpec; rendered: RenderedButton } | null {
  const title = button.label.trim().slice(0, LABEL_MAX)
  if (!title) return null
  switch (button.type) {
    case 'url': {
      if (!isSendableUrl(button.url)) return null
      const url = button.url.trim()
      return { spec: { title, url }, rendered: { label: title, url } }
    }
    case 'phone': {
      const phone = button.phone.replace(/[\s().-]/g, '')
      if (!phone) return null
      return { spec: { title, phone }, rendered: { label: title } }
    }
    case 'postback': {
      // Meta caps a postback payload at 1000 bytes, prefix included.
      const reply = button.reply.trim().slice(0, REPLY_MAX)
      if (!reply) return null
      return {
        spec: { title, postback: `${SAY_POSTBACK_PREFIX}:${reply}` },
        rendered: { label: title },
      }
    }
    case 'action_page': {
      const page = ctx.pages.get(button.action_page_id)
      if (!page) return null
      const url = deeplinkActionPageUrl(page.signing_secret, {
        slug: page.slug,
        psid: ctx.psid,
        pageId: ctx.pageId,
        exp: ctx.exp,
      })
      return { spec: { title, url }, rendered: { label: title, url } }
    }
  }
}

export function resolveButtons(
  buttons: SavedButton[],
  ctx: ResolveContext,
): { specs: MessengerButtonSpec[]; rendered: RenderedButton[] } {
  const specs: MessengerButtonSpec[] = []
  const rendered: RenderedButton[] = []
  for (const button of buttons.slice(0, BUTTONS_MAX)) {
    const resolved = resolveButton(button, ctx)
    if (!resolved) continue
    specs.push(resolved.spec)
    rendered.push(resolved.rendered)
  }
  return { specs, rendered }
}

/** A card's image: a library asset signed for this send, or a plain URL. */
function cardImageUrl(card: SavedCard, ctx: ResolveContext): string | undefined {
  if (card.image_asset_id) return ctx.images.get(card.image_asset_id)
  // Same rule as a URL button: only an http(s) image is ever sent on.
  return card.image_url && isSendableUrl(card.image_url) ? card.image_url.trim() : undefined
}

export function resolveCards(
  cards: SavedCard[],
  ctx: ResolveContext,
): { elements: MessengerGenericElement[]; rendered: RenderedCard[] } {
  const elements: MessengerGenericElement[] = []
  const rendered: RenderedCard[] = []
  for (const card of cards.slice(0, CARDS_MAX)) {
    const title = renderWith(ctx, card.title).trim().slice(0, CARD_TITLE_MAX)
    // Messenger rejects the whole template if any card has no title.
    if (!title) continue
    const { specs, rendered: buttons } = resolveButtons(card.buttons, ctx)
    const subtitle = card.subtitle
      ? renderWith(ctx, card.subtitle).trim().slice(0, CARD_SUBTITLE_MAX) || undefined
      : undefined
    const imageUrl = cardImageUrl(card, ctx)
    // Tapping the card body itself opens its first link, which is what people
    // expect from a card and costs nothing when the card has no link at all.
    const firstLink = specs.find((spec) => 'url' in spec) as { url: string } | undefined
    elements.push({
      title,
      ...(subtitle ? { subtitle } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      ...(firstLink ? { defaultActionUrl: firstLink.url } : {}),
      ...(specs.length ? { buttons: specs } : {}),
    })
    rendered.push({
      title,
      ...(subtitle ? { subtitle } : {}),
      ...(imageUrl ? { image_url: imageUrl } : {}),
      ...(buttons.length ? { buttons } : {}),
    })
  }
  return { elements, rendered }
}

export interface ResolvedSavedMessage {
  payload: OutboundPayload
  /** What the inbox timeline shows as the message text. */
  body: string
  rendered: { buttons?: RenderedButton[]; cards?: RenderedCard[] }
}

/** Preview line for a card message, which has no text body of its own. */
function cardsBody(cards: RenderedCard[]): string {
  const first = cards[0]?.title
  if (!first) return 'Card message'
  return cards.length > 1 ? `${first} (+${cards.length - 1} more)` : first
}

/**
 * Build the outbound payload for a saved message. Layouts degrade downward
 * rather than failing: a card message whose cards all vanished, or a button
 * message left with no resolvable buttons, still goes out as plain text.
 */
export function resolveSavedMessage(
  shape: SavedMessageShape,
  ctx: ResolveContext,
): ResolvedSavedMessage {
  const text = renderWith(ctx, shape.body).trim().slice(0, textMaxFor(shape.layout))

  if (usesCards(shape.layout)) {
    const { elements, rendered } = resolveCards(shape.cards, ctx)
    if (elements.length > 0) {
      return {
        payload: { kind: 'generic_template', elements },
        body: cardsBody(rendered),
        rendered: { cards: rendered },
      }
    }
    const fallback = text || cardsBody(rendered)
    return { payload: { kind: 'text', text: fallback }, body: fallback, rendered: {} }
  }

  if (shape.layout === 'buttons') {
    const { specs, rendered } = resolveButtons(shape.buttons, ctx)
    if (specs.length > 0) {
      return {
        payload: { kind: 'buttons', text, buttons: specs },
        body: text,
        rendered: { buttons: rendered },
      }
    }
  }

  return { payload: { kind: 'text', text }, body: text, rendered: {} }
}
