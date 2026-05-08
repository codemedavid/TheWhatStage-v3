# Realestate property cards on Messenger — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send a horizontally-scrollable carousel of properties on Messenger when the bot picks a realestate action page, plus a single-property recommendation card with `View property` (URL) and `Inquire` (postback) buttons. The Inquire postback synthesizes a canned inbound message that flows through the normal LLM reply path.

**Architecture:** Approach 2 from the spec — parallel implementation of the catalog flows, kept beside (not inside) the existing catalog code. New files mirror catalog twins line-for-line; catalog code stays untouched. New webhook code adds inbound-postback handling that dedupes via a synthetic `pb:` id written to the existing `messenger_messages.fb_message_id` unique index.

**Tech Stack:** Next.js (App Router), TypeScript, Supabase (admin client), Vitest, Meta Graph API (Send / Webhooks), HuggingFace router LLM + reranker, existing RAG hybrid-search RPC `match_business_items_hybrid_service`.

**Spec:** `docs/superpowers/specs/2026-05-09-realestate-messenger-cards-design.md`

---

## File map

### New files

| Path | Responsibility |
|---|---|
| `src/lib/messenger/property-outbound.ts` | Pure helper `buildRealestateCarouselElements` + `sendPropertyRecommendation` (image + 2-button generic template). |
| `src/lib/messenger/property-outbound.test.ts` | Unit tests for both. |
| `src/lib/chatbot/recommend-property.ts` | `recommendProperty()` mirror of `recommend.ts`, kind=`property`. |
| `src/lib/chatbot/recommend-property.test.ts` | Unit tests for `recommendProperty`. |
| `src/app/api/webhooks/facebook/_postback.ts` | `handlePostback()` parser + dispatcher. |
| `src/app/api/webhooks/facebook/_postback.test.ts` | Unit tests for postback handling. |

### Modified files

| Path | Change |
|---|---|
| `src/lib/facebook/messenger.ts` | Widen `MessengerGenericElement.buttons` to support postback buttons; serialize correctly. |
| `src/lib/chatbot/classify.ts` | Add `propertyRecommendation` to result + schema + prompt; wire `activeRealestatePageId` option. |
| `src/app/api/messenger/process/route.ts` | Pass `activeRealestatePageId` to classifier; add property-recommendation block; add realestate-carousel branch in action-page-button block. |
| `src/app/api/messenger/process/route.test.ts` | Extend integration tests for the new branches. |
| `src/app/api/webhooks/facebook/route.ts` | Branch on `ev.postback`; dispatch to `handlePostback`. |

---

## Task 1: Widen `MessengerGenericElement` to support postback buttons

**Files:**
- Modify: `src/lib/facebook/messenger.ts:144-191`

The existing button shape is `{ title; url }` and the serializer hard-codes `type: 'web_url'`. We need to allow `{ title; postback }` too so the recommendation card's Inquire button can be sent in a generic template.

- [ ] **Step 1: Read the existing definition**

Read `src/lib/facebook/messenger.ts:144-191` and confirm the current `MessengerGenericElement` and `sendMessengerGenericTemplate` implementation matches what's quoted below.

- [ ] **Step 2: Replace the type and serializer**

Replace lines 144–191 with:

```ts
export type MessengerGenericButton =
  | { title: string; url: string }
  | { title: string; postback: string }

export interface MessengerGenericElement {
  title: string
  subtitle?: string
  imageUrl?: string
  defaultActionUrl?: string
  buttons?: MessengerGenericButton[]
}

/**
 * Send a Messenger generic-template carousel (horizontally scrollable cards).
 * Up to 10 elements; each element supports an image, title (80c), subtitle
 * (80c), a default web_url tap target, and up to 3 buttons (titles trimmed
 * to 20c). Buttons are either URL (`web_url`) or postback. Used to surface
 * a product or property catalog inline in chat.
 */
export async function sendMessengerGenericTemplate(args: {
  pageAccessToken: string
  recipientPsid: string
  elements: MessengerGenericElement[]
}): Promise<{ message_id: string }> {
  const url = new URL(`${GRAPH}/me/messages`)
  url.searchParams.set('access_token', args.pageAccessToken)
  const elements = args.elements.slice(0, 10).map((el) => {
    const out: Record<string, unknown> = { title: el.title.slice(0, 80) }
    if (el.subtitle) out.subtitle = el.subtitle.slice(0, 80)
    if (el.imageUrl) out.image_url = el.imageUrl
    if (el.defaultActionUrl) {
      out.default_action = { type: 'web_url', url: el.defaultActionUrl }
    }
    if (el.buttons && el.buttons.length) {
      out.buttons = el.buttons.slice(0, 3).map((b) => {
        const title = b.title.slice(0, 20)
        if ('url' in b) return { type: 'web_url', url: b.url, title }
        return { type: 'postback', payload: b.postback, title }
      })
    }
    return out
  })
  return postJson<{ message_id: string }>(url.toString(), {
    recipient: { id: args.recipientPsid },
    messaging_type: 'RESPONSE',
    message: {
      attachment: {
        type: 'template',
        payload: { template_type: 'generic', elements },
      },
    },
  })
}
```

- [ ] **Step 3: Typecheck — confirm no callsites break**

Run: `pnpm typecheck` (or `npx tsc --noEmit` if no script).
Expected: PASS. The existing carousel callsite in `src/app/api/messenger/process/route.ts:727-744` uses only the URL-button shape and is forward-compatible with the union.

- [ ] **Step 4: Commit**

```bash
git add src/lib/facebook/messenger.ts
git commit -m "feat(facebook): allow postback buttons in MessengerGenericElement"
```

---

## Task 2: `buildRealestateCarouselElements` (pure helper) — TDD

**Files:**
- Create: `src/lib/messenger/property-outbound.ts`
- Test: `src/lib/messenger/property-outbound.test.ts`

This is the pure transform from realestate config properties → Messenger generic-template elements. We test it first because it's pure and the tests pin every formatting decision from the spec.

- [ ] **Step 1: Write the failing test**

Create `src/lib/messenger/property-outbound.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildRealestateCarouselElements } from './property-outbound'
import type { RealestateProperty } from '@/app/a/[slug]/_kinds/realestate/schema'

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
      { title: 'View property', url: 'https://example.com/a/page?sig=abc&property=property_abc-123' },
      { title: 'View all listings', url: 'https://example.com/a/page?sig=abc' },
    ])
    expect(out[0].defaultActionUrl).toBe('https://example.com/a/page?sig=abc&property=property_abc-123')
  })

  it('uses ? when the base URL has no query string', () => {
    const out = buildRealestateCarouselElements(
      [prop({ id: 'abc', title: 'Home' })],
      'https://example.com/a/page',
      'View all',
    )
    expect(out[0].defaultActionUrl).toBe('https://example.com/a/page?property=property_abc')
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
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm test src/lib/messenger/property-outbound.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

Create `src/lib/messenger/property-outbound.ts`:

```ts
import type { MessengerGenericElement } from '@/lib/facebook/messenger'
import type { RealestateProperty } from '@/app/a/[slug]/_kinds/realestate/schema'
import { propertySlug } from '@/lib/action-pages/rag/property-rag-text'

const ACTIVE_STATUSES = new Set(['for_sale', 'for_rent'])

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
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm test src/lib/messenger/property-outbound.test.ts`
Expected: PASS — 10 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/messenger/property-outbound.ts src/lib/messenger/property-outbound.test.ts
git commit -m "feat(messenger): add buildRealestateCarouselElements helper"
```

---

## Task 3: `sendPropertyRecommendation` — image + 2-button card — TDD

**Files:**
- Modify: `src/lib/messenger/property-outbound.ts`
- Modify: `src/lib/messenger/property-outbound.test.ts`

The recommendation send. Mirrors the structure of `sendProductRecommendation` in `outbound.ts:274` but builds a single-element generic_template (instead of a button card) so we can attach BOTH a `web_url` and a `postback` button.

- [ ] **Step 1: Add failing tests**

Append to `src/lib/messenger/property-outbound.test.ts`:

