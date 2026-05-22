# Facebook Conversions API (Business Messaging) on Action Pages — Design

**Status:** Approved (brainstorming complete)
**Date:** 2026-05-22
**Author:** John Angelo David (via Claude)

## Problem

When a lead submits an action page after coming through a Messenger conversation, Meta has no idea the conversion happened. We can see in the dashboard that "Page A" → "thread" → "form submission" worked, but Meta's ad-optimization engine never gets the signal. For users running Click-to-Messenger campaigns, the loop is broken: they're paying Meta to drive Messenger traffic, but Meta can't optimize because we never tell it which clicks turned into business outcomes.

Meta's **Conversions API for Business Messaging** is the documented way to close this loop. It accepts server-side events with `action_source: "business_messaging"`, tied to a `page_id` + `page_scoped_user_id` (PSID), and feeds them into the same attribution + audience-building machinery as the browser Pixel. Reference: <https://developers.facebook.com/documentation/ads-commerce/conversions-api/business-messaging>.

We want every action-page submission that originated from a Messenger thread to fire a corresponding CAPI event, so ad spend on CTM campaigns starts optimizing against real outcomes.

## Goals

1. Fire CAPI events to Meta on every action-page submission that has a Messenger context (`psid` + `page_id`).
2. Cover all six action-page kinds with sensible default `event_name` mapping (Lead / Schedule / Purchase / InitiateCheckout), overridable per page.
3. Per-Facebook-Page configuration UI (dataset ID, CAPI access token, test event code, enable toggle) on the existing Settings → Facebook page.
4. Send full hashed-PII `user_data` (em, ph, fn, ln, external_id, ip, ua) for best match quality.
5. Persist a log row for every dispatch (sent / skipped / error) for debugging and future retry.
6. Never block the submit response on CAPI calls — fire-and-forget.

## Non-Goals (v1)

- **Click-to-Messenger ad attribution** (`messaging_referral.ad_id`). Separate v2 spec — see the v2 sketch at the bottom. v1 ships without ad attribution; events still fire, Meta just can't tie them back to the originating ad until v2.
- **Retry worker.** Failures are logged but not retried. The log table is the seed if we add retries later.
- **Multiple datasets per page.** One dataset per Facebook Page.
- **Pixel/browser dedup.** Action pages don't run a browser pixel today, so there's nothing to dedup against. `event_id` is still set on every event so a future browser pixel layer Just Works.
- **WhatsApp / Instagram messaging channels.** Only Messenger (`messaging_channel: "messenger"`).
- **Custom event names beyond Meta's standard list.**
- **Backfill of past submissions.**

## Architecture

A new module **`src/lib/facebook/capi.ts`** exposes a single `dispatchCapiEvent(input)` function. The submit route at `src/app/api/action-pages/submit/route.ts` `void`s this call right after the existing stage-move / Messenger echo / attached-page blocks. The dispatcher is the only module that talks to Meta's Graph API for CAPI.

```
POST /api/action-pages/submit
   │ existing flow: parse → insert submission → stage move
   │                → messenger echo → attach action page
   ▼
   dispatchCapiEvent(...)  ──void──▶  src/lib/facebook/capi.ts
                                          │
                                          ├─ resolve config (facebook_pages CAPI cols)
                                          ├─ resolveEventName(kind, outcome, hasPayment, override)
                                          ├─ build user_data (hash em/ph/fn/ln/external_id)
                                          ├─ build custom_data (value/currency/content_ids/order_id)
                                          ├─ POST graph.facebook.com/v19.0/{dataset_id}/events
                                          └─ insert capi_event_logs row
```

**Module boundaries:**

- `src/lib/facebook/capi.ts` — dispatcher. Talks to Graph. Writes the log. Never throws.
- `src/lib/facebook/capi-mapping.ts` — pure function: `(kind, outcome, hasPayment, override) → event_name | skip`.
- `src/lib/facebook/capi-payload.ts` — pure helpers: PII normalization, hashing, envelope assembly.
- `src/app/(app)/dashboard/settings/facebook/_components/capi-section.tsx` — config UI.
- `src/app/(app)/dashboard/settings/facebook/_components/capi-page-form.tsx` — per-page form (client component).
- `src/app/(app)/dashboard/settings/facebook/_components/capi-recent-events.tsx` — last-20 log viewer.

