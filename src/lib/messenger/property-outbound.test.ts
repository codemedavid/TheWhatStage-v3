import { describe, expect, it } from 'vitest'
import { vi, beforeEach } from 'vitest'
import { buildRealestateCarouselElements } from './property-outbound'
import { sendPropertyRecommendation } from './property-outbound'
import * as outbound from '@/lib/messenger/outbound'
import type { RealestateProperty } from '@/app/a/[slug]/_kinds/realestate/schema'

vi.mock('@/lib/messenger/outbound', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/messenger/outbound')>()
  return { ...actual, sendOutbound: vi.fn() }
})
vi.mock('@/lib/action-pages/urls', () => ({
  deeplinkActionPageUrl: vi.fn(() => 'https://example.com/a/realestate?sig=signed'),
}))

function prop(overrides: Partial<RealestateProperty> & { id: string }): RealestateProperty {
  return {
    id: overrides.id,
    title: overrides.title ?? 'Sample Home',
    status: overrides.status ?? 'for_sale',
    price: overrides.price ?? {
      amount: 5_000_000,
      currency: 'PHP',
      period: null,
      display_label: 'PHP 5,000,000',
    },
    gallery: overrides.gallery ?? [],
    address: overrides.address ?? {
      line1: '',
      line2: '',
      city: 'Cebu City',
      region: 'Cebu',
      postal: '',
      country: '',
    },
    description: overrides.description ?? '',
    specs: overrides.specs ?? {
      property_type: null,
      beds: null,
      baths: null,
      floor_area: null,
      lot_area: null,
      year_built: null,
      parking: null,
    },
    custom_specs: overrides.custom_specs ?? [],
    amenities: overrides.amenities ?? [],
    financing_options: overrides.financing_options ?? [],
    financing_notes: overrides.financing_notes ?? '',
  }
}