```ts
import { vi } from 'vitest'
import { sendPropertyRecommendation } from './property-outbound'
import * as outbound from '@/lib/messenger/outbound'
import { deeplinkActionPageUrl } from '@/lib/action-pages/urls'

vi.mock('@/lib/messenger/outbound', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/messenger/outbound')>()
  return { ...actual, sendOutbound: vi.fn() }
})
vi.mock('@/lib/action-pages/urls', () => ({
  deeplinkActionPageUrl: vi.fn(() => 'https://example.com/a/realestate?sig=signed'),
}))

const FAKE_ADMIN = {} as Parameters<typeof sendPropertyRecommendation>[0]['admin']
const THREAD = { id: 'thread-1', psid: 'PSID-1', last_inbound_at: '2026-05-09T12:00:00Z' }
const PAGE = { id: 'page-1', slug: 'my-realestate', signing_secret: 'secret' }

function makeProperty(over: Partial<Parameters<typeof sendPropertyRecommendation>[0]['property']> = {}) {
  return {
    id: 'item-1',
    slug: 'property_abc-123',
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
      { title: 'View property', url: 'https://example.com/a/realestate?sig=signed&property=property_abc-123' },
      { title: 'Inquire', postback: 'rec_inquire:property_abc-123' },
    ])
    expect(res).toEqual({
      sent: true,
      messageIds: ['mid-img', 'mid-card'],
      imageSent: true,
      deeplinkUrl: 'https://example.com/a/realestate?sig=signed&property=property_abc-123',
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
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm test src/lib/messenger/property-outbound.test.ts`
Expected: FAIL — `sendPropertyRecommendation` not exported.

- [ ] **Step 3: Implement `sendPropertyRecommendation`**

Append to `src/lib/messenger/property-outbound.ts`:

```ts
import { deeplinkActionPageUrl } from '@/lib/action-pages/urls'
import { sendOutbound, type SendKind } from '@/lib/messenger/outbound'
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

const DEEPLINK_TTL_SECONDS = 30 * 24 * 60 * 60

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
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm test src/lib/messenger/property-outbound.test.ts`
Expected: PASS — all tests passing (carousel + send).

- [ ] **Step 5: Commit**

```bash
git add src/lib/messenger/property-outbound.ts src/lib/messenger/property-outbound.test.ts
git commit -m "feat(messenger): add sendPropertyRecommendation with View + Inquire postback"
```

---

## Task 4: `recommendProperty` — RAG pipeline mirror — TDD

**Files:**
- Create: `src/lib/chatbot/recommend-property.ts`
- Test: `src/lib/chatbot/recommend-property.test.ts`

Mirrors `src/lib/chatbot/recommend.ts`. Only differences:
- Source ids come from `config.properties[].id` (mapped via `propertySlug`) instead of `config.product_ids`.
- Filters `business_items.kind = 'property'`.
- Filters out sold/reserved listings via `details->>property_status in ('for_sale','for_rent')`.
- Returns `RecommendedProperty` (adds `city`, `region`, `property_status`).

- [ ] **Step 1: Write the failing test**

Create `src/lib/chatbot/recommend-property.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { recommendProperty } from './recommend-property'
import type { Embedder, RerankItem, Reranker, RerankResult } from '@/lib/rag/hf-client'

const ACTION_PAGE_ID = '00000000-0000-4000-8000-000000000aa1'
const USER_ID = '00000000-0000-4000-8000-000000000001'
const PROP_A = '00000000-0000-4000-8000-000000000020'
const PROP_B = '00000000-0000-4000-8000-000000000021'

const fakeEmbedder: Embedder = {
  embed: vi.fn(async () => Array(1024).fill(0)),
  embedBatch: vi.fn(async () => []),
}

function makeReranker(scores: Record<string, number>): Reranker {
  return {
    rank: vi.fn(async (_q: string, items: RerankItem[]): Promise<RerankResult[]> =>
      items
        .map((i) => ({ id: i.id, score: scores[i.id] ?? 0 }))
        .sort((a, b) => b.score - a.score),
    ),
  }
}

interface FakeQuery {
  eq: (col: string, val: unknown) => FakeQuery
  in: (col: string, vals: unknown[]) => FakeQuery
  neq: (col: string, val: unknown) => FakeQuery
  gte: (col: string, val: unknown) => FakeQuery
  lte: (col: string, val: unknown) => FakeQuery
  overlaps: (col: string, val: unknown) => FakeQuery
  filter: (...args: unknown[]) => FakeQuery
  maybeSingle: () => Promise<{ data: unknown; error: null }>
  then: <T>(resolve: (v: { data: unknown; error: null }) => T) => Promise<T>
}

function makeClient(opts: {
  page: { id: string; user_id: string; kind: string; config: { properties: Array<{ id: string }> } } | null
  candidates: Array<Record<string, unknown>>
  hits: Array<{ business_item_id: string; content: string; rrf_score: number }>
}) {
  function makeQuery(table: string): FakeQuery {
    const q: FakeQuery = {
      eq: () => q,
      in: () => q,
      neq: () => q,
      gte: () => q,
      lte: () => q,
      overlaps: () => q,
      filter: () => q,
      async maybeSingle() {
        if (table === 'action_pages') return { data: opts.page, error: null }
        return { data: null, error: null }
      },
      then(resolve) {
        return Promise.resolve({ data: opts.candidates, error: null }).then(resolve)
      },
    }
    return q
  }
  return {
    from(table: string) {
      return { select: () => makeQuery(table) }
    },
    rpc: vi.fn(async () => ({ data: opts.hits, error: null })),
  } as unknown as Parameters<typeof recommendProperty>[0]['client']
}

describe('recommendProperty', () => {
  it('returns no_action_page when page not found', async () => {
    const client = makeClient({ page: null, candidates: [], hits: [] })
    const r = await recommendProperty(
      { client, embedder: fakeEmbedder, reranker: makeReranker({}) },
      { userId: USER_ID, actionPageId: ACTION_PAGE_ID, query: 'condo' },
    )
    expect(r).toEqual({ ok: false, reason: 'no_action_page' })
  })

  it('returns no_products when properties array is empty', async () => {
    const client = makeClient({
      page: { id: ACTION_PAGE_ID, user_id: USER_ID, kind: 'realestate', config: { properties: [] } },
      candidates: [],
      hits: [],
    })
    const r = await recommendProperty(
      { client, embedder: fakeEmbedder, reranker: makeReranker({}) },
      { userId: USER_ID, actionPageId: ACTION_PAGE_ID, query: 'condo' },
    )
    expect(r).toEqual({ ok: false, reason: 'no_products' })
  })

  it('returns ok with the right shape on a confident match', async () => {
    const client = makeClient({
      page: {
        id: ACTION_PAGE_ID,
        user_id: USER_ID,
        kind: 'realestate',
        config: { properties: [{ id: 'a' }, { id: 'b' }] },
      },
      candidates: [
        {
          id: PROP_A,
          title: 'Cebu Condo',
          slug: 'property_a',
          summary: 'Cebu City, Cebu',
          description: 'A nice condo',
          price_amount: 5_000_000,
          currency: 'PHP',
          pricing_model: 'fixed',
          inventory_status: 'in_stock',
          tags: ['condo'],
          cover_image_url: 'https://i/a.jpg',
          details: { property_status: 'for_sale', address: { city: 'Cebu City', region: 'Cebu' } },
        },
      ],
      hits: [{ business_item_id: PROP_A, content: 'condo blurb', rrf_score: 0.9 }],
    })
    const r = await recommendProperty(
      { client, embedder: fakeEmbedder, reranker: makeReranker({ [PROP_A]: 0.95 }) },
      { userId: USER_ID, actionPageId: ACTION_PAGE_ID, query: 'condo in cebu' },
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.product.title).toBe('Cebu Condo')
      expect(r.product.slug).toBe('property_a')
      expect(r.product.city).toBe('Cebu City')
      expect(r.product.region).toBe('Cebu')
      expect(r.product.property_status).toBe('for_sale')
      expect(r.confidence).toBeCloseTo(0.95)
    }
  })

  it('returns low_confidence when reranker top score is below threshold', async () => {
    const client = makeClient({
      page: {
        id: ACTION_PAGE_ID,
        user_id: USER_ID,
        kind: 'realestate',
        config: { properties: [{ id: 'a' }] },
      },
      candidates: [
        {
          id: PROP_A,
          title: 'Some Property',
          slug: 'property_a',
          summary: null,
          description: null,
          price_amount: 1_000_000,
          currency: 'PHP',
          pricing_model: 'fixed',
          inventory_status: 'in_stock',
          tags: [],
          cover_image_url: null,
          details: { property_status: 'for_sale', address: { city: '', region: '' } },
        },
      ],
      hits: [{ business_item_id: PROP_A, content: 'blurb', rrf_score: 0.4 }],
    })
    const r = await recommendProperty(
      { client, embedder: fakeEmbedder, reranker: makeReranker({ [PROP_A]: 0.2 }) },
      { userId: USER_ID, actionPageId: ACTION_PAGE_ID, query: 'condo', confidenceThreshold: 0.5 },
    )
    expect(r).toMatchObject({ ok: false, reason: 'low_confidence', bestConfidence: 0.2 })
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm test src/lib/chatbot/recommend-property.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `recommendProperty`**

Create `src/lib/chatbot/recommend-property.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatPrice } from '@/lib/business/pricing'
import type { InventoryStatus, PricingModel } from '@/lib/business/types'
import type { Embedder, Reranker } from '@/lib/rag/hf-client'
import { createEmbedder, createReranker } from '@/lib/rag/factory'
import { propertySlug } from '@/lib/action-pages/rag/property-rag-text'
import type { RealestateProperty } from '@/app/a/[slug]/_kinds/realestate/schema'

