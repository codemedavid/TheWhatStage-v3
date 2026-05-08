# Realestate property cards on Messenger — design

**Date:** 2026-05-09
**Status:** Approved (brainstorming)
**Author:** John Angelo David (with Claude)

## Summary

The realestate action page kind currently has multi-property config and per-property RAG indexing, but Messenger only sends a single button to the action page when the bot picks it. This design extends the catalog kind's existing Messenger flows — a horizontally-scrollable carousel of items, plus a single-item recommendation card driven by an LLM tool call and RAG — to cover realestate.

The work is intentionally a parallel implementation of the catalog flows (Approach 2: copy-and-adapt), not a refactor. Catalog code paths are not touched.

## Goals

- Send a horizontally-scrollable carousel of properties on Messenger when the bot picks a realestate action page.
- Send a single-property recommendation card (image + title + price + buttons) when the LLM identifies a property the lead is asking about.
- Add a Messenger postback button (`Inquire`) on the recommendation card that synthesizes a canned inbound message and replies via the normal LLM path.

## Non-goals

- Refactoring or generalizing the catalog code. Future consolidation is fine but out of scope here.
- Property-specific recommendation filters (`bedsMin`, `propertyType`, `city`, etc.). Ship parity with catalog (`priceMin`/`priceMax`/`tags`); iterate later if recommendations are noisy.
- Editor changes. Carousel-on-Messenger is automatic and gated by per-property `status`.
- Group-aware carousel slicing (using `RealestateGroup`). Ship a flat list first.
- Marketing-message registration or new send-policy modes. All sends route through existing `sendOutbound()` and respect existing 24h / HUMAN_AGENT / OTN policy.

## Decisions log

| # | Decision | Rationale |
|---|---|---|
| 1 | Carousel auto-sends whenever realestate page is picked | Mirrors catalog; consistent mental model. |
| 2 | Mirror catalog RAG; iterate filters later | Property text is already RAG-indexed via `buildPropertyRagText`. Same pipeline works. |
| 3 | Recommendation wins; carousel is fallback when no confident match | Mirrors catalog's `recommendationSent` gate. |
| 4 | Card subtitle = `price_label · "City, Region"`; cover image; buttons `[View property, View all]` | Matches catalog card shape. |
| 5 | Carousel includes only `for_sale` / `for_rent` properties; cap 10; config order | Sold/reserved waste card slots when active inventory is plentiful; deeplink still surfaces them on the full page. |
| 6 | LLM tools exposed only when a sendable page of that kind exists | Mirrors the existing `activeCatalogPageId` rule. |
| 7 | Recommendation card buttons: `[View property]` URL + `[Inquire]` postback | Inquire postback feels native; user opted into the new webhook wiring cost. |

## Architecture

```
Inbound message
   │
   ▼
LLM classifier (chatbot/classify.ts)
   │  exposes propertyRecommendation tool ONLY if a sendable
   │  realestate page exists (mirror of activeCatalogPageId rule)
   ▼
worker (api/messenger/process/route.ts)
   │
   ├── if propertyRecommendation tool fired → recommendProperty()
   │       │  RAG over business_items (kind='property'),
   │       │  reuses match_business_items_hybrid_service
   │       │
   │       ├── ok+confident → sendPropertyRecommendation()
   │       │   image + button card with 2 buttons:
   │       │     [View property]  URL → ?property=<slug>
   │       │     [Inquire]        postback → rec_inquire:<slug>
   │       │   sets recommendationSent = true → skips carousel
   │       │
   │       └── declined / low_confidence → fall through to carousel
   │
   └── if action page = realestate kind AND !recommendationSent
           → fetch active properties (status in for_sale/for_rent,
             config order, cap 10) from config.properties
           → build MessengerGenericElement[] (catalog-style)
           → sendOutbound({ kind:'generic_template', elements })
           → fall back to single button if no active properties
```

**Postback path (new code in `webhooks/facebook/route.ts`):**

```
FB webhook → ev.postback present →
   parse payload "rec_inquire:<slug>" →
   resolve property by slug (business_items, kind='property') →
   persist messenger_messages row:
     direction='inbound', sender='lead',
     body=`I'd like more info on ${propertyTitle}`,
     attachments={ kind:'inquire_postback', property_slug, property_id }
   enqueue messenger_jobs row →
   bot processes it as a normal inbound on next worker tick