describe('buildRealestateCarouselElements', () => {
  const base = 'https://example.com/a/realestate-page?sig=abc'

  it('caps the output at 10 elements', () => {
    const props = Array.from({ length: 15 }, (_, i) => prop({ id: `p${i}`, title: `Home ${i}` }))
    const out = buildRealestateCarouselElements(props, base, 'View all')
    expect(out).toHaveLength(10)
  })

  it('filters out non-active statuses (sold/reserved/draft)', () => {
    const props = [
      prop({ id: 'a', title: 'Active', status: 'for_sale' }),
      prop({ id: 'b', title: 'Sold', status: 'sold' }),
      prop({ id: 'c', title: 'Reserved', status: 'reserved' }),
      prop({ id: 'd', title: 'Draft', status: 'draft' }),
      prop({ id: 'e', title: 'Rent', status: 'for_rent' }),
    ]
    const out = buildRealestateCarouselElements(props, base, 'View all')
    expect(out.map((e) => e.title)).toEqual(['Active', 'Rent'])
  })

  it('drops empty-title properties', () => {
    const props = [prop({ id: 'a', title: '   ' }), prop({ id: 'b', title: 'Real Home' })]
    const out = buildRealestateCarouselElements(props, base, 'View all')
    expect(out.map((e) => e.title)).toEqual(['Real Home'])
  })

  it('subtitle is "price · City, Region", drops missing parts', () => {
    const out = buildRealestateCarouselElements(
      [
        prop({
          id: 'a',
          title: 'Home',
          price: { amount: null, currency: 'PHP', period: null, display_label: 'PHP 5M' },
          address: { line1: '', line2: '', city: 'Cebu City', region: 'Cebu', postal: '', country: '' },
        }),
      ],
      base,
      'View all',
    )
    expect(out[0].subtitle).toBe('PHP 5M · Cebu City, Cebu')
  })

  it('subtitle drops the address segment when both city and region are empty', () => {
    const out = buildRealestateCarouselElements(
      [
        prop({
          id: 'a',
          title: 'Home',
          price: { amount: null, currency: 'PHP', period: null, display_label: 'PHP 5M' },
          address: { line1: '', line2: '', city: '', region: '', postal: '', country: '' },
        }),
      ],
      base,
      'View all',
    )
    expect(out[0].subtitle).toBe('PHP 5M')
  })

  it('picks the gallery image marked primary, falls back to the first', () => {
    const out = buildRealestateCarouselElements(
      [
        prop({
          id: 'a',
          title: 'Home',
          gallery: [
            { id: 'g1', fileId: 'f1', url: 'https://i/1.jpg', alt: '', position: 0, primary: false },
            { id: 'g2', fileId: 'f2', url: 'https://i/2.jpg', alt: '', position: 1, primary: true },
          ],
        }),
      ],
      base,
      'View all',
    )
    expect(out[0].imageUrl).toBe('https://i/2.jpg')
  })

  it('falls back to first gallery image when none is marked primary', () => {
    const out = buildRealestateCarouselElements(
      [
        prop({
          id: 'a',
          title: 'Home',
          gallery: [
            { id: 'g1', fileId: 'f1', url: 'https://i/1.jpg', alt: '', position: 0, primary: false },
          ],
        }),
      ],
      base,
      'View all',
    )
    expect(out[0].imageUrl).toBe('https://i/1.jpg')
  })

  it('omits image when gallery is empty', () => {
    const out = buildRealestateCarouselElements(
      [prop({ id: 'a', title: 'Home', gallery: [] })],
      base,
      'View all',
    )
    expect(out[0].imageUrl).toBeUndefined()
  })

  it('attaches View property + secondary CTA buttons; per-card deeplink has ?property=<slug>', () => {
    const out = buildRealestateCarouselElements(
      [prop({ id: 'abc-123', title: 'Home' })],
      'https://example.com/a/page?sig=abc',
      'View all listings',
    )
    expect(out[0].buttons).toEqual([
      { title: 'View property', url: 'https://example.com/a/page?sig=abc&property=p-abc-123' },
      { title: 'View all listings', url: 'https://example.com/a/page?sig=abc' },
    ])
    expect(out[0].defaultActionUrl).toBe('https://example.com/a/page?sig=abc&property=p-abc-123')
  })

  it('uses ? when the base URL has no query string', () => {
    const out = buildRealestateCarouselElements(
      [prop({ id: 'abc', title: 'Home' })],
      'https://example.com/a/page',
      'View all',
    )
    expect(out[0].defaultActionUrl).toBe('https://example.com/a/page?property=p-abc')
  })

  it('truncates title and subtitle to Messenger limits', () => {
    const longTitle = 'X'.repeat(120)
    const longCity = 'C'.repeat(120)
    const out = buildRealestateCarouselElements(
      [
        prop({
          id: 'a',
          title: longTitle,
          price: { amount: null, currency: 'PHP', period: null, display_label: 'PHP 1' },
          address: { line1: '', line2: '', city: longCity, region: '', postal: '', country: '' },
        }),
      ],
      'https://example.com/a/page',
      'View all',
    )
    expect(out[0].title.length).toBeLessThanOrEqual(80)
    expect(out[0].subtitle!.length).toBeLessThanOrEqual(80)
  })
})

const FAKE_ADMIN = {} as Parameters<typeof sendPropertyRecommendation>[0]['admin']
const THREAD = { id: 'thread-1', psid: 'PSID-1', last_inbound_at: '2026-05-09T12:00:00Z' }
const PAGE = { id: 'page-1', slug: 'my-realestate', signing_secret: 'secret' }

function makeProperty(over: Partial<Parameters<typeof sendPropertyRecommendation>[0]['property']> = {}) {
  return {
    id: 'item-1',
    slug: 'p-abc-123',
    title: 'Sunny 3BR House',
    price_label: 'PHP 5,000,000',
    cover_image_url: 'https://i/cover.jpg',
    city: 'Cebu City',
    region: 'Cebu',
    ...over,
  }
}

