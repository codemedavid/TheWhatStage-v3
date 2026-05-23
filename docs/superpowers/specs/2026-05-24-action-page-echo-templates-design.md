# Action Page Echo Templates — Design

**Date:** 2026-05-24
**Status:** Approved (brainstorm complete; plan pending)

## Problem

Today the Messenger echo sent back after an action-page submission is plain text. Authors can only write a fixed string in `notification_template.text`, so confirmations like "Thanks! We got your details and will be in touch shortly." are the same for every lead. Catalog gets a hardcoded order-summary block prepended by `buildOrderEcho()`; no other kind can reference what the lead just submitted.

Authors want to compose echoes that reference the submission, e.g.:

- Booking: `Hi {{fb.name || customer.name}}, you're booked for {{booking.date}} at {{booking.time}}.`
- Catalog: `Order received! {{order.items_lines}} — Total: {{order.total}}.`
- Sales / property: similar interpolation against the relevant fields.

They also want the uploaded payment screenshot re-echoed as a Messenger image after the text confirmation.

## Goals

1. Run every author-configurable echo field through a small template renderer with `{{var}}` substitution and `||` fallback chains.
2. Each page kind exposes a fixed, documented namespace of variables. Picker UI in the editor surfaces them, and the renderer validates against the same registry.
3. Catalog's hardcoded `buildOrderEcho()` retires; the same output is producible (and editable) via the template field. Existing catalog pages are backfilled so the rendered output is byte-identical to today.
4. On catalog and sales submissions that include a `payment_proof_url`, the proof image is sent as a Messenger follow-up after the text echo. Opt-out per page.
5. Editor previews use the same renderer the server runs at submit time — preview and runtime cannot drift.

## Non-goals

- Conditional sections (`{{#if}}...{{/if}}`), loops, or any expression DSL beyond `||` fallbacks. Authors handle empty values with `||` fallbacks; missing values render as empty string.
- Format specs on date/time/currency variables (no `{{booking.date:short}}`). Dates render with a fixed format keyed off the page's configured timezone.
- Templating in CTA labels, page titles, or notification banners. Echo text only.
- Backfilling sample data for variables outside what's needed for the editor preview.

## Decisions

| # | Decision |
|---|---|
| Q1 | Template renderer runs on three fields: `notification_template.text`, `pipeline_rules[].notify_text`, and qualification `outcomeAction.messenger_text`. All six kinds covered. |
| Q2 | Namespaced variables: `fb.*`, `lead.*`, `customer.*`, `custom.*`, `page.*`, `booking.*`, `order.*`, `payment.*`, `property.*`, `sales.*`. No flat aliases. |
| Q3 | Existing catalog rows backfilled via SQL to use templated equivalents of today's `buildOrderEcho()` output. `buildOrderEcho()` deletes. |
| Q4 | Missing values render as empty string. `||` fallback chains handle defaults. No `{{#if}}` blocks. |
| Q5 | Payment proof image re-echo applies to catalog and sales when `payment_proof_url` is present. Text first, then image. Opt-out via per-page toggle (`notification_template.echo_payment_proof`, default `true`). |
| Q6 | Editor uses a sidecar layout: textarea on left, grouped variable picker on right (click to insert at cursor), live sample-data preview below. |
| Q7a | New pages ship with default templates that demonstrate the variables (e.g. `Hi {{fb.name \|\| customer.name}}, you're booked for {{booking.date}} at {{booking.time}}.`). |
| Q7b | Date/time formatting is fixed — `Intl.DateTimeFormat` with `dateStyle: 'medium'` / `timeStyle: 'short'` in the page's timezone. Currency formatting uses `Intl.NumberFormat` style: 'currency'. |
| Q7c | Unknown tokens warn (inline + banner) but do not block save. Renderer outputs empty string for unknown tokens at runtime. |

## Architecture

```
src/lib/action-pages/echo/
  render.ts        # pure: renderEchoTemplate(template, ctx, known) -> { text, warnings }
  format.ts        # date/time/currency helpers, shared with order summary
  variables.ts     # VARIABLES_BY_KIND registry — picker + validation source of truth
  context.ts       # buildEchoContext({ admin, page, parsed, catalogOrder, ... }) -> { ctx, known, customKeys }
  index.ts         # re-exports

src/app/(app)/dashboard/action-pages/_components/
  EchoTemplateField.tsx   # shared sidecar editor (textarea + picker + preview)

src/app/(app)/dashboard/action-pages/actions/
  preview-echo.ts         # server action: render with sample data for editor preview
```