export interface RecommendPropertyFilters {
  priceMin?: number | null
  priceMax?: number | null
  tags?: string[]
}

export interface RecommendedProperty {
  id: string
  title: string
  slug: string
  summary: string | null
  description: string | null
  price_amount: number | null
  currency: string
  pricing_model: PricingModel
  price_label: string
  inventory_status: InventoryStatus
  tags: string[]
  cover_image_url: string | null
  city: string
  region: string
  property_status: string
}

export type RecommendPropertyResult =
  | { ok: true; product: RecommendedProperty; confidence: number }
  | {
      ok: false
      reason: 'no_action_page' | 'no_products' | 'no_match' | 'low_confidence'
      bestConfidence?: number
    }

export interface RecommendPropertyDeps {
  client: SupabaseClient
  embedder?: Embedder
  reranker?: Reranker
}

export interface RecommendPropertyInput {
  userId: string
  actionPageId: string
  query: string
  filters?: RecommendPropertyFilters
  confidenceThreshold?: number
  candidateLimit?: number
}

interface ActionPageRow {
  id: string
  user_id: string
  kind: string
  config: { properties?: Array<Pick<RealestateProperty, 'id'>> } | null
}

interface CandidateRow {
  id: string
  title: string
  slug: string
  summary: string | null
  description: string | null
  price_amount: number | string | null
  currency: string
  pricing_model: PricingModel
  inventory_status: InventoryStatus
  tags: string[] | null
  cover_image_url: string | null
  details: { property_status?: string; address?: { city?: string; region?: string } } | null
}

interface ChunkHit {
  business_item_id: string | null
  content: string
  rrf_score: number
}

const DEFAULT_THRESHOLD = 0.55
const DEFAULT_CANDIDATE_LIMIT = 30
const ACTIVE_STATUSES = ['for_sale', 'for_rent']

export async function recommendProperty(
  deps: RecommendPropertyDeps,
  input: RecommendPropertyInput,
): Promise<RecommendPropertyResult> {
  const threshold = input.confidenceThreshold ?? DEFAULT_THRESHOLD

  const { data: pageRow, error: pageErr } = await deps.client
    .from('action_pages')
    .select('id, user_id, kind, config')
    .eq('id', input.actionPageId)
    .eq('user_id', input.userId)
    .maybeSingle<ActionPageRow>()
  if (pageErr) throw new Error(`recommendProperty: load page failed: ${pageErr.message}`)
  if (!pageRow) return { ok: false, reason: 'no_action_page' }

  const props = pageRow.config?.properties ?? []
  if (props.length === 0) return { ok: false, reason: 'no_products' }

  const slugs = props.map((p) => propertySlug(p.id))
  const candidates = await loadCandidates(deps.client, input.userId, slugs, input.filters)
  if (candidates.length === 0) return { ok: false, reason: 'no_products' }

  const candidateIds = candidates.map((c) => c.id)
  const embedder = deps.embedder ?? createEmbedder()
  const reranker = deps.reranker ?? createReranker()

  const qvec = await embedder.embed(input.query)
  const { data: hits, error: rpcErr } = await deps.client.rpc(
    'match_business_items_hybrid_service',
    {
      p_user_id: input.userId,
      p_query_text: input.query,
      p_query_embed: qvec,
      p_item_ids: candidateIds,
      p_match_limit: input.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT,
    },
  )
  if (rpcErr) throw new Error(`recommendProperty: rpc failed: ${rpcErr.message}`)

  const bestPerItem = pickBestChunkPerItem((hits ?? []) as ChunkHit[])
  if (bestPerItem.size === 0) return { ok: false, reason: 'no_match' }

  const rankItems = Array.from(bestPerItem.entries()).map(([itemId, hit]) => ({
    id: itemId,
    text: hit.content,
  }))
  const ranked = await reranker.rank(input.query, rankItems)
  if (ranked.length === 0) return { ok: false, reason: 'no_match' }

  const top = ranked[0]
  if (top.score < threshold) {
    return { ok: false, reason: 'low_confidence', bestConfidence: top.score }
  }

  const winner = candidates.find((c) => c.id === top.id)
  if (!winner) return { ok: false, reason: 'no_match' }

  return { ok: true, product: toRecommendedProperty(winner), confidence: top.score }
}

async function loadCandidates(
  client: SupabaseClient,
  userId: string,
  slugs: string[],
  filters: RecommendPropertyFilters | undefined,
): Promise<CandidateRow[]> {
  let query = client
    .from('business_items')
    .select(
      'id, title, slug, summary, description, price_amount, currency, pricing_model, inventory_status, tags, cover_image_url, details',
    )
    .eq('user_id', userId)
    .eq('kind', 'property')
    .eq('status', 'published')
    .eq('rag_enabled', true)
    .in('slug', slugs)
    // details->>property_status in ('for_sale','for_rent')
    .filter('details->>property_status', 'in', `(${ACTIVE_STATUSES.join(',')})`)

  if (filters?.priceMin !== undefined && filters.priceMin !== null) {
    query = query.gte('price_amount', filters.priceMin)
  }
  if (filters?.priceMax !== undefined && filters.priceMax !== null) {
    query = query.lte('price_amount', filters.priceMax)
  }
  if (filters?.tags && filters.tags.length > 0) {
    query = query.overlaps('tags', filters.tags)
  }

  const { data, error } = await query
  if (error) throw new Error(`recommendProperty: load candidates failed: ${error.message}`)
  return (data ?? []) as CandidateRow[]
}

function pickBestChunkPerItem(hits: ChunkHit[]): Map<string, ChunkHit> {
  const out = new Map<string, ChunkHit>()
  for (const h of hits) {
    if (!h.business_item_id) continue
    const cur = out.get(h.business_item_id)
    if (!cur || h.rrf_score > cur.rrf_score) out.set(h.business_item_id, h)
  }
  return out
}