```

Postback inbounds reset `last_inbound_at`, opening the 24h window — so the bot's reply uses normal RESPONSE policy, not HUMAN_AGENT.

## Components & files

### New files

**`src/lib/chatbot/recommend-property.ts`** (~200 lines)
Mirror of `recommend.ts`. Exports:
- `recommendProperty(deps, input): RecommendResult` — same RAG pipeline (`match_business_items_hybrid_service` + reranker) but:
  - Reads `config.properties` from the realestate action page (not `config.product_ids`)
  - Maps `properties[].id` → `propertySlug(id)` and looks up `business_items` by `(user_id, kind='property', slug in slugs)`
  - Filters `details->>property_status` to `('for_sale','for_rent')` so sold/reserved aren't recommended
  - `RecommendedProperty` type carries `address.city/region`, `property_status`, plus the same fields as `RecommendedProduct`

**`src/lib/messenger/property-outbound.ts`** (~150 lines)
Mirror of `sendProductRecommendation` block in `outbound.ts`. Exports:
- `sendPropertyRecommendation(args): PropertyRecommendationSendResult`
  - Sends image (if primary gallery url present), then a generic template with one element + two buttons:
    - `[View property]` URL → signed deeplink `?property=<slug>`
    - `[Inquire]` postback → payload `rec_inquire:<property_slug>`
  - Why generic_template (not button template): button templates don't cleanly mix URL + postback in a two-button layout; generic_template does. Also matches catalog carousel format.
- `buildRealestateCarouselElements(properties, deeplinkBase, ctaLabel)` — pure helper returning `MessengerGenericElement[]`. Consumed by the worker's carousel block.

**`src/app/api/webhooks/facebook/_postback.ts`** (~80 lines)
Extracted helper for postback handling. Exports:
- `handlePostback(admin, fbPageId, ev): Promise<string | null>` — parses `ev.postback.payload`, dispatches by prefix:
  - `rec_inquire:<slug>` → resolves property via `business_items`, synthesizes inbound message, enqueues job
- Returns the job id when one was enqueued, `null` otherwise.

### Modified files

**`src/lib/chatbot/classify.ts`**
- Add `propertyRecommendation` tool definition (mirror of `productRecommendation` shape: `query` + `priceMin`/`priceMax`/`tags`/`confidenceThreshold`)
- Tool only described to the LLM when caller passes `activeRealestatePageId`
- Extend the classify return type with `propertyRecommendation: { query, filters, confidenceThreshold } | null`

**`src/app/api/messenger/process/route.ts`**
- Resolve `activeRealestatePageId = sendablePages.find((p) => p.kind === 'realestate')?.id ?? null`
- Pass it into the classifier alongside `activeCatalogPageId`
- After the existing `productRecommendation` block: a parallel block for `propertyRecommendation` → `recommendProperty` → `sendPropertyRecommendation`. Sets `recommendationSent = true` on success.
- In the action-page-button block: when `chosen.kind === 'realestate'` and `!recommendationSent`, fetch active properties from `chosen.config.properties` (filtered to `for_sale`/`for_rent`, capped 10, in config order), build elements via `buildRealestateCarouselElements`, send via existing `sendOutbound({ kind: 'generic_template', elements })`. Fall back to the single button if zero active properties.
- Persist a `messenger_messages` row with `attachments.kind = 'property_recommendation'` (parallel to `'product_recommendation'`) recording `property_id`, `action_page_id`, `confidence`, `image_sent`, `deeplink_url`.

**`src/app/api/webhooks/facebook/route.ts`**
- In the `entry.messaging` loop, branch on `ev.postback` before/after the existing `ev.message` branch. Call `handlePostback(admin, fbPageId, ev)`.
- Postbacks have no `mid`, so dedupe on a synthetic key `pb:{psid}:{timestamp}:{hash8(payload)}` written to `messenger_messages.fb_message_id`. Existing `(user_id, fb_message_id)` unique index handles Meta-side retries.

**`src/lib/facebook/messenger.ts`**
- No new functions needed. Verify `MessengerGenericElement.buttons` accepts postback buttons (`{ type: 'postback', title, payload }`); widen the type if it currently hard-codes URL.

### Files explicitly NOT touched

- `src/lib/messenger/outbound.ts` — catalog code paths preserved (Approach 2 promise)
- `src/lib/chatbot/recommend.ts` — same
- `src/lib/action-pages/rag/sync.ts` — properties already sync to `business_items` correctly with `kind='property'`
- `src/app/(app)/dashboard/action-pages/_kinds/realestate/Editor.tsx` — no editor surface changes

## Data flow

### Carousel send (LLM picks realestate page, no recommendation match)

```
chosen = realestate page
activeProperties = config.properties
                   .filter(p => p.status === 'for_sale' || p.status === 'for_rent')
                   .filter(p => p.title.trim())
                   .slice(0, 10)