Single shared renderer, single shared context builder, single shared editor component. Wired into:

- Submit route (`src/app/api/action-pages/submit/route.ts`) at the existing echo block (~lines 677–748). Existing precedence (outcomeAction → rule → page) preserved; only the rendering step changes.
- Five editor surfaces: `EditActionPageShell.tsx`, `CatalogShell.tsx`, `RealestateShell.tsx`, `PipelineRulesEditor.tsx` (compact mode), qualification `OutcomeCard.tsx` (compact mode).

## Data model

`action_pages.notification_template` (JSONB) extends:

```ts
{
  text: string                  // existing — now a template
  echo_payment_proof?: boolean  // new — default true for catalog/sales; ignored elsewhere
}
```

`pipeline_rules[].notify_text` and qualification `outcomeAction.messenger_text` keep their existing shape. No new column, no shape change to the rule object — the template renderer is applied to whatever string lives there.

No new tables. No RLS change. No new index.

### Backfill migration

`supabase/migrations/20260525000000_action_pages_echo_templates_backfill.sql`:

- For every `action_pages` row with `kind = 'catalog'` whose `notification_template->>'text'` does **not** contain the substring `{{order.`, rewrite the text to:
  ```
  Order received!
  {{order.items_lines}}

  Total: {{order.total}}
  {{ existing text appended verbatim, if non-empty }}
  ```
  Customer name/phone/email/notes lines from the legacy `buildOrderEcho()` are not added in the backfill — those were noisy and the new template makes them explicit when the author wants them. (This is a deliberate small change captured in release notes.)
- For `kind IN ('catalog', 'sales')` rows where a payment method is configured on the page, set `notification_template = jsonb_set(notification_template, '{echo_payment_proof}', 'true', true)`.
- Idempotent. Wrapped in a transaction.

## Renderer

`src/lib/action-pages/echo/render.ts`. Pure, no Node-only deps so it runs in the browser preview too.

```ts
export interface RenderWarning { token: string; reason: 'unknown' | 'malformed' }
export interface RenderResult { text: string; warnings: RenderWarning[] }

export function renderEchoTemplate(
  template: string,
  ctx: Record<string, unknown>,
  known: Set<string>,
): RenderResult
```

Syntax:

- `{{path.to.value}}` — dotted lookup against `ctx`. Missing or empty-string → `""`. Whitespace inside braces trimmed.
- `{{a || b || "literal"}}` — first non-empty wins; operands are paths or `"double-quoted"` literals.
- Any other content inside `{{ }}` (e.g. `{{#if}}`, `{{x|y}}`, `{{x + y}}`) is left as literal text in the output and recorded in `warnings` with `reason: 'malformed'`.
- Unknown paths (path not in `known`) render as empty string and add a warning with `reason: 'unknown'`.

Token cap: 500 placeholders per template, hard error on more. Template length cap stays at the existing 640-char limit on `notify_text` and the editor warns at 1900 chars on the page template (the Messenger send cap).

## Variable registry

`src/lib/action-pages/echo/variables.ts`:

```ts
export interface VariableDef {
  path: string         // 'customer.email'
  label: string        // 'Customer email'
  sample: string       // 'maria@example.com'
  group: string        // 'Customer'
}

export const VARIABLES_BY_KIND: Record<ActionPageKind, VariableDef[]>
```

Catalogue:

| Group | Variable | Kinds | Source |
|---|---|---|---|
| Facebook | `fb.name` | all (when PSID) | `messenger_threads.full_name` |
| Lead | `lead.name`, `lead.phone`, `lead.email` | all (when lead known) | `leads` row |
| Customer | `customer.name`, `customer.phone`, `customer.email`, `customer.notes` | catalog, sales, booking, property | `parsedData.customer` |
| Custom | `custom.<key>` | catalog, booking, property | page config field defs (extends `known` dynamically) |
| Page | `page.title`, `page.url` | all | `action_pages` row + `NEXT_PUBLIC_APP_URL` |
| Booking | `booking.date`, `booking.time`, `booking.datetime`, `booking.duration` | booking | `parsedData.slot_iso` + page timezone |
| Order | `order.items_lines`, `order.items`, `order.subtotal`, `order.total`, `order.currency`, `order.count` | catalog | `CatalogOrderResult` |
| Payment | `payment.method`, `payment.amount`, `payment.note` | catalog, sales | `parsedData.payment_*` + payment-method lookup |
| Property | `property.title`, `property.price`, `property.address`, `property.unit_title` | property | `action_pages.title` / `config.price` / `config.address` / submission's `source_property_unit_title` (empty if not from a unit deeplink) |
| Sales | `sales.product`, `sales.price` | sales | `config.product.name` / `config.price` formatted as currency |