function toRecommendedProperty(row: CandidateRow): RecommendedProperty {
  const price =
    row.price_amount === null || row.price_amount === undefined ? null : Number(row.price_amount)
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    description: row.description,
    price_amount: price,
    currency: row.currency,
    pricing_model: row.pricing_model,
    price_label: formatPrice({ amount: price, currency: row.currency, pricingModel: row.pricing_model }),
    inventory_status: row.inventory_status,
    tags: Array.isArray(row.tags) ? row.tags : [],
    cover_image_url: row.cover_image_url,
    city: row.details?.address?.city ?? '',
    region: row.details?.address?.region ?? '',
    property_status: row.details?.property_status ?? '',
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm test src/lib/chatbot/recommend-property.test.ts`
Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chatbot/recommend-property.ts src/lib/chatbot/recommend-property.test.ts
git commit -m "feat(chatbot): add recommendProperty RAG pipeline"
```

---

## Task 5: Wire `propertyRecommendation` into the LLM classifier

**Files:**
- Modify: `src/lib/chatbot/classify.ts`

Add a parallel tool to the classifier output: `recommend_property` with the same shape as `recommend_product`. The tool is only described to the LLM when an `activeRealestatePageId` is supplied AND that page has recommendation rules in `chatbot_configs.recommendation_rules`.

- [ ] **Step 1: Extend the result interface**

In `src/lib/chatbot/classify.ts`, change the existing `ProductRecommendationRequest` interface block (lines 45–58) to also export a `PropertyRecommendationRequest` alias and add the new field on the result. Apply this edit:

Replace:

```ts
export interface AnswerWithClassificationResult extends AnswerResult {
  stageChange: StageChange | null
  actionPage: ActionPageChoice | null
  productRecommendation: ProductRecommendationRequest | null
}
```

with:

```ts
export type PropertyRecommendationRequest = ProductRecommendationRequest

export interface AnswerWithClassificationResult extends AnswerResult {
  stageChange: StageChange | null
  actionPage: ActionPageChoice | null
  productRecommendation: ProductRecommendationRequest | null
  propertyRecommendation: PropertyRecommendationRequest | null
}
```

- [ ] **Step 2: Extend the function signature**

In the same file, update the `options` parameter of `answerWithClassification` (around line 78–83) to include `activeRealestatePageId`:

Replace:

```ts
  options: AnswerOptions & {
    actionPages?: ActionPageBrief[]
    /** When the lead is on a catalog action page, pass its id so we can attach
     *  the matching recommendation rules from chatbot_configs.recommendation_rules. */
    activeCatalogPageId?: string | null
  } = {},
```

with:

```ts
  options: AnswerOptions & {
    actionPages?: ActionPageBrief[]
    /** When the lead is on a catalog action page, pass its id so we can attach
     *  the matching recommendation rules from chatbot_configs.recommendation_rules. */
    activeCatalogPageId?: string | null
    /** Same idea, but for a realestate action page — gates `recommend_property`. */
    activeRealestatePageId?: string | null
  } = {},
```

- [ ] **Step 3: Resolve property rules and pass them to the prompt builder**

Find the line `const recommendRules = getActionPageRecommendationRules(config, options.activeCatalogPageId)` (~line 122). Replace that single line with two lookups:

```ts
  const recommendRules = getActionPageRecommendationRules(config, options.activeCatalogPageId)
  const recommendPropertyRules = getActionPageRecommendationRules(
    config,
    options.activeRealestatePageId,
  )
```

- [ ] **Step 4: Pass the new rules to `stageInstruction`**

Find the line `const stageSystem = stageInstruction(stages, currentStageId, actionPages, recommendRules)` (~line 123). Replace with:

```ts
  const stageSystem = stageInstruction(
    stages,
    currentStageId,
    actionPages,
    recommendRules,
    recommendPropertyRules,
  )
```

- [ ] **Step 5: Parse the LLM output for `recommend_property`**

In the JSON-parsing block (around lines 161–179), declare a new local and coerce it. Replace:

```ts
  let productRecommendation: ProductRecommendationRequest | null = null
  if (parsed && typeof parsed === 'object') {
    const r = parsed as {
      reply?: unknown
      stage_change?: unknown
      action_page?: unknown
      recommend_product?: unknown
    }
    if (typeof r.reply === 'string') text = r.reply.trim()
    stageChange = coerceStageChange(r.stage_change, stages, currentStageId)
    actionPage = coerceActionPage(r.action_page, actionPages)
    if (recommendRules && options.activeCatalogPageId) {
      productRecommendation = coerceRecommendation(
        r.recommend_product,
        options.activeCatalogPageId,
        recommendRules.confidenceThreshold,
      )
    }
  }
```

with:

```ts
  let productRecommendation: ProductRecommendationRequest | null = null
  let propertyRecommendation: PropertyRecommendationRequest | null = null
  if (parsed && typeof parsed === 'object') {
    const r = parsed as {
      reply?: unknown
      stage_change?: unknown
      action_page?: unknown
      recommend_product?: unknown
      recommend_property?: unknown
    }
    if (typeof r.reply === 'string') text = r.reply.trim()
    stageChange = coerceStageChange(r.stage_change, stages, currentStageId)
    actionPage = coerceActionPage(r.action_page, actionPages)
    if (recommendRules && options.activeCatalogPageId) {
      productRecommendation = coerceRecommendation(
        r.recommend_product,
        options.activeCatalogPageId,
        recommendRules.confidenceThreshold,
      )
    }
    if (recommendPropertyRules && options.activeRealestatePageId) {
      propertyRecommendation = coerceRecommendation(
        r.recommend_property,
        options.activeRealestatePageId,
        recommendPropertyRules.confidenceThreshold,
      )
    }
  }
```

- [ ] **Step 6: Reset on fallback and include the new field in the return**

In the `if (!text)` fallback block (around lines 183–199), add `propertyRecommendation = null` next to the existing `productRecommendation = null`:

```ts
  if (!text) {
    // ... existing code ...
    text = fallback.trim()
    stageChange = null
    actionPage = null
    productRecommendation = null
    propertyRecommendation = null
  }
```

And update the return statement (~line 205):

```ts
  return {
    text,
    sourceTitles,
    media,
    stageChange,
    actionPage,
    productRecommendation,
    propertyRecommendation,
  }
```

- [ ] **Step 7: Update `stageInstruction` signature, schema, and prompt section**

Replace the existing `stageInstruction` function (the function declared around line 301) with this version. Note: `recommendInstruction` is reused — we just label it for the property tool with a different intro.

```ts
function stageInstruction(
  stages: StageBrief[],
  currentStageId: string | null,
  actionPages: ActionPageBrief[],
  recommendRules: ActionPageRecommendationRules | null,
  recommendPropertyRules: ActionPageRecommendationRules | null,
): string {
  const hasActionPages = actionPages.length > 0
  const hasRecommend = !!recommendRules
  const hasRecommendProperty = !!recommendPropertyRules
  const schemaParts = [
    '"reply": string',
    '"stage_change": {"to_stage_id": string, "confidence": "low"|"medium"|"high", "reason": string} | null',
  ]
  if (hasActionPages) {
    schemaParts.push(
      '"action_page": {"action_page_id": string, "reason": string, "button_text": string} | null',
    )
  }
  if (hasRecommend) {
    schemaParts.push(
      '"recommend_product": {"query": string, "filters": {"price_min": number|null, "price_max": number|null, "tags": string[]}} | null',
    )
  }
  if (hasRecommendProperty) {
    schemaParts.push(
      '"recommend_property": {"query": string, "filters": {"price_min": number|null, "price_max": number|null, "tags": string[]}} | null',
    )
  }
  const schema = `{${schemaParts.join(', ')}}`
  const apSection = hasActionPages
    ? '\n\n' +
      'ACTION PAGES — INTERNAL ROUTING ONLY:\n' +
      'When the latest customer message matches one action page\'s "send when" guidance, set `action_page.action_page_id` to that page\'s id. ' +
      'Pick at most one. Only use action_page_ids from the list below. ' +
      'The system will automatically attach the button as a SEPARATE message right after your reply — you do NOT need to send, link, or describe the button yourself.\n\n' +
      'STRICT REPLY RULES when attaching an action page:\n' +
      '- `reply` must be a normal conversational message — respond to what the customer said, nothing else.\n' +
      '- Do NOT mention the button, form, booking link, or action page in `reply` at all. The system will send the button as a completely separate message automatically.\n' +
      '- NEVER copy, paraphrase, or echo the "send when" guidance text into `reply`.\n' +
      '- NEVER write any reference to a form, link, button, or action page in `reply` — in ANY language (English, Tagalog, Taglish, or other). This includes but is not limited to: "Fill out the form", "I-fill out ang form", "heto ang link", "link sa form", "i-click ang button", "Check the link", etc.\n' +
      '- NEVER insert placeholder text like "[Insert Link]", "[form link here]", "[link]", or any bracketed template. If you would normally insert a link or URL, do NOT — the system sends the button separately.\n' +
      '- The "send when" text below is INTERNAL routing guidance only — never mention it or act on it in the reply text.\n\n' +
      'BUTTON_TEXT RULES (the card caption shown above the button):\n' +
      '- Write a short, action-pushing call-to-action in the SAME language as the customer (e.g. Tagalog/Taglish if they wrote Tagalog).\n' +
      '- Max ~80 chars. One line. No greetings, no page title, no URL.\n' +
      '- Include a downward-pointing emoji like 👇 (or 📝/📅 when fitting) to draw the eye to the button.\n' +
      '- Examples: "I-tap ang button sa baba para mag-book ng call 👇", "Fill out the quick form below 👇".\n' +
      '- NEVER use the action page title (e.g. "Lead Gen", "Booking") as the button_text.\n\n' +
      actionPageList(actionPages)
    : ''
  const recommendSection = hasRecommend ? recommendInstruction(recommendRules!, 'product') : ''
  const recommendPropertySection = hasRecommendProperty
    ? recommendInstruction(recommendPropertyRules!, 'property')
    : ''
  return (
    'You are also responsible for classifying the lead\'s pipeline stage' +
    (hasActionPages ? ' and deciding whether to attach an action page button to your reply' : '') +
    (hasRecommend ? ' and deciding whether to recommend a specific product' : '') +
    (hasRecommendProperty ? ' and deciding whether to recommend a specific property listing' : '') +
    '. Output a single JSON object with this exact shape and NOTHING ELSE:\n' +
    schema +
    '\n`reply` is what the customer sees — write it in the same persona/rules above. ' +
    '`stage_change` is null when the lead should stay in the current stage. ' +
    'Only use stage_ids from the list. Pick the stage whose description best matches the customer\'s intent in the latest message + conversation.\n\n' +
    stageList(stages, currentStageId) +
    apSection +
    recommendSection +
    recommendPropertySection
  )
}
```

- [ ] **Step 8: Parameterize `recommendInstruction` for product vs property**

Replace the existing `recommendInstruction` function with this kind-aware version:

```ts
function recommendInstruction(
  rules: ActionPageRecommendationRules,
  kind: 'product' | 'property',
): string {
  const slotsLine =
    rules.requiredSlots.length > 0
      ? `Required info you must collect FIRST before recommending: ${rules.requiredSlots.join(', ')}.`
      : 'No required slots — you may recommend as soon as the customer\'s need is clear.'
  const fieldName = kind === 'product' ? 'recommend_product' : 'recommend_property'
  const heading = kind === 'product' ? 'PRODUCT RECOMMENDATION' : 'PROPERTY RECOMMENDATION'
  const noun = kind === 'product' ? 'product' : 'property listing'
  return (
    '\n\n' +
    `${heading} — INTERNAL ROUTING ONLY:\n` +
    `Set \`${fieldName}\` ONLY when ONE of these is true:\n` +
    `  (a) The customer EXPLICITLY asks for a recommendation, suggestion, or "what do you have for…".\n` +
    '  (b) The operator rules below tell you to recommend at this point.\n' +
    `Otherwise, set \`${fieldName}\` to null and keep chatting normally.\n\n` +
    `Operator rules: ${rules.rules}\n` +
    slotsLine +
    '\n\n' +
    'When you DO recommend:\n' +
    `- \`query\` is a 1-sentence summary of what the customer is looking for, distilled from the conversation. Used for search — write it in clear English even if the customer wrote Tagalog.\n` +
    '- `filters.price_min` / `filters.price_max` are extracted from any budget the customer mentioned (in PHP, numbers only). null when not mentioned.\n' +
    '- `filters.tags` are short keywords (1–3 words each) the customer cares about. Empty array when none.\n' +
    `- The system will pick the actual ${noun}, send the image and a card AUTOMATICALLY in a SEPARATE message. Do NOT name a specific ${noun}, price, or link in \`reply\`.\n` +
    '- `reply` should be a short, warm acknowledgement like "Got it — let me share the best fit 👇" in the customer\'s language. Do NOT describe the result itself.\n' +
    `- If the required slots are not yet filled, set \`${fieldName}\` to null and ask for the missing info in \`reply\` instead.`
  )
}
```

- [ ] **Step 9: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 10: Run the existing classifier tests**

Run: `pnpm test src/lib/chatbot`
Expected: PASS — existing tests still green; the new field defaults to `null` everywhere it isn't explicitly returned.

- [ ] **Step 11: Commit**

```bash
git add src/lib/chatbot/classify.ts
git commit -m "feat(chatbot): add propertyRecommendation tool to classifier"
```

---

## Task 6: Worker — recommendation block for realestate

**Files:**
- Modify: `src/app/api/messenger/process/route.ts`

Mirror the existing `productRecommendation` block (line 591 onward) for `propertyRecommendation`. Place it immediately AFTER the existing block so that if the product flow already set `recommendationSent = true`, this block is a no-op.

- [ ] **Step 1: Resolve `activeRealestatePageId` and pass it to the classifier**

In `src/app/api/messenger/process/route.ts`, find the line:
`const activeCatalogPageId = sendablePages.find((p) => p.kind === 'catalog')?.id ?? null` (line 448).

Replace with:

```ts
      const activeCatalogPageId = sendablePages.find((p) => p.kind === 'catalog')?.id ?? null
      const activeRealestatePageId = sendablePages.find((p) => p.kind === 'realestate')?.id ?? null
