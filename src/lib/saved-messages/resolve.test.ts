import { beforeAll, describe, expect, test } from 'vitest'
import { SAY_POSTBACK_PREFIX, resolveButtons, resolveCards, resolveSavedMessage, type ResolveContext } from './resolve'
import type { SavedButton, SavedCard } from './template'

const PAGE_ID = 'p-1'
const PSID = 'psid-1'

beforeAll(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
})

function ctx(over: Partial<ResolveContext> = {}): ResolveContext {
  return {
    pages: new Map([['page-uuid', { slug: 'book-a-call', signing_secret: 'secret' }]]),
    images: new Map([['asset-uuid', 'https://signed.test/a.png?token=abc']]),
    psid: PSID,
    pageId: PAGE_ID,
    exp: 1800000000,
    ...over,
  }
}

const link: SavedButton = { type: 'url', label: 'See pricing', url: 'https://acme.test/pricing' }
const call: SavedButton = { type: 'phone', label: 'Call us', phone: '+63 917 123 4567' }
const ask: SavedButton = { type: 'postback', label: 'Yes', reply: "I'm interested" }
const page: SavedButton = { type: 'action_page', label: 'Book', action_page_id: 'page-uuid' }

describe('resolveButtons', () => {
  test('a link button passes its URL through', () => {
    const { specs, rendered } = resolveButtons([link], ctx())
    expect(specs).toEqual([{ title: 'See pricing', url: 'https://acme.test/pricing' }])
    expect(rendered).toEqual([{ label: 'See pricing', url: 'https://acme.test/pricing' }])
  })

  test('a phone button is stripped down to diallable digits', () => {
    const { specs } = resolveButtons([call], ctx())
    expect(specs).toEqual([{ title: 'Call us', phone: '+639171234567' }])
  })

  test('a bot-reply button carries the prefixed payload the webhook parses', () => {
    const { specs } = resolveButtons([ask], ctx())
    expect(specs).toEqual([{ title: 'Yes', postback: `${SAY_POSTBACK_PREFIX}:I'm interested` }])
  })

  test('an action-page button becomes a deeplink signed for this recipient', () => {
    const { specs } = resolveButtons([page], ctx())
    const url = (specs[0] as { url: string }).url
    expect(url).toContain('https://app.test/a/book-a-call?')
    expect(url).toContain(PSID)
  })

  test('drops an action-page button whose page is gone rather than failing', () => {
    const { specs, rendered } = resolveButtons([page, link], ctx({ pages: new Map() }))
    expect(specs).toEqual([{ title: 'See pricing', url: 'https://acme.test/pricing' }])
    expect(rendered).toHaveLength(1)
  })

  test('keeps only the first three buttons', () => {
    const { specs } = resolveButtons([link, call, ask, page], ctx())
    expect(specs).toHaveLength(3)
  })

  test('drops a button whose URL is not http(s), whatever the stored row says', () => {
    // Buttons are JSONB, so the editor's validation is not a guarantee.
    const hostile = { type: 'url', label: 'Tap me', url: 'javascript:alert(1)' } as SavedButton
    const { specs } = resolveButtons([hostile, link], ctx())
    expect(specs).toEqual([{ title: 'See pricing', url: 'https://acme.test/pricing' }])
  })

  test('drops a button with no label, no phone, or no reply', () => {
    const { specs } = resolveButtons(
      [
        { ...link, label: '   ' },
        { type: 'phone', label: 'Call', phone: '' },
        { type: 'postback', label: 'Ask', reply: '  ' },
      ],
      ctx(),
    )
    expect(specs).toEqual([])
  })

  test('truncates an over-long bot reply to fit the postback payload', () => {
    const { specs } = resolveButtons(
      [{ type: 'postback', label: 'Ask', reply: 'x'.repeat(2000) }],
      ctx(),
    )
    const payload = (specs[0] as { postback: string }).postback
    expect(payload.length).toBeLessThanOrEqual(1000)
  })

  test('trims a label past the 20-character limit', () => {
    const { specs } = resolveButtons([{ ...link, label: 'x'.repeat(30) }], ctx())
    expect(specs[0].title).toHaveLength(20)
  })
})

