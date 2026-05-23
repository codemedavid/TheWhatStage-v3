# Unified RAG Knowledge Pipeline — Design

**Date:** 2026-05-23
**Status:** Draft — pending implementation plan

## Summary

Bring every business-knowledge surface — products, properties, sales-page offers, payment methods, action-page instructions, and customer order/submission state — into a single retrieval surface that the Messenger chatbot can ground its replies on. Auto-attach the right image (product cover, property gallery primary, sales hero, payment QR) the first time each item is discussed in a thread, and re-attach on explicit visual intent. Enforce closed-world rules for transactional facts (orders, submissions, payment account details) so the bot can be accurate without hallucinating.

## Motivation

The chatbot already grounds replies on a mature RAG infrastructure: a polymorphic `knowledge_chunks` table, BGE-M3 embeddings, BGE-Reranker-v2-m3, hybrid retrieval (BM25 + semantic via RRF), and a media-selection layer that attaches images when chunks contain `@asset-slug` or `#folder-slug` tokens. Catalog products, sales pages (as `business_items` kind `service`), realestate properties (each property as its own `business_items` row), and media assets are all indexed today.

Five concrete gaps remain:

1. **Payment methods** are stored in `payment_methods` but never embedded. The bot cannot quote your GCash number or list which methods a given action page accepts.
2. **Image auto-attach** only fires when the LLM picks `recommend_product` / `recommend_property`. On a plain "what materials is the X10 made of?" question, the customer never sees the product image.
3. **Per-page guidance** (the existing `bot_send_instructions` field on each action page and the `chatbot_configs.recommendation_rules.per_action_page[page_id]` thresholds) is in place, but retrieval isn't yet wired to scope payment methods or other per-page facts to the active page.
4. **Hallucination risk on transactional facts** — orders, submissions, and payment account numbers must never be paraphrased or invented. Today's grounding rules cover product/contact invention but don't explicitly cover orders or payment.
5. **First-mention discipline** — there's no mechanism to remember which items have already been shown as images in a thread, so any auto-attach logic would risk image fatigue without one.

## Decisions

The five design questions were resolved as follows:

1. **Orders and submissions:** keep the existing closed-world `leadContextBlock` injection per turn. Do not index orders/submissions into RAG.
2. **Per-action-page instructions:** keep the current surfaces (global `chatbot_configs.instructions` + per-page `bot_send_instructions` + `recommendation_rules.per_action_page[page_id]`). Do not add a new per-page instruction field.
3. **Image auto-attach policy:** hybrid — proactive on the first time an item is mentioned in a thread, intent-gated thereafter. Track via a new `messenger_threads.attached_item_keys text[]`.
4. **Payment methods scoping:** when an action page is active, scope to its `config.payment_method_ids[]`. Fall back to global enabled methods when no page is active.
5. **Action page deeplink:** unchanged — the LLM continues to be the sole picker via its `action_page` classification field.

**Architectural approach:** Approach 1 (unified polymorphic chunks) with a closed-world fallback for payment enumeration. Payment methods become a fifth source type in `knowledge_chunks`. A small `paymentEnumBlock` is injected into the prompt as a stable section so direct enumeration questions ("How can I pay?") have closed-world guarantees regardless of retrieval recall.

## Architecture & Data Flow

```
[ Customer message ]
        │
        ▼
[ Messenger worker · process route ]
        │
        ├──► Lead-context block builder    ──► closed-world: bookings/orders/submissions for this lead
        ├──► Payment-enum block            ──► closed-world: enabled payment methods scoped to active page
        ├──► Hybrid retriever (RPC)        ──► top-K chunks across all source types
        │
        ▼
[ LLM · answerWithClassification ]
        │   sees: persona, global instructions, lead context, payment enum,
        │   retrieved chunks (annotated with source markers), conversation
        │
        ├──► reply text
        ├──► action_page choice  (LLM-only, unchanged)
        └──► recommend_product / recommend_property  (LLM-only, unchanged)
        │
        ▼
[ Attach pipeline ]
        ├──► selectMediaForReply         (existing — @asset / #folder tokens via match_media_assets_service)
        │       └──► sendSelectedMedia   (existing — sends media images)
        ├──► resolveSourceImages         (NEW — FK switch over top retrieved chunks)
        ├──► firstMentionGate            (NEW — dedupe against attached_item_keys)
        │
        ▼
[ Outbound · sends in order ]
        1. media images        (from selectMediaForReply, existing path)
        2. source images       (NEW — from approved gate output, capped at 3 per turn)
        3. reply text          (or recommendation card, if LLM picked one)
        4. action page deeplink button (if LLM picked one)
```

