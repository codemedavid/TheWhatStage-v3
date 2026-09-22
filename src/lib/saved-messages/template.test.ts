import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  BUTTON_TEXT_MAX,
  REPLY_MAX,
  describeLayout,
  emptyButton,
  isSendablePhone,
  isSendableUrl,
  maxCardsFor,
  textMaxFor,
  validateButton,
  validateCard,
  validateSavedMessage,
  type SavedButton,
  type SavedCard,
} from './template'

const urlButton: SavedButton = { type: 'url', label: 'See pricing', url: 'https://acme.test/pricing' }

function card(over: Partial<SavedCard> = {}): SavedCard {
  return { title: 'Studio unit', buttons: [urlButton], ...over }
}

describe('isSendableUrl', () => {
  test('accepts http and https links', () => {
    expect(isSendableUrl('https://acme.test/a')).toBe(true)
    expect(isSendableUrl('  http://acme.test  ')).toBe(true)
  })

  test('rejects other schemes and junk', () => {
    expect(isSendableUrl('javascript:alert(1)')).toBe(false)
    expect(isSendableUrl('acme.test')).toBe(false)
    expect(isSendableUrl('')).toBe(false)
  })
})

describe('isSendablePhone', () => {
  test('accepts an international number with separators', () => {
    expect(isSendablePhone('+63 917 123 4567')).toBe(true)
    expect(isSendablePhone('(02) 8123-4567')).toBe(true)
  })

  test('rejects text and numbers that are too short', () => {
    expect(isSendablePhone('call me')).toBe(false)
    expect(isSendablePhone('12345')).toBe(false)
  })
})

describe('validateButton', () => {
  test('returns null for a well-formed button of every action', () => {
    expect(validateButton(urlButton)).toBeNull()
    expect(validateButton({ type: 'action_page', label: 'Book', action_page_id: 'a-uuid' })).toBeNull()
    expect(validateButton({ type: 'phone', label: 'Call us', phone: '+639171234567' })).toBeNull()
    expect(validateButton({ type: 'postback', label: 'Yes', reply: "I'm interested" })).toBeNull()
  })

  test('requires a label', () => {
    expect(validateButton({ ...urlButton, label: '  ' })).toMatch(/label/i)
  })

  test('caps the label at 20 characters', () => {
    expect(validateButton({ ...urlButton, label: 'x'.repeat(21) })).toMatch(/20 characters/)
  })

  test('requires each action to carry its own target', () => {
    expect(validateButton({ type: 'url', label: 'Go', url: 'nope' })).toMatch(/http/)
    expect(validateButton({ type: 'action_page', label: 'Go', action_page_id: '' })).toMatch(/action page/i)
    expect(validateButton({ type: 'phone', label: 'Go', phone: 'abc' })).toMatch(/phone number/i)
    expect(validateButton({ type: 'postback', label: 'Go', reply: '' })).toMatch(/bot/i)
  })

  test('caps a postback reply inside the payload limit', () => {
    const problem = validateButton({ type: 'postback', label: 'Go', reply: 'x'.repeat(REPLY_MAX + 1) })
    expect(problem).toMatch(new RegExp(String(REPLY_MAX)))
  })

  test('emptyButton produces a button of the requested action', () => {
    expect(emptyButton('phone')).toEqual({ type: 'phone', label: '', phone: '' })
  })
})

describe('validateCard', () => {
  test('accepts a card with a title and a valid button', () => {
    expect(validateCard(card())).toBeNull()
  })

  test('accepts a card with no buttons at all', () => {
    expect(validateCard(card({ buttons: [] }))).toBeNull()
  })

  test('requires a title', () => {
    expect(validateCard(card({ title: ' ' }))).toMatch(/title/i)
  })

  test('rejects an image link that is not http(s)', () => {
    expect(validateCard(card({ image_url: 'ftp://acme.test/a.png' }))).toMatch(/image link/i)
  })

  test('surfaces a bad button inside the card', () => {
    expect(validateCard(card({ buttons: [{ ...urlButton, url: '' }] }))).toMatch(/http/)
  })
})