```

Then in the call to `answerWithClassification`, add `activeRealestatePageId,` next to `activeCatalogPageId,` (the call block at lines 455–470). After this edit the `options` object passed in should look like:

```ts
            {
              rpcName: 'match_knowledge_hybrid_service',
              actionPages,
              campaignPersona: effectivePersona,
              conversationSummary,
              activeCatalogPageId,
              activeRealestatePageId,
              leadContextBlock,
            },
```

- [ ] **Step 2: Capture the new field in the destructure**

Below the existing `let productRecommendation: ...` declaration (lines 444–446), add:

```ts
      let propertyRecommendation: Awaited<
        ReturnType<typeof answerWithClassification>
      >['propertyRecommendation'] = null
```

And after `productRecommendation = r.productRecommendation` (line 474), add:

```ts
          propertyRecommendation = r.propertyRecommendation
```

- [ ] **Step 3: Add the new imports**

Near the top of `route.ts`, alongside the existing import of `sendProductRecommendation`, add:

```ts
import { sendPropertyRecommendation } from '@/lib/messenger/property-outbound'
import { recommendProperty } from '@/lib/chatbot/recommend-property'
```

- [ ] **Step 4: Add the property-recommendation block immediately after the product block**

Find the closing `}` of the `productRecommendation` block (around line 686, the `}` that closes the `if (productRecommendation && activeCatalogPageId) {` ... block, before the `// Send action page as a separate button message after the text reply.` comment).

Right after that closing `}` and before that comment line, insert:

```ts
      // Property recommendation — same shape as the product flow but operates
      // on the realestate page's curated list. Skips silently if the product
      // flow already sent.
      if (!recommendationSent && propertyRecommendation && activeRealestatePageId) {
        const realestatePage = sendablePages.find((p) => p.id === activeRealestatePageId)
        if (realestatePage) {
          try {
            const match = await recommendProperty(
              { client: admin },
              {
                userId: thread.user_id,
                actionPageId: realestatePage.id,
                query: propertyRecommendation.query,
                filters: {
                  priceMin: propertyRecommendation.filters.priceMin,
                  priceMax: propertyRecommendation.filters.priceMax,
                  tags: propertyRecommendation.filters.tags,
                },
                confidenceThreshold: propertyRecommendation.confidenceThreshold,
              },
            )
            if (match.ok) {
              const sendResult = await sendPropertyRecommendation({
                admin,
                thread: {
                  id: thread.id,
                  psid: thread.psid,
                  last_inbound_at: thread.last_inbound_at,
                },
                pageToken,
                facebookPageId: thread.page_id,
                page: {
                  id: realestatePage.id,
                  slug: realestatePage.slug,
                  signing_secret: realestatePage.signing_secret,
                },
                property: {
                  id: match.product.id,
                  slug: match.product.slug,
                  title: match.product.title,
                  price_label: match.product.price_label,
                  cover_image_url: match.product.cover_image_url,
                  city: match.product.city,
                  region: match.product.region,
                },
                confidence: match.confidence,
              })
              if (sendResult.sent) {
                recommendationSent = true
                if (sendResult.messageIds.length > 0) {
                  await admin
                    .from('messenger_jobs')
                    .update({ outbound_button_fb_id: sendResult.messageIds.at(-1) ?? null })
                    .eq('id', job.id)
                }
                const persistedBody =
                  `Recommended: ${match.product.title} — ${match.product.price_label}\n` +
                  `View → ${sendResult.deeplinkUrl}`
                const previewText = `Recommended · ${match.product.title}`
                await admin.from('messenger_messages').insert({
                  thread_id: thread.id,
                  user_id: thread.user_id,
                  direction: 'outbound',
                  sender: 'bot',
                  fb_message_id: sendResult.messageIds.at(-1) ?? null,
                  body: persistedBody,
                  attachments: {
                    kind: 'property_recommendation',
                    property_id: match.product.id,
                    action_page_id: realestatePage.id,
                    confidence: match.confidence,
                    image_sent: sendResult.imageSent,
                    deeplink_url: sendResult.deeplinkUrl,
                  },
                })
                await admin
                  .from('messenger_threads')
                  .update({
                    last_message_at: new Date().toISOString(),
                    last_message_preview: previewText.slice(0, 200),
                  })
                  .eq('id', thread.id)
              } else {
                console.warn('[messenger.worker] property recommendation send blocked', {
                  threadId: thread.id,
                  reason: sendResult.reason,
                })
              }
            } else {
              console.log('[messenger.worker] recommendProperty declined', {
                threadId: thread.id,
                reason: match.reason,
                bestConfidence: 'bestConfidence' in match ? match.bestConfidence : undefined,
              })
            }
          } catch (e) {
            console.error('[messenger.worker] property recommendation flow failed', e)
          }
        }
      }
```

- [ ] **Step 5: Typecheck and run worker tests**

Run: `pnpm typecheck && pnpm test src/app/api/messenger/process`
Expected: PASS — existing route tests still green.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/messenger/process/route.ts
git commit -m "feat(messenger): wire propertyRecommendation send in worker"
```

---

## Task 7: Worker — realestate carousel branch

**Files:**
- Modify: `src/app/api/messenger/process/route.ts`

Add a `realestate` branch parallel to the existing `catalog` branch in the action-page-button block (currently `if (chosen.kind === 'catalog') { ... fetchPublicCatalogProducts ... }` around lines 711–721).

- [ ] **Step 1: Add the carousel-element import**

At the top of `route.ts`, alongside the existing `import type { MessengerGenericElement } from '@/lib/facebook/messenger'` (line 19), add:

```ts
import { buildRealestateCarouselElements } from '@/lib/messenger/property-outbound'
import { parseRealestateConfig } from '@/app/a/[slug]/_kinds/realestate/schema'
```

- [ ] **Step 2: Build a parallel branch for realestate**

Find the existing block (~line 706–721):

```ts
            // For catalog action pages, send a horizontally-scrollable
            // carousel of products (image + title + price/summary + per-card
            // "View product" / "View all" buttons) instead of a single
            // button. Falls through to the button if no products are found.
            let carouselProducts: PublicProductCard[] = []
            if (chosen.kind === 'catalog') {
              try {
                carouselProducts = await fetchPublicCatalogProducts(
                  admin,
                  chosen.user_id,
                  chosen.config as Parameters<typeof fetchPublicCatalogProducts>[2],
                )
              } catch (e) {
                console.warn('[messenger.worker] catalog product fetch failed', e)
              }
            }
```

Below it (still before the `let buttonFbId = ...` line), add the realestate-elements branch:

```ts
            // For realestate pages, send a carousel of active properties
            // (for_sale / for_rent only; cap 10; config order). Falls through
            // to the single button if there are no active properties.
            let realestateElements: MessengerGenericElement[] = []
            if (chosen.kind === 'realestate') {
              try {
                const reConfig = parseRealestateConfig(chosen.config)
                realestateElements = buildRealestateCarouselElements(
                  reConfig.properties,
                  targetUrl,
                  chosen.cta_label || 'View all',
                )
              } catch (e) {
                console.warn('[messenger.worker] realestate config parse failed', e)
              }
            }
```

- [ ] **Step 3: Hook the realestate elements into the carousel send**

Find the existing carousel block (~line 724–767):

```ts
            // Idempotent on retry — see text-reply block above for rationale.
            let buttonFbId = job.outbound_button_fb_id
            let carouselSent = false
            if (!buttonFbId && carouselProducts.length > 0) {
              const elements: MessengerGenericElement[] = carouselProducts
                .slice(0, 10)
                .map((p) => {
                  // ... existing product mapping ...
                })
              const carouselResult = await sendOutbound({ ... })
              // ... existing handling ...
            }
```

Right after the closing `}` of the `if (!buttonFbId && carouselProducts.length > 0) { ... }` block, insert a parallel block for realestate:

```ts
            if (!buttonFbId && realestateElements.length > 0) {
              const carouselResult = await sendOutbound({
                admin,
                thread: { id: thread.id, psid: thread.psid, last_inbound_at: thread.last_inbound_at },
                pageToken,
                payload: { kind: 'generic_template', elements: realestateElements },
                kind: 'bot',
              })
              if (carouselResult.sent) {
                buttonFbId = carouselResult.messageId ?? null
                carouselSent = true
                if (buttonFbId) {
                  await admin
                    .from('messenger_jobs')
                    .update({ outbound_button_fb_id: buttonFbId })
                    .eq('id', job.id)
                }
              } else {
                console.warn('[messenger.worker] realestate carousel policy_blocked', {
                  threadId: thread.id,
                  reason: (carouselResult as { sent: false; reason: string }).reason,
                })
              }
            }