Three new runtime pieces are introduced:

- `resolveSourceImages(chunks)` — given top retrieved chunks, switch on which FK is set and look up the image URL (product `cover_image_url`, sales gallery primary, property gallery primary, payment `qr_image_url`).
- `firstMentionGate({ threadId, candidates, customerText })` — reads/writes `messenger_threads.attached_item_keys`. Lets through items not yet seen; lets through any item when the customer's message has explicit visual intent.
- `paymentEnumBlock(supabase, userId, activePageId)` — closed-world prompt block listing enabled payment methods scoped to the active page (fallback: global).

**Anti-hallucination posture:**

1. Closed-world prompt blocks (lead context + payment enumeration) make refusal/deferral the default for facts that aren't listed.
2. Source markers on retrieved chunks (`[product:Title · id]`, `[payment:Name]`, etc.) anchor each fact to its origin so the LLM can cite-by-source.
3. Grounding rules in the system prompt are extended with product, property, payment, and order-specific clauses.

## Schema Changes & Sync Hooks

### Migration 1 — fifth source type on `knowledge_chunks`

```sql
ALTER TABLE public.knowledge_chunks
  ADD COLUMN payment_method_id uuid REFERENCES public.payment_methods(id) ON DELETE CASCADE;

ALTER TABLE public.knowledge_chunks
  DROP CONSTRAINT knowledge_chunks_one_source;

ALTER TABLE public.knowledge_chunks
  ADD CONSTRAINT knowledge_chunks_one_source
  CHECK (num_nonnulls(document_id, faq_id, business_item_id, media_asset_id, payment_method_id) = 1);

CREATE UNIQUE INDEX knowledge_chunks_payment_method_unique
  ON public.knowledge_chunks (payment_method_id, chunk_index)
  WHERE payment_method_id IS NOT NULL;

CREATE INDEX knowledge_chunks_payment_method_id_idx
  ON public.knowledge_chunks (payment_method_id)
  WHERE payment_method_id IS NOT NULL;
```

### Migration 2 — thread state for first-mention dedup

```sql
ALTER TABLE public.messenger_threads
  ADD COLUMN attached_item_keys text[] NOT NULL DEFAULT '{}';
```

Keys are short string identifiers shaped as `product:<id>`, `property:<id>`, `sales:<action_page_id>`, `payment:<id>`. The array accumulates per thread; the worker FIFO-trims to a cap of 100 entries to prevent unbounded growth on long-lived threads.

### Migration 3 — RPC update

Replace the body of `match_knowledge_hybrid_service` (no signature change to existing callers, additive parameter):

- Keep the existing `WHERE media_asset_id IS NULL` exclusion — media retrieval continues to flow through `match_media_assets_service` / `selectMediaForReply` as today. Media chunks are not surfaced into the LLM's content context.
- Include payment chunks in the candidate set when the chunk's parent method is enabled.
- Add optional `p_payment_method_ids uuid[] DEFAULT NULL`. When non-null, payment chunks are filtered to that set; when null, no payment filter (returns global enabled payment chunks for the user).
- Add `payment_method_id` to the return columns.

### New rag-text builder — `src/lib/payment-methods/rag-text.ts`

```ts
buildPaymentMethodRagText(method: PaymentMethod): string
```

Emits a stable text shape:

```
Payment method: GCash · Main
Kind: gcash
Account name: Juan Dela Cruz
Account number: 0917-123-4567
Instructions: Send exact amount, then upload receipt.
QR image: @qr-gcash-main
```

The `@qr-<slug>` token participates in the existing media-attach mechanism when the QR is stored as a media asset. For QR images stored only as URLs (`details.qr_image_url`), the resolver in the next section handles attachment directly.

### Sync hooks