describe('validateSavedMessage', () => {
  test('a plain text message needs only a body', () => {
    expect(validateSavedMessage({ layout: 'text', body: 'Hello', buttons: [], cards: [] })).toBeNull()
  })

  test('rejects an empty body', () => {
    expect(validateSavedMessage({ layout: 'text', body: '   ', buttons: [], cards: [] })).toMatch(/message/i)
  })

  test('allows a plain message up to 2000 characters', () => {
    const shape = { layout: 'text' as const, body: 'x'.repeat(2000), buttons: [], cards: [] }
    expect(validateSavedMessage(shape)).toBeNull()
  })

  test('caps a button message at the button template limit', () => {
    const shape = {
      layout: 'buttons' as const,
      body: 'x'.repeat(BUTTON_TEXT_MAX + 1),
      buttons: [urlButton],
      cards: [],
    }
    expect(validateSavedMessage(shape)).toMatch(new RegExp(String(BUTTON_TEXT_MAX)))
  })

  test('a button layout with no buttons is not sendable', () => {
    expect(validateSavedMessage({ layout: 'buttons', body: 'Hi', buttons: [], cards: [] })).toMatch(/button/i)
  })

  test('rejects more than three buttons', () => {
    const shape = {
      layout: 'buttons' as const,
      body: 'Hi',
      buttons: [urlButton, urlButton, urlButton, urlButton],
      cards: [],
    }
    expect(validateSavedMessage(shape)).toMatch(/at most 3/)
  })

  test('a card layout needs a card, and holds only one', () => {
    expect(validateSavedMessage({ layout: 'card', body: '', buttons: [], cards: [] })).toMatch(/card/i)
    expect(
      validateSavedMessage({ layout: 'card', body: '', buttons: [], cards: [card(), card()] }),
    ).toMatch(/one card/)
  })

  test('a carousel holds at most ten cards', () => {
    const cards = Array.from({ length: 11 }, () => card())
    expect(validateSavedMessage({ layout: 'carousel', body: '', buttons: [], cards })).toMatch(/at most 10/)
  })

  test('a card layout ignores an empty body', () => {
    expect(validateSavedMessage({ layout: 'card', body: '', buttons: [], cards: [card()] })).toBeNull()
  })
})

describe('layout helpers', () => {
  test('textMaxFor drops to the template cap only for buttons', () => {
    expect(textMaxFor('text')).toBe(2000)
    expect(textMaxFor('buttons')).toBe(BUTTON_TEXT_MAX)
  })

  test('maxCardsFor allows one card and ten carousel cards', () => {
    expect(maxCardsFor('card')).toBe(1)
    expect(maxCardsFor('carousel')).toBe(10)
  })

  test('describeLayout names what the operator built', () => {
    expect(describeLayout({ layout: 'text', buttons: [], cards: [] })).toBe('Text')
    expect(describeLayout({ layout: 'buttons', buttons: [urlButton], cards: [] })).toBe('1 button')
    expect(describeLayout({ layout: 'buttons', buttons: [urlButton, urlButton], cards: [] })).toBe('2 buttons')
    expect(describeLayout({ layout: 'carousel', buttons: [], cards: [card(), card()] })).toBe('2 cards')
  })
})

describe('the Expo mirror', () => {
  // The Expo app is a separate package and cannot import this module, so it
  // keeps a copy. Only the header comment (which points at the other file) may
  // differ — everything from the first export down has to be identical, or the
  // editor and the send path will disagree about what is sendable.
  const body = (path: string) => {
    const source = readFileSync(join(process.cwd(), path), 'utf8')
    const start = source.indexOf('export const SAVED_LAYOUTS')
    expect(start, `${path} is missing its first export`).toBeGreaterThan(-1)
    return source.slice(start)
  }

  test('matches src/lib/saved-messages/template.ts', () => {
    expect(body('mobile/src/lib/saved-message-template.ts')).toBe(
      body('src/lib/saved-messages/template.ts'),
    )
  })
})