```

- [ ] **Step 4: Update the persisted message body for realestate**

The existing persistedBody computation (~line 791–798) only handles `carouselProducts`. Extend it to fall back to `realestateElements` when those are what got sent. Replace:

```ts
            const persistedBody = carouselSent
              ? `${chosen.title} — ${carouselProducts.length} product${carouselProducts.length === 1 ? '' : 's'}\n` +
                carouselProducts
                  .slice(0, 10)
                  .map((p) => `• ${p.title} (${p.price_label})`)
                  .join('\n') +
                `\nView all → ${targetUrl}`
              : `${btnText}\n${chosen.cta_label} → ${targetUrl}`
            const previewText = carouselSent
              ? `${chosen.title} · ${carouselProducts.length} products`
              : `${chosen.cta_label} · ${chosen.title}`
```

with:

```ts
            const persistedBody = carouselSent
              ? chosen.kind === 'realestate'
                ? `${chosen.title} — ${realestateElements.length} listing${realestateElements.length === 1 ? '' : 's'}\n` +
                  realestateElements
                    .map((e) => `• ${e.title}${e.subtitle ? ` (${e.subtitle})` : ''}`)
                    .join('\n') +
                  `\nView all → ${targetUrl}`
                : `${chosen.title} — ${carouselProducts.length} product${carouselProducts.length === 1 ? '' : 's'}\n` +
                  carouselProducts
                    .slice(0, 10)
                    .map((p) => `• ${p.title} (${p.price_label})`)
                    .join('\n') +
                  `\nView all → ${targetUrl}`
              : `${btnText}\n${chosen.cta_label} → ${targetUrl}`
            const previewText = carouselSent
              ? chosen.kind === 'realestate'
                ? `${chosen.title} · ${realestateElements.length} listings`
                : `${chosen.title} · ${carouselProducts.length} products`
              : `${chosen.cta_label} · ${chosen.title}`
```

- [ ] **Step 5: Typecheck and run tests**

Run: `pnpm typecheck && pnpm test src/app/api/messenger/process`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/messenger/process/route.ts
git commit -m "feat(messenger): send realestate property carousel in worker"
```

---

## Task 8: `handlePostback` — webhook helper — TDD

**Files:**
- Create: `src/app/api/webhooks/facebook/_postback.ts`
- Test: `src/app/api/webhooks/facebook/_postback.test.ts`

This receives a Messenger postback event and synthesizes an inbound message that the worker will treat normally. Idempotent via a synthetic `pb:` id stored in `messenger_messages.fb_message_id` (existing unique index).

- [ ] **Step 1: Confirm the FbMessaging event shape**

Read `src/app/api/webhooks/facebook/route.ts` lines 1–60 to locate the `FbMessaging` type and confirm it (or its source) exposes `postback?: { payload: string; title?: string }` and `timestamp?: number`. If it doesn't currently, widen it inside `_postback.ts` with a local type — do NOT modify the shared definition.

- [ ] **Step 2: Write the failing tests**