- `syncPaymentMethodToKnowledge(supabase, userId, paymentMethodId)` — invoked from the payment method create/update server actions. Builds rag-text, enqueues an embed job via the existing worker pipeline.
- Embed worker (`src/lib/rag/worker/embed-job.ts`) gains a `payment_method` branch. Reuses chunking, content-hash-skip, idempotent upsert.
- Disabling a method (`enabled = false`) causes the next worker run to write zero chunks; the existing "delete chunks not in new set" branch removes stale rows.

### Backfill

One-off script `scripts/rag/backfill-payment-methods.ts` enqueues an embed job for every existing payment method row. Idempotent — safe to re-run.

## Retrieval, Image Auto-Attach, Closed-World Fallbacks

### Retrieval call

`src/lib/chatbot/classify.ts` computes `activePaymentMethodIds` once per turn:

- The "active page" is whichever of `activeCatalogPageId`, `activeSalesPageId`, or `activeRealestatePageId` is set on the classification input. When more than one is set (rare), prefer the one most recently mentioned in the conversation; ties fall back to the first non-null in that order.
- Read the active page's `config.payment_method_ids[]`. Pass to the RPC as `p_payment_method_ids`.
- When no active page exists, pass `NULL` — retrieval falls back to all enabled payment chunks for the user.

The same `activePageId` value is passed to `paymentEnumBlock()` so retrieval and the closed-world enumeration agree on scope every turn.

### Source resolver — `src/lib/chatbot/source-images.ts`

```ts
type SourceImage = {
  sourceKey: string         // "product:abc123" | "property:p-xyz" | "sales:<actionPageId>" | "payment:m-789"
  imageUrl: string
  altText?: string
  rerankerScore: number
}

resolveSourceImages(
  chunks: RetrievedChunk[],
  supabase: SupabaseClient,
): Promise<SourceImage[]>
```

Per source FK:

- `business_item_id` → fetch the row, branch on `kind`:
  - `product` → `cover_image_url`.
  - `property` → look up the realestate config from `action_pages` via `action_page_id`, find the property by slug, return gallery primary.
  - `service` (sales) → look up the sales config, return gallery primary.
- `payment_method_id` → `details.qr_image_url` from the parent `payment_methods` row.
- `document_id` / `faq_id` → no image.

Media chunks (`media_asset_id`) never reach the resolver — they continue to flow through the existing `selectMediaForReply` path, which runs alongside the resolver in the worker. Both paths write to the same outbound queue; the worker dedupes by image URL before sending so an asset surfaced by both paths is sent only once.

Within a single turn, collapse to one image per `sourceKey` (keep the highest reranker score).

### Attach gate — `src/lib/chatbot/attach-gate.ts`

```ts
firstMentionGate(args: {
  threadId: string
  attachedItemKeys: string[]
  candidates: SourceImage[]
  customerText: string
}): { approved: SourceImage[]; newKeys: string[] }
```

Logic:

1. For each candidate: if its `sourceKey` is **not** in `attachedItemKeys`, approve unconditionally (first-mention).
2. If it **is** in `attachedItemKeys`, approve only when `hasVisualIntent(customerText)` returns true.
3. Cap approved set at **3 images per turn** to prevent floods on broad queries.
4. Return the approved set plus the new keys to append.

`hasVisualIntent` is a small dependency-free predicate matching English and Tagalog visual cues: "show", "show me", "photo", "picture", "see it", "what does it look like", "any photos", "ipakita", "litrato". Failing the predicate only matters for already-seen items; first-mention never depends on it.

### Send order in the worker

In `src/app/api/messenger/process/route.ts`, between `sendSelectedMedia` and the recommendation/text branches:

1. Run `resolveSourceImages(topChunks)` over the same chunks the LLM was given.
2. Run `firstMentionGate` against the thread's current `attached_item_keys`.
3. Send each approved image via `sendOutbound` (kind `image`). Persist `messenger_messages` rows with `attachments: { kind: 'source_image', sourceKey, chunk_id }` for observability.
4. After all sends, update `messenger_threads.attached_item_keys` with the new keys (FIFO-trim to 100).

The existing `sendProductRecommendation` / `sendPropertyRecommendation` gain a "skip image if the same `sourceKey` is already in `attached_item_keys`" check so the LLM-driven path and the auto-attach path never duplicate the same image.

### Closed-world fallbacks

Two blocks are injected ahead of the retrieved-chunks section in the prompt:

- **Lead context block** (existing): bookings, orders, submissions for this lead. The system-prompt rule is extended: "These are the customer's *only* known bookings/orders/submissions. If they ask about anything not listed here, say you don't have a record of it. Never invent dates, order IDs, statuses, or amounts."
- **Available Payment Methods block** (new): assembled by `paymentEnumBlock()`. Always injected when there's an active page with `payment_method_ids[]`; otherwise injected when the user has any enabled payment methods. Shape:

```
Available Payment Methods (scoped to <Page Title>):
- GCash · Main: Account 0917-123-4567, send exact amount.
- Bank Transfer · BPI: 1234-5678-90, name Juan Dela Cruz.
```

System-prompt rule: "If a customer asks how to pay, list only methods in 'Available Payment Methods'. Do not mention methods not in that block. Never invent or paraphrase account numbers."

### Source markers on retrieved chunks

`src/lib/rag/prompt-builder.ts` annotates each retrieved chunk with a one-line prefix when assembling the prompt:

- `[product:<title> · <id>]`
- `[property:<title> · <id>]`
- `[sales:<title> · <action_page_id>]`
- `[payment:<name>]`
- `[doc:<title>]`
- `[faq:<question>]`

This is a prompt-only change — no schema impact. The LLM uses these markers to cite-by-source and to obey source-specific grounding rules.

### Anti-hallucination prompt edits

Extensions to `DEFAULT_CHATBOT_PERSONA` grounding rules:

- "Product details, prices, features, and inventory status come only from chunks marked `[product:...]`. Do not invent specs."
- "Property details (price, location, specs, amenities) come only from chunks marked `[property:...]`."
- "Payment account numbers, names, and instructions come only from 'Available Payment Methods'. Never invent or paraphrase account numbers."
- "Customer order/booking/submission state comes only from 'Customer Records'. If asked about a record not present there, say you don't have it on file."

## Customer Journey Walk-Throughs

Six representative conversations, end-to-end.

**Journey A — "Do you have running shoes under 3k?"** (catalog page active)

1. Retrieval scopes by the catalog page's `product_ids[]`. Top chunks: `[product:X10 Runner]`, `[product:Y20 Trainer]`, scores ~0.7.
2. `resolveSourceImages` → two `product:` candidates with cover URLs.
3. `firstMentionGate` → neither key in `attached_item_keys` → both pass (under the 3-image cap).
4. LLM sees retrieved chunks + payment enum block. LLM picks `recommend_product` for the best match (X10).
5. Send order: image of X10 → image of Y20 → recommendation card (X10 with description, price, deeplink). `recommend_product`'s internal image-send sees X10 already attached and skips its image step.
6. `attached_item_keys` ← `["product:X10", "product:Y20"]`.

**Journey B — "What materials is the X10 made of?"** (same thread, immediately after A)

1. Retrieval returns chunks for X10.
2. `resolveSourceImages` → `product:X10`, already in `attached_item_keys`, no visual intent → gate skips.
3. LLM answers from the chunk: "The X10 uses a recycled mesh upper with EVA midsole..." No image (correct — customer already saw it).

**Journey C — "Can you show me the X10 again?"** (same thread)

1. Retrieval same as B.
2. `firstMentionGate` sees `hasVisualIntent("show me") === true` → X10 image passes despite being already attached.
3. Image re-sent; text reply confirms.

**Journey D — "How do I pay?"** (catalog page active; scoped to GCash + BPI)

1. Retrieval surfaces payment chunks; LLM also sees the `paymentEnumBlock` covering both.
2. `resolveSourceImages` → both `payment:` candidates surface QR URLs if available. Both pass the gate.
3. LLM replies listing GCash and BPI account numbers and instructions, sourced strictly from the enumeration block.
4. Send order: GCash QR → BPI QR → text reply.
5. `attached_item_keys` ← `[..., "payment:gcash-main", "payment:bpi-main"]`.

**Journey E — "Tell me about the condo in Makati"** (realestate page active)

1. Retrieval scoped to the realestate page's properties. Top chunk: `[property:Makati Condo · ID p-abc]`, score 0.75.
2. `resolveSourceImages` → property gallery primary URL.
3. First-mention → passes.
4. LLM answers using the property chunk: price, address, amenities, financing options.
5. If the page's `bot_send_instructions` says "send link when discussed in detail," LLM also emits `action_page` → `sendPropertyRecommendation` runs, sees image already attached, skips re-send, sends the card and deeplink.