## Trigger Scope

CAPI events fire when **all** of the following are true:

1. The submission has a verified Messenger context (`psid` + `fbPageId` both resolved from the signed deeplink, per `submit/route.ts:202-243`).
2. The Facebook Page has `capi_enabled = true` AND both `capi_dataset_id` and `capi_access_token` are set.
3. The kind+outcome+payment-state combination maps to a real event_name (not the explicit `SKIP` value, not an unmapped outcome).

If any condition fails, a `capi_event_logs` row is still inserted with `status='skipped'` and the corresponding `skip_reason` (`'no_messenger_context'`, `'disabled'`, `'not_configured'`, or `'outcome_skip'`). No network call is made.

## Event Name Mapping

Lives in `src/lib/facebook/capi-mapping.ts` as a pure function:

```ts
type MappingResult =
  | { send: false; reason: 'outcome_skip' }
  | { send: true; eventName: StandardEvent }

interface MappingInput {
  kind: ActionPageKind
  outcome: string
  hasPayment: boolean
  override: string | null  // action_pages.capi_event_name_override
}

export function resolveEventName(input: MappingInput): MappingResult
```

Default table:

| Kind | Outcome | Payment? | event_name |
|---|---|---|---|
| form | `submitted` | — | `Lead` |
| booking | `booked` | — | `Schedule` |
| qualification | `qualified` | — | `Lead` |
| qualification | `disqualified` | — | *skip* |
| qualification | `pending_review` | — | *skip* |
| sales | `submitted` | no | `InitiateCheckout` |
| sales | `submitted` | yes | `Purchase` |
| catalog | `checked_out` | no | `InitiateCheckout` |
| catalog | `checked_out` | yes | `Purchase` |
| realestate | `inquiry_submitted` | — | `Lead` |
| realestate | `viewing_booked` | — | `Schedule` |

`hasPayment` resolution:
- **sales**: true when `parsedData.payment_method_id` is a non-empty string OR `parsedData.payment_proof_url` is a non-empty string.
- **catalog**: true when `catalogOrderResult` exists AND the resulting `payment_status` is not `'unpaid'` (i.e. method was chosen or proof uploaded — see `submit/route.ts:957-958`).
- All other kinds: ignored.

Override precedence (`action_pages.capi_event_name_override`):
- `'SKIP'` → never send for this page (log skipped, reason `'outcome_skip'`).
- Any other string value → use it verbatim as `event_name`.
- `null` → use the table default.

Unknown outcomes (not in the table) → skip with reason `'outcome_skip'`.

## Payload

Built in `src/lib/facebook/capi-payload.ts`.

### `user_data`

```ts
interface UserData {
  page_id: string                  // facebook_pages.fb_page_id (Meta's id)
  page_scoped_user_id: string      // submission.psid
  em?: string[]                    // sha256-hashed lowercased trimmed emails
  ph?: string[]                    // sha256-hashed digits-only phones
  fn?: string[]                    // sha256-hashed lowercased first name
  ln?: string[]                    // sha256-hashed lowercased last name
  external_id?: string[]           // sha256-hashed lead.id
  client_ip_address?: string       // raw (Meta hashes server-side)
  client_user_agent?: string       // raw
}
```

Sources:
- `page_id` ← `facebook_pages.fb_page_id` (the Meta-side id, not our uuid).
- `page_scoped_user_id` ← `submission.psid`.
- `em` / `ph` ← from `extractContactsFromSubmission(page.kind, parsed.data, page.config)` (same helper the existing `appendLeadContacts` flow uses). Each value normalized (`em`: trim + lowercase; `ph`: digits only, dropping `+` and non-numeric chars) then sha256-hashed.
- `fn` / `ln` ← split the lead's display name (from `leads.name` when `lead_id` is present, otherwise from `parsed.data.full_name`) on first whitespace. Each part trimmed + lowercased then sha256-hashed. If only one part, it goes in `fn` and `ln` is omitted.
- `external_id` ← sha256-hashed `lead.id` when `lead_id` is present; omitted otherwise.
- `client_ip_address` ← the raw IP already extracted at `submit/route.ts:318-321`. (We send raw, not the existing `hashIp` value, because Meta expects raw IP for IP-based matching.)
- `client_user_agent` ← already captured at `submit/route.ts:322`.