describe('sendPropertyRecommendation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends image first, then a single-element generic template with View + Inquire buttons', async () => {
    const sendOutbound = vi.mocked(outbound.sendOutbound)
    sendOutbound.mockResolvedValueOnce({ sent: true, messageId: 'mid-img' })
    sendOutbound.mockResolvedValueOnce({ sent: true, messageId: 'mid-card' })

    const res = await sendPropertyRecommendation({
      admin: FAKE_ADMIN,
      thread: THREAD,
      pageToken: 'pat',
      facebookPageId: 'fbpage1',
      page: PAGE,
      property: makeProperty(),
      confidence: 0.8,
      caption: 'Got one for you 👇',
    })

    expect(sendOutbound).toHaveBeenNthCalledWith(1, expect.objectContaining({
      payload: { kind: 'image', imageUrl: 'https://i/cover.jpg' },
    }))
    const cardCall = sendOutbound.mock.calls[1][0]
    expect(cardCall.payload.kind).toBe('generic_template')
    const elements = (cardCall.payload as Extract<typeof cardCall.payload, { kind: 'generic_template' }>).elements
    expect(elements).toHaveLength(1)
    expect(elements[0].title).toBe('Sunny 3BR House')
    expect(elements[0].buttons).toEqual([
      { title: 'View property', url: 'https://example.com/a/realestate?sig=signed&property=p-abc-123' },
      { title: 'Inquire', postback: 'rec_inquire:p-abc-123' },
    ])
    expect(res).toEqual({
      sent: true,
      messageIds: ['mid-img', 'mid-card'],
      imageSent: true,
      deeplinkUrl: 'https://example.com/a/realestate?sig=signed&property=p-abc-123',
    })
  })

  it('skips image when cover_image_url is null', async () => {
    const sendOutbound = vi.mocked(outbound.sendOutbound)
    sendOutbound.mockResolvedValueOnce({ sent: true, messageId: 'mid-card' })

    const res = await sendPropertyRecommendation({
      admin: FAKE_ADMIN,
      thread: THREAD,
      pageToken: 'pat',
      facebookPageId: 'fbpage1',
      page: PAGE,
      property: makeProperty({ cover_image_url: null }),
      confidence: 0.8,
    })

    expect(sendOutbound).toHaveBeenCalledTimes(1)
    expect(sendOutbound.mock.calls[0][0].payload.kind).toBe('generic_template')
    expect(res.sent).toBe(true)
    expect(res.imageSent).toBe(false)
  })

  it('returns sent:false when image send is policy-blocked (no follow-up)', async () => {
    const sendOutbound = vi.mocked(outbound.sendOutbound)
    sendOutbound.mockResolvedValueOnce({ sent: false, reason: 'window' })

    const res = await sendPropertyRecommendation({
      admin: FAKE_ADMIN,
      thread: THREAD,
      pageToken: 'pat',
      facebookPageId: 'fbpage1',
      page: PAGE,
      property: makeProperty(),
      confidence: 0.8,
    })

    expect(sendOutbound).toHaveBeenCalledTimes(1)
    expect(res).toMatchObject({ sent: false, imageSent: false, messageIds: [], reason: 'window' })
  })

  it('image succeeds, card blocked → reports partial send', async () => {
    const sendOutbound = vi.mocked(outbound.sendOutbound)
    sendOutbound.mockResolvedValueOnce({ sent: true, messageId: 'mid-img' })
    sendOutbound.mockResolvedValueOnce({ sent: false, reason: 'window' })

    const res = await sendPropertyRecommendation({
      admin: FAKE_ADMIN,
      thread: THREAD,
      pageToken: 'pat',
      facebookPageId: 'fbpage1',
      page: PAGE,
      property: makeProperty(),
      confidence: 0.8,
    })

    expect(res).toMatchObject({ sent: true, imageSent: true, messageIds: ['mid-img'], reason: 'window' })
  })
})