**Journey F — "Has my last order shipped?"** (no RAG path)

1. Retrieval may return nothing relevant. The lead-context block contains: "Orders: #ORD-123 placed 2026-05-21, status: confirmed, payment: paid."
2. LLM answers strictly from that block: "Your order #ORD-123 is confirmed and paid as of May 21. I don't have shipping status on file — I can check with the team."
3. If no orders in block: "I don't see any orders on your account — want me to walk you through placing one?"

## Phasing, Migration, Testing

### Phase 1 — Payment methods enter RAG

- Migration 1 (above): `payment_method_id` column, one-source check update, indexes.
- New `src/lib/payment-methods/rag-text.ts` builder.
- Embed worker `payment_method` branch.
- Sync hooks from `payment_methods` create/update server actions.
- Backfill script.
- RPC update (Migration 3): scope by `p_payment_method_ids`, stop excluding payment chunks.
- Tests: rag-text builder snapshots (gcash / bank / other / no-qr / disabled), sync hook integration, RPC scoping.

### Phase 2 — Closed-world payment enumeration block

- New `src/lib/chatbot/payment-enum.ts` → `paymentEnumBlock(supabase, userId, activePageId)`.
- Inject in `src/lib/rag/prompt-builder.ts` as a stable section above retrieved chunks.
- Extend grounding rules with payment-specific clauses.
- Tests: enumeration content (scoped + unscoped), prompt-assembly snapshot, prompt-rule presence.

### Phase 3 — Source resolver + first-mention attach gate

- Migration 2 (above): `messenger_threads.attached_item_keys`.
- New `src/lib/chatbot/source-images.ts` (resolver) and `src/lib/chatbot/attach-gate.ts` (gate + intent predicate).
- Wire into `src/app/api/messenger/process/route.ts` between `sendSelectedMedia` and the recommendation/text branches.
- Existing recommendation senders gain the "skip image if `sourceKey` already in keys" check.
- Tests: resolver per-source-type, gate state transitions, intent matcher edges, integration tests for Journeys A–C.

### Phase 4 — Source markers + anti-hallucination prompt tightening

- Prompt builder annotates each chunk with a one-line source marker.
- Extend grounding rules for product, property, payment, order/submission.
- Tests: prompt snapshots, grounding-rule presence assertions.

Each phase ends deployable. Schema migrations are additive — `ADD COLUMN`, `CREATE INDEX`, new RPC body. Reverting is a single `DROP`/restore. Runtime code is gated by feature flags (`RAG_PAYMENT_ENABLED`, `IMAGE_AUTO_ATTACH_ENABLED`) so each phase can be toggled off in production without redeploy.

### Backfill order

1. Apply schema migrations (additive — no breaking changes).
2. Run payment-method backfill script.
3. Deploy code that reads new columns. Reading the new column before backfill is safe — it's nullable; retrieval simply yields no payment chunks until rows arrive.

### Testing strategy

- **Unit:** rag-text builders, source-image resolver per source type, attach-gate state transitions, visual-intent matcher, payment-enum scoping.
- **Integration (Supabase test DB):** RPC scoping correctness, sync-on-update behavior, backfill idempotency.
- **End-to-end (messenger worker):** Journeys A–F as fixture-driven tests against the process route.
- **Anti-hallucination probes:** adversarial messages ("you accept Maya, right?" when Maya isn't enabled; "what's order #FAKE-999?"). Tests assert the reply refuses or defers rather than confirms.

### Observability

- Log lines per attach decision: `{ thread_id, sourceKey, action: 'attached' | 'skipped:already_seen' | 'skipped:cap', score }`.
- `messenger_messages.attachments` rows tagged `kind: 'source_image'` carry `sourceKey` and the originating chunk id.
- Dashboard tile: percentage of replies where a source image was attached — sanity check against silent-or-spamming failure modes.

## Out of Scope

- Per-action-page chatbot instructions UI (Decision 2 keeps the existing surfaces).
- Indexing customer orders or submissions into RAG (Decision 1 keeps the closed-world lead-context block).
- Changes to the LLM-driven action-page deeplink decision (Decision 5 — status quo).
- Multi-modal embeddings — image attachment is by URL via the resolver, not by semantic image search.