`order.items_lines` is the multi-line bullet block `• 1x Heavy Duty Helmet — ₱2,500.00\n• 4x Flashlight — ₱1,200.00`. `order.items` is the inline form `1x Heavy Duty Helmet, 4x Flashlight`. Both available so authors choose how it reads.

## Context builder

`src/lib/action-pages/echo/context.ts`:

```ts
export async function buildEchoContext(args: {
  admin: SupabaseAdmin
  page: ActionPageRecord
  parsed: ParsedSubmission
  catalogOrder?: CatalogOrderResult | null
  leadId: string | null
  threadId: string | null
  psid: string | null
  fbPageId: string | null
}): Promise<{ ctx: Record<string, unknown>; known: Set<string>; customKeys: string[] }>
```

Reads `messenger_threads` (for `fb.name` from `full_name`) and `leads` (for `lead.*` — `name`/`email`/`phone`) in parallel via `Promise.all`. The existing submit route already does a `messenger_threads` lookup near line 696 — the context builder reuses the same row to avoid a second query. Returns the `known` set with `custom.<key>` paths added for whatever keys the page declares.

Dates render in the page's timezone:
- Booking pages: `config.appointment.timezone` (defaults to `Asia/Manila`).
- Other kinds: fall back to the user's profile timezone if stored, else `Asia/Manila`.

## Submit-route changes

`src/app/api/action-pages/submit/route.ts`:

- Replace the `buildOrderEcho(catalogOrderResult, notifyText)` branch (~line 682) with `renderEchoTemplate(templateText, ctx, known).text`.
- Reuse the existing `messengerThreadData` fetch when building context — pass it in via `buildEchoContext`.
- Delete `buildOrderEcho()` (~line 843) and the `CatalogOrderResult` type definition stays (it's used elsewhere; only the formatter goes).
- After the existing text-send block, when:
  - `page.notification_template?.echo_payment_proof !== false` (default true),
  - `page.kind` is `'catalog'` or `'sales'`,
  - `parsed.data.payment_proof_url` is set and is a URL,
  - the text echo above also sent successfully,
  
  call `sendOutbound({ ..., payload: { kind: 'image', imageUrl: proofUrl }, kind: 'submission_echo' })` and insert a `messenger_messages` row with `body = '[image] payment proof'`. Failures log but do not fail the submission, matching the existing echo error policy.

## Editor — `EchoTemplateField.tsx`

Shared client component:

```tsx
<EchoTemplateField
  name="notification_text"
  kind={page.kind}
  customKeys={fieldKeysFromConfig(page.config, page.kind)}
  defaultValue={page.notification_template?.text ?? ''}
  rows={3}
  compact={false}                  // compact=true for PipelineRulesEditor and OutcomeCard
/>
```

Layout:
- Full mode: 2-column grid — textarea on left, picker on right (grouped, click inserts at cursor), preview block below the textarea using sample data from the registry.
- Compact mode: textarea full width, picker collapsed behind a "Insert variable" popover, preview behind a `<details>` toggle. Used inside narrow per-rule cards.

Behavior:
- Renders by client-side calling the same `renderEchoTemplate` with the registry's `sample` values.
- Unknown tokens highlight inline (yellow underline) and surface in a banner: `Unknown variable: customer.adress. Did you mean customer.address?` (Levenshtein-1 suggestion against `known`.)
- Save proceeds regardless of warnings (per Q7c).
- Char count visible; soft-warns at 1900, hard-blocks at the existing 640-char limit on per-rule fields.

The catalog/sales "Messenger echo" section gets a sibling checkbox:

```tsx
<label>
  <input type="checkbox" name="echo_payment_proof" defaultChecked={page.notification_template?.echo_payment_proof !== false} />
  Also re-echo the uploaded payment screenshot
</label>
```

`actions/crud.ts` persists this into `notification_template.echo_payment_proof`. Schema `notification_template` in `_lib/schemas.ts` extends:

```ts
notification_template: z.object({
  text: z.string().max(640).optional(),        // unchanged — templates are short; runtime output is capped separately
  echo_payment_proof: z.boolean().optional(),
}).nullable().optional()
```

The 640-char ceiling applies to the *template* string. The *rendered* output is still bounded by Messenger's send cap; the renderer/editor soft-warns when expansion exceeds 1900 chars using sample data.

## Default templates

`src/lib/action-pages/kinds.ts` `defaultNotificationText` entries change to:

```ts
form:          'Thanks {{fb.name || customer.name || "there"}}! We got your details and will be in touch shortly.'
booking:       'Hi {{fb.name || customer.name || "there"}}, you\'re booked for {{booking.date}} at {{booking.time}}. We\'ll follow up shortly.'
qualification: 'Thanks {{fb.name || "there"}}! We\'ll review your answers and follow up shortly.'
sales:         'Thanks {{fb.name || customer.name || "there"}}! We got your details for {{sales.product}}. We\'ll be in touch shortly.'
catalog:       'Order received!\n{{order.items_lines}}\n\nTotal: {{order.total}}\nName: {{customer.name}}\nPhone: {{customer.phone}}\n\nThanks for your order — we\'ll confirm on Messenger shortly.'
realestate:    'Thanks for your interest in {{property.title}}! We\'ll reach out about this property shortly.'
```

These ship with new pages only. Existing pages keep whatever they have (modulo the catalog backfill).

## Testing

| File | Coverage |
|---|---|
| `src/lib/action-pages/echo/render.test.ts` | Basic substitution; missing-value → ''; `\|\|` fallback (path, path-empty, literal); quoted-literal with whitespace; nested paths; malformed `{{...}}` left literal + warned; unknown-token warned; placeholder cap; empty template → empty result. |
| `src/lib/action-pages/echo/variables.test.ts` | Every entry has unique path within its kind; every sample renders against itself without throwing; `known` set generation correct for each kind including `custom.*` extension. |
| `src/lib/action-pages/echo/context.test.ts` | Builds correct context for each kind; handles missing lead/thread/PSID; respects page timezone for dates; resolves `fb.name` from joined first+last. |
| `src/lib/action-pages/echo/format.test.ts` | Currency formats with PHP and USD; date formats in Asia/Manila and America/Los_Angeles; falls back gracefully on invalid input. |
| `src/app/api/action-pages/submit/route.test.ts` | (Extends existing) Catalog templated echo matches today's output for a representative cart; `echo_payment_proof: false` suppresses image send; `echo_payment_proof: true` (default) sends image; unknown token in template warns in logs but doesn't crash the submit. |
| `src/app/(app)/dashboard/action-pages/_components/EchoTemplateField.test.tsx` | Picker inserts at cursor; preview renders; unknown token highlighted; compact mode collapses picker. |

## Rollout

Single PR, but staged commits:

1. Renderer + format + variables registry + context builder (full unit tests, no UI). Includes index re-exports.
2. Backfill migration (`20260525000000_action_pages_echo_templates_backfill.sql`).
3. Submit-route swap — replace `buildOrderEcho` call with renderer; delete `buildOrderEcho`. Route test additions land here.
4. Payment-proof image follow-up send. Route test additions land here.
5. `EchoTemplateField` component + wire into 5 editor surfaces. Schema + crud + component test additions land here.
6. Default-template updates in `KIND_REGISTRY`.

Each commit compiles, tests pass, and earlier commits are deployable on their own. If step 5 has a visual bug, steps 1–4 still render correctly with the original textarea UI.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Catalog backfill diverges from current `buildOrderEcho` output and confuses existing customers | Backfill text is intentionally simpler than today's auto-prepend (customer block dropped). Captured in release notes. Authors can edit. |
| Authors save templates referencing variables for the wrong kind (e.g. `{{order.total}}` on a booking page) | Editor shows unknown-token warning inline and in a banner. Runtime renders empty string — never crashes. |
| Renderer runs on user-controlled strings | Pure substitution into already-trusted text path. No `eval`, no template inheritance, no helpers. Output goes to Messenger as plain text — same surface as today. |
| Payment proof URL is publicly accessible | Unchanged from today — these URLs already exist in storage and are linked in lead records. Sending to the same Messenger thread that uploaded them is a tighter audience than current admin views. |
| Editor preview client-side renders differ from server runtime | Same `renderEchoTemplate` module imported by both. Variables registry is the single source of truth. Unit tests cover both paths. |

## Open questions

None remaining — all clarifications resolved during brainstorm.