describe('resolveCards', () => {
  const base: SavedCard = { title: 'Studio unit', subtitle: 'Ready for turnover', buttons: [link] }

  test('signs a library image and keeps title, subtitle and buttons', () => {
    const { elements } = resolveCards([{ ...base, image_asset_id: 'asset-uuid' }], ctx())
    expect(elements[0]).toMatchObject({
      title: 'Studio unit',
      subtitle: 'Ready for turnover',
      imageUrl: 'https://signed.test/a.png?token=abc',
      buttons: [{ title: 'See pricing', url: 'https://acme.test/pricing' }],
    })
  })

  test('uses an external image URL as-is', () => {
    const { elements } = resolveCards([{ ...base, image_url: 'https://cdn.test/a.jpg' }], ctx())
    expect(elements[0].imageUrl).toBe('https://cdn.test/a.jpg')
  })

  test('sends the card without an image when the asset can no longer be signed', () => {
    const { elements } = resolveCards([{ ...base, image_asset_id: 'asset-uuid' }], ctx({ images: new Map() }))
    expect(elements[0].imageUrl).toBeUndefined()
    expect(elements[0].title).toBe('Studio unit')
  })

  test('makes the first link the card tap target', () => {
    const { elements } = resolveCards([{ ...base, buttons: [call, link] }], ctx())
    expect(elements[0].defaultActionUrl).toBe('https://acme.test/pricing')
  })

  test('leaves the tap target unset when no button opens a link', () => {
    const { elements } = resolveCards([{ ...base, buttons: [call] }], ctx())
    expect(elements[0].defaultActionUrl).toBeUndefined()
  })

  test('ignores a card image link that is not http(s)', () => {
    const { elements } = resolveCards([{ ...base, image_url: 'javascript:alert(1)' }], ctx())
    expect(elements[0].imageUrl).toBeUndefined()
  })

  test('skips a card with no title, which Messenger would reject outright', () => {
    const { elements } = resolveCards([{ ...base, title: '  ' }, base], ctx())
    expect(elements).toHaveLength(1)
  })

  test('keeps only the first ten cards', () => {
    const cards = Array.from({ length: 12 }, (_, i) => ({ ...base, title: `Card ${i}` }))
    expect(resolveCards(cards, ctx()).elements).toHaveLength(10)
  })
})

describe('merge tags', () => {
  const render = (text: string) => text.replace('[first_name]', 'Juan')

  test('renders tags in the text body', () => {
    const out = resolveSavedMessage(
      { layout: 'text', body: 'Hi [first_name]!', buttons: [], cards: [] },
      ctx({ render }),
    )
    expect(out.body).toBe('Hi Juan!')
  })

  test('renders tags in card titles and subtitles', () => {
    const cards: SavedCard[] = [{ title: '[first_name], look', subtitle: 'For [first_name]', buttons: [] }]
    const { elements } = resolveCards(cards, ctx({ render }))
    expect(elements[0].title).toBe('Juan, look')
    expect(elements[0].subtitle).toBe('For Juan')
  })

  test('leaves text alone when no renderer is supplied', () => {
    const out = resolveSavedMessage({ layout: 'text', body: 'Hi [first_name]!', buttons: [], cards: [] }, ctx())
    expect(out.body).toBe('Hi [first_name]!')
  })
})

describe('resolveSavedMessage', () => {
  test('a text layout sends a plain text payload', () => {
    const out = resolveSavedMessage({ layout: 'text', body: 'Hello there', buttons: [], cards: [] }, ctx())
    expect(out.payload).toEqual({ kind: 'text', text: 'Hello there' })
    expect(out.body).toBe('Hello there')
    expect(out.rendered).toEqual({})
  })

  test('a buttons layout sends a button template and records the labels', () => {
    const out = resolveSavedMessage({ layout: 'buttons', body: 'Pick one', buttons: [link, call], cards: [] }, ctx())
    expect(out.payload).toMatchObject({ kind: 'buttons', text: 'Pick one' })
    expect(out.rendered.buttons?.map((b) => b.label)).toEqual(['See pricing', 'Call us'])
  })

  test('a buttons layout whose only button is gone falls back to plain text', () => {
    const out = resolveSavedMessage(
      { layout: 'buttons', body: 'Pick one', buttons: [page], cards: [] },
      ctx({ pages: new Map() }),
    )
    expect(out.payload).toEqual({ kind: 'text', text: 'Pick one' })
  })

  test('a buttons layout trims its text to the template limit', () => {
    const body = 'x'.repeat(700)
    const out = resolveSavedMessage({ layout: 'buttons', body, buttons: [link], cards: [] }, ctx())
    expect((out.payload as { text: string }).text).toHaveLength(640)
  })

  test('a card layout sends a generic template and previews the card title', () => {
    const cards: SavedCard[] = [{ title: 'Studio unit', buttons: [link] }]
    const out = resolveSavedMessage({ layout: 'card', body: '', buttons: [], cards }, ctx())
    expect(out.payload).toMatchObject({ kind: 'generic_template' })
    expect(out.body).toBe('Studio unit')
    expect(out.rendered.cards).toHaveLength(1)
  })

  test('a carousel preview counts the cards beyond the first', () => {
    const cards: SavedCard[] = [
      { title: 'Studio unit', buttons: [] },
      { title: 'One bedroom', buttons: [] },
      { title: 'Two bedroom', buttons: [] },
    ]
    const out = resolveSavedMessage({ layout: 'carousel', body: '', buttons: [], cards }, ctx())
    expect(out.body).toBe('Studio unit (+2 more)')
  })
})