if activeProperties.length === 0:
   send single button (existing behavior) — DONE

elements per property:
   title:    p.title (trim 80 chars)
   subtitle: [price_label, "City, Region"].filter(Boolean).join(' · ') (trim 80)
   image_url: primary gallery (g.find(g => g.primary) ?? gallery[0])?.url
   default_action: signed deeplink ?property=<propertySlug(p.id)>
   buttons:
     - { type:'web_url', title:'View property', url: <deeplink> }
     - { type:'web_url', title: chosen.cta_label || 'View all', url: <pageDeeplink> }

sendOutbound({ kind:'generic_template', elements }) → through normal policy
persist messenger_messages with body listing properties (parity with catalog)
```

### Recommendation send (LLM emits propertyRecommendation, RAG confident)

```
recommendProperty({
   userId, actionPageId: activeRealestatePageId,
   query, filters: { priceMin, priceMax, tags },
   confidenceThreshold,
})

→ ok: send single-element generic_template:
     image_url: cover (primary gallery)
     title:    property.title
     subtitle: caption + "\n" + price · "City, Region"  (trim to fit)
     buttons:
       - { type:'web_url',  title:'View property', url: <signed deeplink> }
       - { type:'postback', title:'Inquire',       payload: `rec_inquire:${slug}` }

→ low_confidence/no_match: do nothing → carousel block runs as fallback
→ no_action_page/no_products: skip silently (mirrors catalog)
```

### Postback inbound (lead taps "Inquire")

```
webhook receives ev.postback with payload "rec_inquire:<slug>"
handlePostback:
   1. Look up business_items where user_id = page.user_id, kind='property', slug=<slug>
      → not found → log warn, return null
   2. Resolve thread (upsert on psid, parity with handleEvent)
   3. Synthesize fb_message_id = `pb:${psid}:${timestamp}:${hash8(payload)}`
   4. Insert messenger_messages:
        direction='inbound', sender='lead',
        body=`I'd like more info on ${propertyTitle}`,
        fb_message_id=<synthetic>,
        attachments={ kind:'inquire_postback', property_id, property_slug }
        ON CONFLICT DO NOTHING (unique on user_id, fb_message_id)
   5. If conflict: return null (already processed)
   6. Update messenger_threads: last_inbound_at=now, last_message_at=now,
                                 last_message_preview=`📩 Inquire · ${propertyTitle}`
   7. Enqueue messenger_jobs row → return jobId