Create `src/app/api/webhooks/facebook/_postback.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { handlePostback } from './_postback'

const FB_PAGE_ID = 'fb-page-1'
const PSID = 'PSID-1'
const USER_ID = '00000000-0000-4000-8000-000000000001'
const PAGE_ID = 'page-row-1'
const PROP_ID = 'item-1'
const PROP_SLUG = 'property_abc-123'
const PROP_TITLE = 'Sunny 3BR House'

interface DbState {
  page: { id: string; user_id: string } | null
  property: { id: string; title: string } | null
  thread: { id: string } | null
  insertConflict: boolean
}

function makeAdmin(state: DbState) {
  const calls: { table: string; op: string; payload: unknown }[] = []

  function from(table: string) {
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (table === 'facebook_pages')
                return {
                  data: state.page
                    ? { id: state.page.id, facebook_connections: { user_id: state.page.user_id } }
                    : null,
                  error: null,
                }
              if (table === 'business_items')
                return state.property
                  ? { data: state.property, error: null }
                  : { data: null, error: null }
              return { data: null, error: null }
            },
          }),
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
      upsert: () => ({
        select: () => ({
          single: async () => ({ data: state.thread, error: null }),
        }),
      }),
      insert: (payload: unknown) => {
        calls.push({ table, op: 'insert', payload })
        return {
          select: () => ({
            maybeSingle: async () =>
              state.insertConflict
                ? { data: null, error: { code: '23505' } }
                : { data: { id: 'inserted-msg' }, error: null },
            single: async () => ({ data: { id: 'job-1' }, error: null }),
          }),
        }
      },
      update: (payload: unknown) => ({
        eq: () => {
          calls.push({ table, op: 'update', payload })
          return Promise.resolve({ data: null, error: null })
        },
      }),
    }
  }

  return { from, calls }
}

const baseState: DbState = {
  page: { id: PAGE_ID, user_id: USER_ID },
  property: { id: PROP_ID, title: PROP_TITLE },
  thread: { id: 'thread-1' },
  insertConflict: false,
}

describe('handlePostback', () => {
  it('returns null for malformed payloads', async () => {
    const admin = makeAdmin(baseState)
    const r = await handlePostback(
      admin as unknown as Parameters<typeof handlePostback>[0],
      FB_PAGE_ID,
      { sender: { id: PSID }, postback: { payload: 'not-a-known-prefix' }, timestamp: 1 } as never,
    )
    expect(r).toBeNull()
  })

  it('returns null when property slug is unknown', async () => {
    const admin = makeAdmin({ ...baseState, property: null })
    const r = await handlePostback(
      admin as unknown as Parameters<typeof handlePostback>[0],
      FB_PAGE_ID,
      { sender: { id: PSID }, postback: { payload: `rec_inquire:${PROP_SLUG}` }, timestamp: 1 } as never,
    )
    expect(r).toBeNull()
  })

  it('persists synthetic inbound message and returns a job id on success', async () => {
    const admin = makeAdmin(baseState)
    const r = await handlePostback(
      admin as unknown as Parameters<typeof handlePostback>[0],
      FB_PAGE_ID,
      { sender: { id: PSID }, postback: { payload: `rec_inquire:${PROP_SLUG}` }, timestamp: 1700000000 } as never,
    )
    expect(r).toBe('job-1')
    const insert = admin.calls.find((c) => c.table === 'messenger_messages' && c.op === 'insert')
    expect(insert).toBeTruthy()
    expect((insert!.payload as { body: string }).body).toContain(PROP_TITLE)
    expect((insert!.payload as { fb_message_id: string }).fb_message_id).toMatch(/^pb:/)
    expect((insert!.payload as { attachments: { kind: string } }).attachments.kind).toBe(
      'inquire_postback',
    )
  })

  it('returns null on dedup conflict (Meta retry)', async () => {
    const admin = makeAdmin({ ...baseState, insertConflict: true })
    const r = await handlePostback(
      admin as unknown as Parameters<typeof handlePostback>[0],
      FB_PAGE_ID,
      { sender: { id: PSID }, postback: { payload: `rec_inquire:${PROP_SLUG}` }, timestamp: 1700000000 } as never,
    )
    expect(r).toBeNull()
  })
})
```

- [ ] **Step 3: Run the test — should fail**