Hashing helper:

```ts
import { createHash } from 'node:crypto'
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
```

All hashed array fields are omitted entirely when empty (don't send `em: []`).

### `custom_data`

```ts
interface CustomData {
  currency?: string
  value?: number
  content_ids?: string[]
  content_type?: 'product'
  num_items?: number
  order_id?: string
}
```

Per kind:

- **catalog** → `currency` (from `catalogOrderResult.currency`), `value` (= `catalogOrderResult.subtotal`), `content_ids` (= each line's `business_item_id`), `content_type: 'product'`, `num_items` (= sum of `lines[].quantity`), `order_id` (= `businessOrderId`).
- **sales with payment** → `currency` (from `parsed.data.payment_currency` if string, else page.config `price.currency` if string), `value` (from `parsed.data.payment_amount` if number), `order_id` (= submission `id`), `content_ids: [action_page.id]`, `content_type: 'product'`. Only included when both `currency` and `value` resolve.
- **sales without payment, booking, form, qualification, realestate** → `content_ids: [action_page.id]`. No monetary fields.

**Catalog payload shape change required:** the existing `CatalogOrderResult.lines` type at `submit/route.ts:797-802` doesn't include `business_item_id`. We add it to the result shape (single field added to the existing line construction at `submit/route.ts:879-889`, where `business_item_id` is already in scope from `items[].id`).

### Event envelope

```ts
interface CapiEvent {
  event_name: string               // resolved per mapping
  event_time: number               // Math.floor(Date.now() / 1000) at dispatch
  event_id: string                 // = submission.id (uuid)
  action_source: 'business_messaging'
  messaging_channel: 'messenger'
  event_source_url?: string        // public deeplink for this submission
  user_data: UserData
  custom_data?: CustomData
}

interface CapiRequest {
  data: CapiEvent[]                // always length 1 in v1
  test_event_code?: string         // when facebook_pages.capi_test_event_code is set
}
```

POST URL: `https://graph.facebook.com/v19.0/{capi_dataset_id}/events?access_token={decrypted_capi_access_token}`.

Headers: `Content-Type: application/json`.

API version (`v19.0`) matches the existing `src/lib/facebook/oauth.ts:1`. When `oauth.ts` bumps, `capi.ts` bumps in lock-step.

## Dispatcher

`src/lib/facebook/capi.ts` exposes:

```ts
interface DispatchInput {
  admin: ReturnType<typeof createAdminClient>
  userId: string
  submissionId: string
  actionPageId: string
  actionPageKind: ActionPageKind
  outcome: string
  psid: string | null
  pageRowId: string | null         // facebook_pages.id (our uuid)
  parsedData: Record<string, unknown>
  pageConfig: Record<string, unknown>
  leadId: string | null
  clientIp: string | null
  clientUserAgent: string | null
  submissionCreatedAt: Date
  businessOrderId: string | null
  catalogOrder: {
    subtotal: number
    currency: string
    lines: { business_item_id: string; quantity: number }[]
    paymentStatus: 'unpaid' | 'pending' | 'paid'
  } | null
}

export async function dispatchCapiEvent(input: DispatchInput): Promise<void>
```

**Flow:**

1. **Skip if `!psid || !pageRowId`** → log `skipped`, reason `'no_messenger_context'`. Return.
2. **Load `facebook_pages`** by `pageRowId`: `fb_page_id, capi_enabled, capi_dataset_id, capi_access_token, capi_test_event_code`. If `!capi_enabled` → log `skipped`, reason `'disabled'`. If `!capi_dataset_id || !capi_access_token` → log `skipped`, reason `'not_configured'`.
3. **Load `action_pages.capi_event_name_override`** by `actionPageId`.
4. **Compute `hasPayment`** (see "Event Name Mapping" above).
5. **`resolveEventName({ kind, outcome, hasPayment, override })`** → if skip → log `skipped`, reason `'outcome_skip'`. Return.
6. **Load lead contacts** when `leadId` is set: `admin.from('leads').select('phones, emails, name').eq('id', leadId).maybeSingle()`. Use parsed-data fallback when lead absent.
7. **Build `user_data`** + **`custom_data`** per the Payload section above.
8. **Build `event_source_url`** = the public action-page URL (`${NEXT_PUBLIC_APP_URL}/a/${slug}`) when slug available; omit otherwise. (Caller already knows the slug; pass it through.)
9. **POST** to Meta. Use `fetch` with a 10s `AbortController` timeout. Body: `JSON.stringify({ data: [event], test_event_code? })`.
10. **Log** the outcome:
    - 2xx → `status='sent'`, capture `http_status`, `fb_trace_id` (from response header `x-fb-trace-id` or `x-fb-debug` — verify at implementation).
    - non-2xx → `status='error'`, capture `http_status`, `fb_trace_id`, `response_body` (parsed JSON).
    - timeout / network error → `status='error'`, `error_message`.
11. **Return void.** Never throws.

If the log insert itself fails, `console.warn` and continue. Don't break submit.

`request_payload` stored in the log row is the exact envelope sent to Meta — **but only the hashed PII**, never plaintext. Because `user_data.em/ph/fn/ln/external_id` are already hashed before they reach the network, the log row is safe.

## Call site (single new block in submit route)

Added right after the existing `dispatchSubmissionReceived` block at `submit/route.ts:543-553`:

```ts
if (subInsert?.id) {
  dispatchCapiEvent({
    admin,
    userId: page.user_id,
    submissionId: subInsert.id,
    actionPageId: page.id,
    actionPageKind: page.kind as ActionPageKind,
    outcome: parsed.outcome,
    psid,
    pageRowId: fbPageId,
    parsedData: parsed.data,
    pageConfig: page.config,
    leadId,
    clientIp: ip,
    clientUserAgent: ua,
    submissionCreatedAt: new Date(),
    businessOrderId,
    catalogOrder: catalogOrderResult
      ? {
          subtotal: catalogOrderResult.subtotal,
          currency: catalogOrderResult.currency,
          lines: catalogOrderResult.lines.map(l => ({
            business_item_id: l.business_item_id,
            quantity: l.quantity,
          })),
          paymentStatus:
            (catalogOrderResult.paymentStatus as 'unpaid' | 'pending' | 'paid'),
        }
      : null,
  }).catch((e) => console.error('[capi] dispatchCapiEvent threw', e))
}
```

`CatalogOrderResult` gets one new field (`business_item_id` on each line, `paymentStatus` on the result) — see the small refactor in "Payload → custom_data".

## Data Model

One migration: `supabase/migrations/20260606000000_facebook_capi.sql`.

```sql
-- Per-page CAPI configuration. Nullable so existing pages stay unaffected
-- until the user opts in via Settings → Facebook → Conversions API.
alter table public.facebook_pages
  add column capi_enabled         boolean not null default false,
  add column capi_dataset_id      text,
  add column capi_access_token    text,  -- encrypted via crypto.ts (same scheme as page_access_token)
  add column capi_test_event_code text;

alter table public.facebook_pages
  add constraint facebook_pages_capi_complete_when_enabled
  check (
    capi_enabled = false
    or (capi_dataset_id is not null and capi_access_token is not null)
  );

-- Per-action-page override. NULL = use kind default.
alter table public.action_pages
  add column capi_event_name_override text
  check (capi_event_name_override is null or capi_event_name_override in (
    'Lead','Schedule','Purchase','InitiateCheckout',
    'CompleteRegistration','Contact','Subscribe',
    'SubmitApplication','AddToCart','ViewContent',
    'SKIP'
  ));

-- Append-only log of every CAPI attempt (sent, skipped, or errored).
create table public.capi_event_logs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  page_id         uuid references public.facebook_pages(id) on delete set null,
  submission_id   uuid references public.action_page_submissions(id) on delete set null,
  action_page_id  uuid references public.action_pages(id) on delete set null,
  event_name      text,
  event_id        text not null,
  status          text not null check (status in ('sent','skipped','error')),
  skip_reason     text check (skip_reason is null or skip_reason in (
                    'no_messenger_context','disabled','not_configured','outcome_skip'
                  )),
  http_status     integer,
  fb_trace_id     text,
  request_payload jsonb,
  response_body   jsonb,
  error_message   text,
  created_at      timestamptz not null default now()
);

create index capi_event_logs_user_idx     on public.capi_event_logs (user_id, created_at desc);
create index capi_event_logs_page_idx     on public.capi_event_logs (page_id, created_at desc);
create index capi_event_logs_event_id_idx on public.capi_event_logs (event_id);

alter table public.capi_event_logs enable row level security;

create policy capi_event_logs_owner_read on public.capi_event_logs
  for select to authenticated using (user_id = auth.uid());

create policy capi_event_logs_admin_all on public.capi_event_logs
  for all to authenticated
  using (public.current_role() in ('admin','superadmin'))
  with check (public.current_role() in ('admin','superadmin'));

-- Inserts come from the service-role admin client only; no insert policy for authenticated.
```

`capi_access_token` is encrypted at write time using `encryptToken` from `src/lib/facebook/crypto.ts`, decrypted at dispatch via `decryptToken`. Same scheme as `facebook_pages.page_access_token`.

## Configuration UI

Lives under the existing **Settings → Facebook** page. New dedicated "Conversions API" section rendered below the connected-pages list. Server-side rendered shell, client form per page.

**File touches:**

- `src/app/(app)/dashboard/settings/facebook/page.tsx` — render `<CapiSection pages={pages} userId={session.userId} />` below the existing `<ConnectedView />` when there are connected pages.
- `src/app/(app)/dashboard/settings/facebook/_components/capi-section.tsx` — new. Server component. Loads each page's CAPI config + last 20 log rows.
- `src/app/(app)/dashboard/settings/facebook/_components/capi-page-form.tsx` — new. Client component. Per-page form with enable toggle, dataset id, access token, test event code, save button, test-event button.
- `src/app/(app)/dashboard/settings/facebook/_components/capi-recent-events.tsx` — new. Client component (read-only). Shows last 20 `capi_event_logs` across all pages for the user, with status icon, event_name, action_page slug, http_status, and a "view payload" disclosure.
- `src/app/(app)/dashboard/settings/facebook/actions.ts` — add:
  - `saveCapiConfigForm(formData)`: per-page save. Validates dataset_id + token presence when enabled. Token field uses a sentinel to distinguish "leave unchanged" from "clear". Encrypts token before insert/update.
  - `sendCapiTestEventForm(formData)`: builds a synthetic `Lead` event for the chosen page using the configured `test_event_code`, calls `dispatchCapiEvent`, redirects with a success/error flash.

**Per-page form layout:**

```
┌─ Page Name ─────────────────────────────────────┐
│ ☐ Enabled                                       │
│ Dataset ID (Pixel ID)  [ 1234567890     ]       │
│ CAPI Access Token      [ ••••••• [Edit] ]       │
│ Test Event Code        [ TEST12345     ] (opt)  │
│ [ Send test event ]  [ Save ]                   │
└─────────────────────────────────────────────────┘
```

**Token UX:** when a token is already stored, render `••••••` plus an "Edit" button that reveals an empty input. Saving with an untouched input preserves the existing encrypted value (form sends a `token_unchanged=true` hidden field). Saving with a non-empty input replaces the encrypted value.

**Test event button:** server action builds a synthetic event with `event_name: 'Lead'`, real `dataset_id`/`token`/`test_event_code`, a synthetic `event_id` (`test-${uuid}`), `event_time: now`, and dummy `user_data: { page_id, page_scoped_user_id: 'TEST_PSID', client_ip_address: '127.0.0.1', client_user_agent: 'test' }`. Goes through the same `dispatchCapiEvent` path so the log row appears alongside real events. Surfaces the response in a flash banner.

**Per-action-page override** (smaller, separate UI touch):

In the action-page editor (`src/app/(app)/dashboard/action-pages/[id]/page.tsx` and its components), add a single field within the existing "Pipeline rules" or "Advanced" section:

- Label: `Send to Facebook as`
- Component: `<Select>`. Options: `Use default (<kind default>)` / `Lead` / `Schedule` / `Purchase` / `InitiateCheckout` / `CompleteRegistration` / `Contact` / `Subscribe` / `SubmitApplication` / `AddToCart` / `ViewContent` / `Don't send`
- The `<kind default>` text reads dynamically from the mapping table so users see what they're overriding.
- Bound to `action_pages.capi_event_name_override`. `Use default` → `null`; `Don't send` → `'SKIP'`; everything else → the literal event name.
- Help text: `"When a Messenger lead submits this page, we tell Facebook what kind of conversion happened. Choose 'Don't send' to skip this page entirely."`

## Error Handling

| Condition | Behavior |
|---|---|
| No Messenger context | Log `skipped`, reason `no_messenger_context`. No network call. |
| `capi_enabled = false` | Log `skipped`, reason `disabled`. |
| Missing dataset_id or token | Log `skipped`, reason `not_configured`. |
| Outcome maps to skip OR override is `'SKIP'` | Log `skipped`, reason `outcome_skip`. |
| Network timeout (>10s) | Log `error`, `error_message='timeout'`. No retry. |
| Network error (DNS, refused) | Log `error`, `error_message=<err.message>`. |
| Meta 4xx (bad token, bad dataset, validation) | Log `error`, capture `http_status`, `fb_trace_id`, `response_body`. No retry. |
| Meta 5xx | Log `error`, same capture. No retry. |
| Lead contacts query fails | Log `error` with note; still proceed with no PII (best-effort). |
| Log insert fails after dispatch | `console.warn`. Don't break submit. |

Submit response is **never** affected by CAPI outcome. The original `subInsert?.id` and redirect/json response paths are untouched.

## Security & Privacy

- `capi_access_token` is encrypted at rest via the existing `encryptToken` (same KDF + algorithm as `page_access_token` — see `src/lib/facebook/crypto.ts`).
- All PII (`em`, `ph`, `fn`, `ln`, `external_id`) is sha256-hashed on our server **before** the network call. The log row's `request_payload` captures the hashed values, never plaintext.
- `client_ip_address` is sent raw to Meta (Meta hashes server-side per their docs). The submission's `ip_hash` column is unchanged; we keep using the same raw IP that's already in the request scope at `submit/route.ts:318-321`.
- The `capi_event_logs` table has read-only RLS for owners; no `INSERT` policy for `authenticated`. Inserts are service-role only.

## Testing

**New tests:**

- `src/lib/facebook/capi-mapping.test.ts` — pure unit. Every row of the mapping table. Override paths (`SKIP`, explicit event name, null). Edge cases (unknown outcome → skip, unknown kind → skip).
- `src/lib/facebook/capi-payload.test.ts` — pure unit. PII normalization:
  - `"  Foo@Bar.COM "` → sha256 of `"foo@bar.com"`
  - `"+63 917 555 1234"` → sha256 of `"639175551234"`
  - `"John Angelo David"` → `fn` = sha256 of `"john"`, `ln` = sha256 of `"angelo david"`
  - `"Madonna"` → `fn` = sha256 of `"madonna"`, `ln` omitted
  - Empty arrays omitted entirely from output
  - Snapshot for a full catalog `Purchase` envelope.
- `src/lib/facebook/capi.test.ts` — integration with `vi.spyOn(global, 'fetch')`. Cases:
  - skip when no psid → log row, no fetch call
  - skip when `capi_enabled = false` → log row, no fetch
  - skip when outcome maps to skip → log row, no fetch
  - 2xx response → log status `sent`, fb_trace_id captured
  - 4xx response → log status `error`, http_status + response_body captured
  - network timeout → log status `error`, error_message `timeout`
  - `test_event_code` propagates into request body when set
  - leadId present → lead full_name split into fn/ln; em/ph from lead arrays hashed
- `src/app/api/action-pages/submit/route.test.ts` — extend the existing test: one new case asserting `dispatchCapiEvent` is called with expected input when a deeplinked submission lands on a CAPI-enabled page. Mock the module.

**Manual verification before claiming done:**

1. Apply the migration locally; confirm columns + table + RLS via `\d facebook_pages` and `\d capi_event_logs` in `psql`.
2. Generate a Dataset + CAPI access token + Test Event Code in Meta Events Manager (dev account).
3. Save those via the Settings → Facebook → Conversions API form.
4. Submit through one action page of each kind via a real Messenger deeplink.
5. Watch each event land in Meta Events Manager → Test Events tab.
6. Confirm `capi_event_logs` row matches what Meta received (event_name, event_id, fb_trace_id captured).
7. Disable CAPI on a page → submit again → confirm log row with `skipped/disabled`.
8. Submit a qualification with `disqualified` outcome → confirm `skipped/outcome_skip`.

## Migration / Rollout

- Migration is purely additive: nullable columns + new table. No backfill. Existing submissions are not retroactively reported.
- Default state on every existing page is `capi_enabled = false` → zero behavior change until a user opts in.
- No environment variable changes required.
- No new dependencies.

## v2 Sketch — Click-to-Messenger Ad Attribution

Separate spec, not in v1. Captured here so the v1 design doesn't accidentally close doors.

Goal: when a Messenger thread originated from a CTM ad, attach `messaging_referral.ad_id` (or `attribution_data.ad_id` — exact field name to verify against Meta docs) to CAPI events so Meta attributes conversions to the originating ad.

Pieces:

1. **Webhook capture** — extend `src/app/api/webhooks/facebook/route.ts` to parse:
   - the `referral` object piggybacked on the first inbound `message` after an ad click (carries `source: 'ADS'`, `ad_id`, `ref`)
   - the standalone `messaging_referrals` webhook event
2. **Schema** — new columns on `messenger_threads`: `referral_ad_id text`, `referral_ref text`, `referral_source text`, `referral_captured_at timestamptz`. First-write wins (don't overwrite later refs).
3. **Dispatcher upgrade** — when the loaded `messenger_threads` row has `referral_ad_id`, the CAPI dispatcher includes a `messaging_referral` (or `attribution_data`) field in the event envelope.
4. **UI** — surface `ad_id` in the lead drawer and recent-events log so users see which ad converted them.

Effort estimate: ~half a day. Stacks cleanly on v1 — no v1 code changes, only additions in the dispatcher's payload builder and one new column read.

## File Touches Summary

**New files:**
- `src/lib/facebook/capi.ts`
- `src/lib/facebook/capi.test.ts`
- `src/lib/facebook/capi-mapping.ts`
- `src/lib/facebook/capi-mapping.test.ts`
- `src/lib/facebook/capi-payload.ts`
- `src/lib/facebook/capi-payload.test.ts`
- `src/app/(app)/dashboard/settings/facebook/_components/capi-section.tsx`
- `src/app/(app)/dashboard/settings/facebook/_components/capi-page-form.tsx`
- `src/app/(app)/dashboard/settings/facebook/_components/capi-recent-events.tsx`
- `supabase/migrations/20260606000000_facebook_capi.sql`
- `docs/superpowers/specs/2026-05-22-facebook-capi-business-messaging-design.md` (this file)

**Modified files:**
- `src/app/api/action-pages/submit/route.ts` — add one block calling `dispatchCapiEvent` and a small `CatalogOrderResult` shape extension (`business_item_id` on each line, `paymentStatus` on the result).
- `src/app/api/action-pages/submit/route.test.ts` — one new case.
- `src/app/(app)/dashboard/settings/facebook/page.tsx` — render `<CapiSection />` below `<ConnectedView />`.
- `src/app/(app)/dashboard/settings/facebook/actions.ts` — add `saveCapiConfigForm` and `sendCapiTestEventForm` server actions.
- `src/app/(app)/dashboard/action-pages/_components/*` — add a single `<Select>` for `capi_event_name_override` in the editor's existing pipeline-rules-adjacent area. Exact component file determined during implementation.
- `src/app/(app)/dashboard/action-pages/actions.ts` — extend the save action to persist `capi_event_name_override`.
- `src/app/(app)/dashboard/action-pages/_lib/schemas.ts` — extend the action-page Zod schema with the override field.

## Open Questions / Implementation-time Verifications

- Exact Meta response header for trace id (`x-fb-trace-id` vs `x-fb-debug` vs `fbtrace_id` in body). Capture whichever Meta provides.
- Exact Graph API version. Use `v19.0` to match `oauth.ts`; bump only in lock-step.
- Whether Meta accepts `messaging_channel: 'messenger'` as documented or expects a different literal (`MESSENGER`). Verify against a real test event before claiming done.
- `event_source_url` — confirm Meta accepts the app's public action-page URL for the business-messaging action source (it's optional, so omitting is safe if Meta rejects).