```

## Error handling

| Failure mode | Behavior |
|---|---|
| `recommendProperty` throws (RAG/RPC failure) | Catch in worker, log, fall through to carousel — same try/catch as catalog |
| `sendPropertyRecommendation` blocked by policy | Log, do NOT mark `recommendationSent` → carousel still runs |
| Carousel send blocked by policy | Log, fall back to single button (existing path) |
| Image send succeeds, button card blocked | Persist with `imageSent=true`, `sent: messageIds.length > 0` (parity with `sendProductRecommendation`) |
| Postback payload malformed (missing `:`, unknown prefix) | Log warn, return null — don't crash, don't enqueue |
| Postback property slug not found in business_items | Log warn (deleted property), return null — no fake inbound |
| Postback dedup conflict (Meta retry) | INSERT ON CONFLICT DO NOTHING returns no row → return null → no double-enqueue |
| Postback for thread that's bot-muted | Still synthesize the inbound; existing classify-only path handles it (consistent with typed text) |
| Empty `config.properties` or all draft/sold | Carousel falls through to single-button send |
| `MessengerGenericElement` type rejects postback buttons | Widen the type at the boundary — caught at compile time |
| Multiple realestate pages connected | `activeRealestatePageId = sendablePages.find(p => p.kind==='realestate')?.id` — picks first; same compromise as catalog |

## Idempotency

- **Carousel/recommendation:** worker reuses `job.outbound_button_fb_id` as the idempotency token on retries. If recommendation succeeded on first attempt, the retry skips both recommendation and carousel.
- **Postback ingestion:** synthetic `pb:` id + existing unique index. Meta-side postback retries collapse to one inbound message.

## Logging

Mirror catalog log keys for grep parity:
- `[messenger.worker] property recommendation send blocked`
- `[messenger.worker] recommendProperty declined`
- `[messenger.worker] realestate carousel policy_blocked`
- `[fb.webhook] postback received` / `[fb.webhook] postback property not found` / `[fb.webhook] postback malformed`

## Testing

### Unit tests

**`src/lib/chatbot/recommend-property.test.ts`** (mirror of `recommend.test.ts`)
- Returns `no_action_page` when page not found / wrong user
- Returns `no_products` when `config.properties` is empty
- Returns `no_products` when properties exist but none are synced into `business_items` yet
- Returns `low_confidence` with `bestConfidence` when reranker top score < threshold
- Returns `ok` with the right `RecommendedProperty` (title/slug/price/city/status) on a confident match
- Filters out sold/reserved properties (only `for_sale`/`for_rent` recommendable)
- Honors `priceMin` / `priceMax` / `tags` filters

Reuses fake `Embedder`/`Reranker` doubles from `recommend.test.ts`.

**`src/lib/messenger/property-outbound.test.ts`**
- `buildRealestateCarouselElements` (pure):
  - Caps at 10
  - Filters out non-active (`sold`/`reserved`/`draft`)
  - Filters out empty-title properties
  - Subtitle = `price · City, Region` joined with `·`, drops missing parts
  - Picks `primary: true` gallery image; falls back to first; absent → no image_url
  - Each card has `[View property, View all]` URL buttons; per-card deeplink has `?property=<slug>`
  - Truncates title/subtitle to Messenger limits
- `sendPropertyRecommendation`:
  - Builds correct deeplink with `?property=<slug>` and signed claims (PSID + page id, exp ~30d)
  - Generic template element has 2 buttons in correct order: `View property` (URL), `Inquire` (postback with `rec_inquire:<slug>`)
  - Sends image first when `cover_image_url` present, single template only when absent
  - Image-send blocked by policy → returns `sent:false` with reason, no follow-up
  - Image succeeds, template blocked → `sent: messageIds.length > 0`, `imageSent: true`, reason carried through
  - Updates `messenger_threads.last_outbound_at`

Mocks `sendOutbound` directly.

**`src/app/api/webhooks/facebook/_postback.test.ts`** (new, no catalog parallel)
- Malformed payload (no `:`, unknown prefix) → returns `null`, logs warn, no DB writes
- `rec_inquire:<slug>` for unknown slug → returns `null`, no inbound persisted, no job enqueued
- `rec_inquire:<slug>` for valid slug:
  - Inserts `messenger_messages` row with `direction:'inbound'`, `sender:'lead'`, body `"I'd like more info on {title}"`, `attachments.kind: 'inquire_postback'`, synthetic `pb:` id
  - Updates `messenger_threads.last_inbound_at`, `last_message_at`, `last_message_preview`
  - Returns a job id
- Duplicate postback (Meta retry, same payload+timestamp) → unique-index conflict → second call returns `null`, no second job
- Thread doesn't exist yet (rare — postback before any message) → upserts thread, then proceeds

### Integration tests

**`src/app/api/messenger/process/route.test.ts`** (extend existing)
- Realestate page chosen, no recommendation: carousel sent with N elements, single-button NOT sent
- Realestate page chosen, no active properties: falls back to single button (existing behavior preserved)
- Realestate page chosen, recommendation succeeds: recommendation card sent, carousel NOT sent (`recommendationSent` gates it)
- Realestate page chosen, recommendation low-confidence: carousel sent (fallback works)
- Carousel and recommendation both can fire in different turns of the same thread (state isolation)
- `outbound_button_fb_id` set after first send → retry of same job is a no-op (idempotency)

Add fakes for `recommendProperty` (avoid wiring HF embedder + RPC into route tests) following the same pattern catalog uses for `recommendProduct`.

### Not tested at this layer

- LLM tool emission itself (`classify.ts`) — covered by classifier-level tests; add a single shape assertion that `propertyRecommendation` appears in the tool list when `activeRealestatePageId` is provided.
- Meta API surface — `sendMessengerGenericTemplate` etc. mocked, same as catalog tests.
- RAG sync of properties into `business_items` — already covered by `rag/sync.ts` tests.

### Verification before "done"

- Project test command green for new + existing files
- Typecheck clean — including the `MessengerGenericElement` button union widening if needed
- Manual smoke: one realestate page with 3 active + 1 sold property; trigger via test PSID; confirm in Messenger that (a) carousel shows 3 cards, (b) "View property" deeplinks to single-property view, (c) "Inquire" postback round-trips and the bot replies, (d) recommendation flow works on a targeted query
