// The shape of a saved message, shared by the editor, the DB row and the send
// path. A saved message is one of four Messenger layouts:
//
//   text     — a plain message bubble (the original saved-reply behaviour)
//   buttons  — a button template: text plus 1-3 tappable buttons
//   card     — a generic template with one card: image, title, subtitle, buttons
//   carousel — the same generic template with up to 10 swipeable cards
//
// Every limit below is Meta's, not ours; the editor enforces them so an
// operator finds out before saving rather than when a send fails.
//
// NOTE: this module is mirrored, deliberately and in full, at
// mobile/src/lib/saved-message-template.ts — the Expo app is a separate package
// that cannot import from this one. Keep the two in sync.

export const SAVED_LAYOUTS = ['text', 'buttons', 'card', 'carousel'] as const
export type SavedLayout = (typeof SAVED_LAYOUTS)[number]

export const BUTTON_ACTIONS = ['url', 'action_page', 'phone', 'postback'] as const
export type SavedButtonAction = (typeof BUTTON_ACTIONS)[number]

/** A tappable Messenger button. Stored as JSONB exactly as written here. */
export type SavedButton =
  /** Opens any URL in the Messenger webview. */
  | { type: 'url'; label: string; url: string }
  /** Opens one of the operator's published action pages, signed per recipient. */
  | { type: 'action_page'; label: string; action_page_id: string }
  /** Dials a number from the customer's phone. */
  | { type: 'phone'; label: string; phone: string }
  /**
   * Posts `reply` back to our webhook as if the customer had typed it, so the
   * bot answers. See src/app/api/webhooks/facebook/_postback.ts.
   */
  | { type: 'postback'; label: string; reply: string }

/** One generic-template card. Exactly one image source, or none. */
export interface SavedCard {
  title: string
  subtitle?: string
  /** Media-library asset; signed fresh at send time (signed URLs expire). */
  image_asset_id?: string
  /** An externally hosted image, used verbatim. */
  image_url?: string
  buttons: SavedButton[]
}

// --- Meta's limits -------------------------------------------------------
export const TITLE_MAX = 80
/** A plain text bubble. */
export const TEXT_MAX = 2000
/** The button template's text field caps far lower than a plain message. */
export const BUTTON_TEXT_MAX = 640
export const LABEL_MAX = 20
export const CARD_TITLE_MAX = 80
export const CARD_SUBTITLE_MAX = 80
export const BUTTONS_MAX = 3
export const CARDS_MAX = 10
/**
 * A postback payload caps at 1000 bytes and ours carries a short prefix, so the
 * reply text is capped well inside that.
 */
export const REPLY_MAX = 900

/** The longest body this layout's text field can hold. */
export function textMaxFor(layout: SavedLayout): number {
  return layout === 'buttons' ? BUTTON_TEXT_MAX : TEXT_MAX
}

/** True when the layout puts its content in cards rather than a text body. */
export function usesCards(layout: SavedLayout): boolean {
  return layout === 'card' || layout === 'carousel'
}

export function maxCardsFor(layout: SavedLayout): number {
  return layout === 'carousel' ? CARDS_MAX : 1
}

export function emptyCard(): SavedCard {
  return { title: '', buttons: [] }
}

export function emptyButton(type: SavedButtonAction): SavedButton {
  switch (type) {
    case 'url':
      return { type: 'url', label: '', url: '' }
    case 'action_page':
      return { type: 'action_page', label: '', action_page_id: '' }
    case 'phone':
      return { type: 'phone', label: '', phone: '' }
    case 'postback':
      return { type: 'postback', label: '', reply: '' }
  }
}

// --- Validation ----------------------------------------------------------
// One shared validator so the editor's inline errors and the server's boundary
// check can never disagree about what is sendable.

/** Meta only opens http(s) links; anything else silently fails on tap. */
export function isSendableUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const PHONE_DIGITS_MIN = 6
const PHONE_DIGITS_MAX = 20