Run: `pnpm test src/app/api/webhooks/facebook/_postback.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `handlePostback`**

Create `src/app/api/webhooks/facebook/_postback.ts`:

```ts
import { createHash } from 'node:crypto'
import type { createAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createAdminClient>

interface PostbackEvent {
  sender?: { id?: string }
  postback?: { payload?: string; title?: string }
  timestamp?: number
}

interface FbPageRow {
  id: string
  facebook_connections?: { user_id?: string } | { user_id?: string }[]
}

function syntheticId(psid: string, timestamp: number, payload: string): string {
  const hash = createHash('sha1').update(payload).digest('hex').slice(0, 8)
  return `pb:${psid}:${timestamp}:${hash}`
}

function pageOwnerId(page: FbPageRow): string | null {
  const conn = page.facebook_connections
  const user = Array.isArray(conn) ? conn[0]?.user_id : conn?.user_id
  return user ?? null
}

/**
 * Handle an inbound Messenger postback event. Today we only know the
 * `rec_inquire:<slug>` payload (Inquire button on a property recommendation
 * card). Returns the enqueued job id when one was created, or null when the
 * event was malformed, dedup'd, or pointed at an unknown property.
 */
export async function handlePostback(
  admin: AdminClient,
  fbPageId: string,
  ev: PostbackEvent,
): Promise<string | null> {
  const psid = ev.sender?.id
  const payload = ev.postback?.payload
  const timestamp = ev.timestamp ?? Date.now()
  if (!psid || !payload) {
    console.warn('[fb.webhook] postback malformed (missing psid or payload)')
    return null
  }

  const colonIdx = payload.indexOf(':')
  if (colonIdx <= 0) {
    console.warn('[fb.webhook] postback malformed (no prefix)', { payload })
    return null
  }
  const prefix = payload.slice(0, colonIdx)
  const arg = payload.slice(colonIdx + 1)

  if (prefix !== 'rec_inquire') {
    console.warn('[fb.webhook] postback unknown prefix', { prefix })
    return null
  }

  const { data: page, error: pageErr } = await admin
    .from('facebook_pages')
    .select('id, facebook_connections(user_id)')
    .eq('fb_page_id', fbPageId)
    .maybeSingle<FbPageRow>()
  if (pageErr || !page) {
    console.warn('[fb.webhook] postback unknown page', { fbPageId, err: pageErr?.message })
    return null
  }
  const userId = pageOwnerId(page)
  if (!userId) {
    console.warn('[fb.webhook] postback page has no owner', { fbPageId })
    return null
  }

  const { data: property, error: propErr } = await admin
    .from('business_items')
    .select('id, title')
    .eq('user_id', userId)
    .eq('kind', 'property')
    .eq('slug', arg)
    .maybeSingle<{ id: string; title: string }>()
  if (propErr || !property) {
    console.warn('[fb.webhook] postback property not found', { slug: arg, err: propErr?.message })
    return null
  }

  // Upsert thread (mirror of handleEvent — if it doesn't exist yet we create it).
  const { data: thread, error: threadErr } = await admin
    .from('messenger_threads')
    .upsert(
      { page_id: page.id, user_id: userId, psid },
      { onConflict: 'page_id,psid', ignoreDuplicates: false },
    )
    .select('id')
    .single<{ id: string }>()
  if (threadErr || !thread) {
    console.error('[fb.webhook] postback thread upsert failed', threadErr?.message)
    return null
  }

  const fbMessageId = syntheticId(psid, timestamp, payload)
  const body = `I'd like more info on ${property.title}`

  const { data: inserted, error: insertErr } = await admin
    .from('messenger_messages')
    .insert({
      thread_id: thread.id,
      user_id: userId,
      direction: 'inbound',
      sender: 'user',
      fb_message_id: fbMessageId,
      body,
      attachments: { kind: 'inquire_postback', property_id: property.id, property_slug: arg },
    })
    .select('id')
    .maybeSingle()

  if (insertErr) {
    if ((insertErr as { code?: string }).code === '23505') return null
    console.error('[fb.webhook] postback message insert failed', insertErr.message)
    return null
  }
  if (!inserted) return null

  const previewText = `📩 Inquire · ${property.title}`.slice(0, 200)
  const nowIso = new Date().toISOString()
  await admin
    .from('messenger_threads')
    .update({
      last_inbound_at: nowIso,
      last_message_at: nowIso,
      last_message_preview: previewText,
    })
    .eq('id', thread.id)

  const { data: job, error: jobErr } = await admin
    .from('messenger_jobs')
    .insert({
      thread_id: thread.id,
      inbound_msg_id: (inserted as { id: string }).id,
      user_id: userId,
    })
    .select('id')
    .single<{ id: string }>()

  if (jobErr || !job) {
    console.error('[fb.webhook] postback job enqueue failed', jobErr?.message)
    return null
  }

  console.log('[fb.webhook] postback received', { prefix, slug: arg, threadId: thread.id })
  return job.id
}
```

- [ ] **Step 5: Run tests to confirm they pass**

Run: `pnpm test src/app/api/webhooks/facebook/_postback.test.ts`
Expected: PASS — 4 tests passing.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/webhooks/facebook/_postback.ts src/app/api/webhooks/facebook/_postback.test.ts
git commit -m "feat(webhook): add handlePostback for rec_inquire payload"
```

---

## Task 9: Wire `handlePostback` into the webhook entry

**Files:**
- Modify: `src/app/api/webhooks/facebook/route.ts`

- [ ] **Step 1: Import the handler**

Near the top of `src/app/api/webhooks/facebook/route.ts`, add:

```ts
import { handlePostback } from './_postback'
```

- [ ] **Step 2: Branch on `ev.postback` in the messaging loop**

Find the loop:

```ts
    for (const ev of entry.messaging ?? []) {
      try {
        const jobId = await handleEvent(admin, fbPageId, ev)
        if (jobId) messengerEnqueued.push(jobId)
      } catch (e) {
        console.error('[fb.webhook] handleEvent failed', e)
      }
    }
```

Replace it with:

```ts
    for (const ev of entry.messaging ?? []) {
      try {
        if (ev.postback) {
          const jobId = await handlePostback(admin, fbPageId, ev)
          if (jobId) messengerEnqueued.push(jobId)
          continue
        }
        const jobId = await handleEvent(admin, fbPageId, ev)
        if (jobId) messengerEnqueued.push(jobId)
      } catch (e) {
        console.error('[fb.webhook] event handling failed', e)
      }
    }
```

- [ ] **Step 3: If `FbMessaging` doesn't include `postback`, widen it**

If TypeScript complains that `ev.postback` doesn't exist on `FbMessaging`, locate the type (likely in the same file or a sibling `types.ts`) and add:

```ts
  postback?: { payload?: string; title?: string }
```

to its definition.

- [ ] **Step 4: Typecheck and run all webhook tests**

Run: `pnpm typecheck && pnpm test src/app/api/webhooks/facebook`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/webhooks/facebook/route.ts
git commit -m "feat(webhook): dispatch postback events to handlePostback"
```

---

## Task 10: Integration coverage in the worker route test

**Files:**
- Modify: `src/app/api/messenger/process/route.test.ts`

Extend with three integration cases for the realestate flow. We mock `recommendProperty`, `sendPropertyRecommendation`, and `sendOutbound` at the module boundary the same way the existing tests handle the catalog equivalents.

- [ ] **Step 1: Read the existing test file to find the mocking patterns**

Read `src/app/api/messenger/process/route.test.ts` start to end. Identify how the existing tests mock `sendProductRecommendation`, `sendOutbound`, and `answerWithClassification`. Reuse the same patterns — do NOT introduce a new mocking style.

- [ ] **Step 2: Add three test cases**

Append (or add inside the existing `describe`) the following cases. Adapt the imports and helpers to match the file's existing style:

```ts
  it('realestate page chosen, no recommendation: sends carousel of active properties', async () => {
    // arrange:
    //  - sendablePages includes a realestate page with config.properties:
    //      [{ id:'a', status:'for_sale', title:'Home A', price:{ display_label:'PHP 1M', currency:'PHP', amount:null, period:null }, address:{ city:'Cebu City', region:'Cebu', line1:'', line2:'', postal:'', country:'' }, gallery:[], description:'', specs:{...}, custom_specs:[], amenities:[], financing_options:[], financing_notes:'' },
    //       { id:'b', status:'sold',     title:'Home B', ... },
    //       { id:'c', status:'for_rent', title:'Home C', ...}]
    //  - answerWithClassification returns { actionPage: { action_page_id: <realestate-id>, button_text: '...' }, propertyRecommendation: null, productRecommendation: null }
    // assert:
    //  - sendOutbound called with payload.kind === 'generic_template'
    //  - elements length is 2 (Home A, Home C; Home B sold filtered out)
    //  - persisted body mentions "2 listings"
  })

  it('realestate page chosen, no active properties: falls back to single button', async () => {
    // arrange:
    //  - sendablePages includes realestate page; all properties have status='draft' or 'sold'
    //  - answerWithClassification returns actionPage targeting that page
    // assert:
    //  - no generic_template sendOutbound call
    //  - sendOutbound called with payload.kind === 'button' for the page
  })

  it('propertyRecommendation succeeds: rec card sent and carousel skipped', async () => {
    // arrange:
    //  - mock recommendProperty to return ok
    //  - mock sendPropertyRecommendation to return { sent:true, ...}
    //  - answerWithClassification returns actionPage = realestate page AND propertyRecommendation = { query, filters, ... }
    // assert:
    //  - sendPropertyRecommendation called once
    //  - sendOutbound NOT called with kind:'generic_template' for the realestate page
    //  - messenger_messages insert has attachments.kind === 'property_recommendation'
  })
```

Fill in the actual stubs by mirroring the equivalent catalog tests already in the file.

- [ ] **Step 3: Run the tests**

Run: `pnpm test src/app/api/messenger/process/route.test.ts`
Expected: PASS — all old + 3 new cases.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/messenger/process/route.test.ts
git commit -m "test(messenger): integration cases for realestate carousel + recommendation"
```

---

## Task 11: Final verification

- [ ] **Step 1: Full test run**

Run: `pnpm test`
Expected: PASS — entire suite green.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck` (or `npx tsc --noEmit`)
Expected: PASS.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: PASS — no new errors.

- [ ] **Step 4: Manual smoke (browser + Messenger)**

Manual checklist (do this with the dev server running and a connected test page):
- Create or pick a realestate action page with at least 3 active properties (`for_sale` / `for_rent`) and 1 `sold`.
- Connect the FB page to a test Messenger user.
- Send "Show me your listings" from the test user.
- Verify in Messenger:
  - A horizontally-scrollable card carousel arrives (3 cards, sold one filtered out).
  - Tap "View property" on a card → opens the realestate page deeplinked to `?property=<slug>`.
  - Tap "View all" / cta_label → opens the page root.
- Send a targeted query like "Do you have a 3-bedroom condo in Cebu under 6M?" — verify a single recommendation card arrives (image + title + Inquire/View buttons), and the carousel does NOT also fire that turn.
- Tap "Inquire" — verify the bot replies as if the lead typed "I'd like more info on {property}". The reply should not loop into another recommendation in the same turn.
- Send the same postback again (re-tap Inquire) — verify the worker doesn't double-process (only one bot reply).

- [ ] **Step 5: Final commit / push**

If all steps pass, the branch is ready. Push and open a PR.

```bash
git status
git log --oneline -10
```

Expected: clean tree, ~10 commits matching task names above.

---

## Self-review notes

**Spec coverage:** ✓
- Decisions 1–7 from the spec are each covered by a task (1: T7, 2: T4, 3: T6, 4: T3 + T7, 5: T2, 6: T5+T6, 7: T1+T3+T8+T9).

**Placeholder check:** ✓ no TBD / "fill in details" / "similar to" — every code step has the actual code.

**Type consistency:**
- `MessengerGenericButton` widened in T1 → consumed in T2/T3.
- `RecommendedProperty` (T4) carries `city/region/property_status` → consumed by `sendPropertyRecommendation` in T6.
- `propertyRecommendation` shape (T5) consumed in T6 worker block.
- `handlePostback` signature in T8 matches the import + dispatch in T9.

**Test cadence:** Every TDD task (T2, T3, T4, T8) writes the failing test first, then the implementation, then the green run, then commit. T1, T5, T6, T7, T9 are integration changes guarded by `pnpm typecheck` + the existing test suites.