/** Digits, optionally grouped with the usual separators and a leading +. */
export function isSendablePhone(raw: string): boolean {
  const trimmed = raw.trim()
  if (!/^\+?[0-9()\s.-]+$/.test(trimmed)) return false
  const digits = trimmed.replace(/\D/g, '')
  return digits.length >= PHONE_DIGITS_MIN && digits.length <= PHONE_DIGITS_MAX
}

/** Human-readable problem with one button, or null when it is sendable. */
export function validateButton(button: SavedButton): string | null {
  const label = button.label.trim()
  if (!label) return 'Every button needs a label.'
  if (label.length > LABEL_MAX) return `Button labels are capped at ${LABEL_MAX} characters.`
  switch (button.type) {
    case 'url':
      return isSendableUrl(button.url) ? null : 'Enter a link starting with http:// or https://.'
    case 'action_page':
      return button.action_page_id ? null : 'Pick the action page this button opens.'
    case 'phone':
      return isSendablePhone(button.phone) ? null : 'Enter a phone number, e.g. +639171234567.'
    case 'postback':
      if (!button.reply.trim()) return 'Say what this button should tell the bot.'
      return button.reply.trim().length > REPLY_MAX
        ? `The bot reply is capped at ${REPLY_MAX} characters.`
        : null
  }
}

export function validateButtons(buttons: SavedButton[]): string | null {
  if (buttons.length > BUTTONS_MAX) return `A message can carry at most ${BUTTONS_MAX} buttons.`
  for (const button of buttons) {
    const problem = validateButton(button)
    if (problem) return problem
  }
  return null
}

export function validateCard(card: SavedCard): string | null {
  if (!card.title.trim()) return 'Every card needs a title.'
  if (card.title.trim().length > CARD_TITLE_MAX) {
    return `Card titles are capped at ${CARD_TITLE_MAX} characters.`
  }
  if ((card.subtitle?.trim().length ?? 0) > CARD_SUBTITLE_MAX) {
    return `Card subtitles are capped at ${CARD_SUBTITLE_MAX} characters.`
  }
  if (card.image_url && !isSendableUrl(card.image_url)) {
    return 'Enter an image link starting with http:// or https://.'
  }
  return validateButtons(card.buttons)
}

export interface SavedMessageShape {
  layout: SavedLayout
  body: string
  buttons: SavedButton[]
  cards: SavedCard[]
}

/**
 * The single answer to "can this be sent?". Returns the first problem in the
 * order an operator reads the editor, or null when the message is sendable.
 */
export function validateSavedMessage(shape: SavedMessageShape): string | null {
  const { layout } = shape
  if (usesCards(layout)) {
    if (shape.cards.length === 0) return 'Add at least one card.'
    const max = maxCardsFor(layout)
    if (shape.cards.length > max) {
      return max === 1 ? 'A card message holds one card.' : `A carousel holds at most ${max} cards.`
    }
    for (const card of shape.cards) {
      const problem = validateCard(card)
      if (problem) return problem
    }
    return null
  }

  const body = shape.body.trim()
  if (!body) return 'Add a message.'
  const max = textMaxFor(layout)
  if (body.length > max) return `A message with buttons is capped at ${max} characters by Messenger.`
  if (layout !== 'buttons') return null
  if (shape.buttons.length === 0) return 'Add at least one button, or switch back to a plain message.'
  return validateButtons(shape.buttons)
}

/** Short description of a layout for lists and chips. */
export function describeLayout(shape: Pick<SavedMessageShape, 'layout' | 'buttons' | 'cards'>): string {
  switch (shape.layout) {
    case 'text':
      return 'Text'
    case 'buttons':
      return shape.buttons.length === 1 ? '1 button' : `${shape.buttons.length} buttons`
    case 'card':
      return 'Card'
    case 'carousel':
      return `${shape.cards.length} cards`
  }
}
