# Onboarding Wizard — Phase 4: Goal + Goal Content + Flow

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Replace stubs for `goal`, `goal_content`, and `flow` — the final three onboarding steps. Step 5 creates a starter `action_pages` row from `KIND_REGISTRY` defaults and points `chatbot_configs.primary_action_page_id` at it. Step 6 collects light kind-specific content (1–3 products, sales product fields, booking hours, 1 property, or AI-suggested form fields). Step 7 turns a free-text "ideal conversation flow" description into bot send-instructions + recommendation rules.

**Architecture:** Step 5 reuses `KIND_REGISTRY` from `src/lib/action-pages/kinds.ts` for all defaults — no new starter logic. Step 6 dispatches on the saved `primary_action_page.kind` and writes back into existing tables (`business_items` for catalog/realestate; `action_pages.config` for sales/booking/form/qualification). Step 7 calls a new `generateBotInstructions` AI lib that returns `{ bot_send_instructions, recommendation_rules, suggested_flow_summary }`. Recommendation-rules format mirrors `RecommendationRulesMap` already used by the chatbot.

**Tech Stack:** Next.js App Router · TypeScript · Supabase · Vitest · Zod · `HfRouterLlm`.

**Related spec:** `docs/superpowers/specs/2026-05-15-onboarding-wizard-design.md`
**Builds on:** Phases 1–3 (same branch).

---

## Task 1: Goal step — server action + page

**Files:**
- Modify: `src/app/(app)/onboarding/actions.ts`
- Modify: `src/app/(app)/onboarding/goal/page.tsx`
- Create: `src/app/(app)/onboarding/goal/GoalCards.tsx`
- Modify: `src/lib/onboarding/i18n.ts`

- [ ] **Step 1: Add i18n keys**

```ts
  'goal.heading':         { tl: 'Ano ang pangunahing goal mo?', en: "What's your #1 goal right now?" },
  'goal.subheading':      { tl: 'Gagawa kami ng action page para sa iyo. Pwede mong baguhin maya-maya.', en: "We'll spin up an action page for you. You can change this later." },
  'goal.kind.form':       { tl: 'Magkolekta ng inquiries',    en: 'Collect inquiries' },
  'goal.kind.booking':    { tl: 'Mag-book ng appointments',   en: 'Book appointments' },
  'goal.kind.qualification':{ tl: 'Mag-qualify ng leads',     en: 'Qualify leads' },
  'goal.kind.sales':      { tl: 'Magbenta ng product / service', en: 'Sell a product or service' },
  'goal.kind.catalog':    { tl: 'Magbenta ng mga products (online store)', en: 'Sell products online' },
  'goal.kind.realestate': { tl: 'Mag-showcase ng property',   en: 'Showcase a property' },
  'goal.kind.form.blurb':       { tl: 'Form para sa quick inquiry — pangalan, contact, message.', en: 'A simple form for name, contact, and a quick message.' },
  'goal.kind.booking.blurb':    { tl: 'Online calendar para pumili ng slot.', en: 'Online calendar so leads can pick a slot.' },
  'goal.kind.qualification.blurb': { tl: 'Short quiz para mag-score ng leads.', en: 'Short quiz that scores incoming leads.' },
  'goal.kind.sales.blurb':      { tl: 'Sales page na may price, features, at form.', en: 'Sales page with price, features, and an inline form.' },
  'goal.kind.catalog.blurb':    { tl: 'Listing ng mga products na may cart at checkout.', en: 'Product listing with cart and checkout.' },
  'goal.kind.realestate.blurb': { tl: 'Property listing na may photos at financing.', en: 'Property listing with photos and financing.' },
  'goal.save':            { tl: 'I-save at gumawa ng page', en: 'Save and create page' },
  'goal.saving':          { tl: 'Ginagawa…',                  en: 'Creating…' },
  'goal.error':           { tl: 'May error sa pag-save.',     en: 'Could not save.' },
```

- [ ] **Step 2: Append `saveGoalAction` to `src/app/(app)/onboarding/actions.ts`**

Top imports (consolidate):
```ts
import { isActionPageKind, KIND_REGISTRY, type ActionPageKind } from '@/lib/action-pages/kinds'
```

Append:

```ts
export type GoalStepError = 'invalid_kind' | 'save_failed'
export type GoalFormState = { error?: GoalStepError }

function uniqueSlug(seed: string): string {
  const base = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'page'
  return `${base}-${Math.random().toString(36).slice(2, 8)}`
}

export async function saveGoalAction(
  _prev: GoalFormState | undefined,
  formData: FormData,
): Promise<GoalFormState> {
  const raw = formData.get('kind')
  if (!isActionPageKind(raw)) return { error: 'invalid_kind' }
  const kind: ActionPageKind = raw

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { error: 'save_failed' }

  const meta = KIND_REGISTRY[kind]
  const basics = await getBusinessBasics()
  const title = basics ? `${basics.name} — ${meta.label}` : meta.label
  const slug = uniqueSlug(basics?.name ?? meta.label)

  const { data: page, error: insertErr } = await supabase
    .from('action_pages')
    .insert({
      user_id: auth.user.id,
      kind,
      slug,
      title,
      description: meta.blurb,
      status: meta.defaultStatusOnCreate,
      config: meta.defaultConfig,
      pipeline_rules: meta.defaultPipelineRules,
      notification_template: { text: meta.defaultNotificationText },
      bot_send_instructions: meta.defaultBotSendInstructions,
      cta_label: meta.defaultCtaLabel,
    })
    .select('id')
    .single()
  if (insertErr || !page) {
    console.error('[saveGoalAction] insert action_page', insertErr)
    return { error: 'save_failed' }
  }

  // Point the chatbot at this page as the primary goal. Upsert so users who
  // skipped personality (no chatbot_configs row yet) still get this written.
  const { error: upsertErr } = await supabase.from('chatbot_configs').upsert(
    { user_id: auth.user.id, primary_action_page_id: page.id },
    { onConflict: 'user_id' },
  )
  if (upsertErr) {
    console.error('[saveGoalAction] upsert chatbot_configs', upsertErr)
    return { error: 'save_failed' }
  }

  await markStep('goal')
  redirect('/onboarding/goal-content')
}
```

Note: `action_pages` may or may not have a `cta_label` column at the top level — most kinds keep CTA inside `config.cta`. Check before relying on it. If `cta_label` is not a column on `action_pages`, **remove that line** from the insert (the CTA already lives inside `meta.defaultConfig`).

- [ ] **Step 3: Create `GoalCards.tsx` (client component)**

```tsx
// src/app/(app)/onboarding/goal/GoalCards.tsx
'use client'

import { useActionState, useState } from 'react'
import { saveGoalAction, type GoalFormState } from '../actions'
import { ACTION_PAGE_KINDS, type ActionPageKind } from '@/lib/action-pages/kinds'
import { StepNav } from '../_components/StepNav'
import { t, type DictKey } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

const LABEL_KEY: Record<ActionPageKind, DictKey> = {
  form: 'goal.kind.form',
  booking: 'goal.kind.booking',
  qualification: 'goal.kind.qualification',
  sales: 'goal.kind.sales',
  catalog: 'goal.kind.catalog',
  realestate: 'goal.kind.realestate',
}
const BLURB_KEY: Record<ActionPageKind, DictKey> = {
  form: 'goal.kind.form.blurb',
  booking: 'goal.kind.booking.blurb',
  qualification: 'goal.kind.qualification.blurb',
  sales: 'goal.kind.sales.blurb',
  catalog: 'goal.kind.catalog.blurb',
  realestate: 'goal.kind.realestate.blurb',
}

const RECOMMENDED_FOR: Record<string, ActionPageKind> = {
  service: 'booking',
  ecom: 'catalog',
  digital: 'sales',
  realestate: 'realestate',
}

export function GoalCards({ lang, businessType }: { lang: OnboardingLang; businessType: string | null }) {
  const recommended = (businessType && RECOMMENDED_FOR[businessType]) || 'booking'
  const [selected, setSelected] = useState<ActionPageKind>(recommended)
  const [state, action, pending] = useActionState<GoalFormState, FormData>(saveGoalAction, {})

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="kind" value={selected} />

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ACTION_PAGE_KINDS.map((kind) => (
          <li key={kind}>
            <button
              type="button"
              onClick={() => setSelected(kind)}
              className={`flex w-full flex-col items-start gap-1 rounded-lg border p-4 text-left transition ${
                selected === kind
                  ? 'border-emerald-600 bg-emerald-50'
                  : 'border-zinc-200 bg-white hover:border-zinc-300'
              }`}
            >
              <span className="text-sm font-semibold text-zinc-900">{t(LABEL_KEY[kind], lang)}</span>
              <span className="text-xs text-zinc-600">{t(BLURB_KEY[kind], lang)}</span>
              {kind === recommended && (
                <span className="mt-1 inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                  Recommended
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {state.error && <p className="text-sm text-red-600">{t('goal.error', lang)}</p>}

      <StepNav
        step="goal"
        lang={lang}
        continueSlot={
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {pending ? t('goal.saving', lang) : t('goal.save', lang)}
          </button>
        }
      />
    </form>
  )
}
```

- [ ] **Step 4: Replace `goal/page.tsx`**

```tsx
import { WizardShell } from '../_components/WizardShell'
import { GoalCards } from './GoalCards'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { getBusinessBasics } from '@/lib/onboarding/state'
import { t } from '@/lib/onboarding/i18n'

export const dynamic = 'force-dynamic'

export default async function GoalPage() {
  const [lang, basics] = await Promise.all([getOnboardingLang(), getBusinessBasics()])
  return (
    <WizardShell lang={lang} step="goal">
      <h1 className="text-2xl font-semibold text-zinc-900">{t('goal.heading', lang)}</h1>
      <p className="mt-1 text-sm text-zinc-600">{t('goal.subheading', lang)}</p>
      <div className="mt-6">
        <GoalCards lang={lang} businessType={basics?.business_type ?? null} />
      </div>
    </WizardShell>
  )
}
```

- [ ] **Step 5: Inspect schema before committing**

Run:
```
grep -n "cta_label\|action_pages" supabase/migrations/20260430030000_action_pages_messenger_cta.sql
```

If you see `cta_label` defined as a column, keep that line in the insert. If not, drop it.

`npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add 'src/app/(app)/onboarding/goal/' 'src/app/(app)/onboarding/actions.ts' src/lib/onboarding/i18n.ts
git commit -m "feat(onboarding): goal step — pick kind, create starter action page (step 5)"
```

---

## Task 2: Goal content — read primary page + dispatcher

**Files:**
- Modify: `src/app/(app)/onboarding/actions.ts` — add `getOnboardingPrimaryPage` helper
- Modify: `src/app/(app)/onboarding/goal-content/page.tsx` — branch on kind

- [ ] **Step 1: Helper to read the primary action page**

In `src/lib/onboarding/state.ts`, append:

```ts
export interface PrimaryActionPageBrief {
  id: string
  kind: string
  title: string
  config: unknown
}

export async function getPrimaryActionPage(): Promise<PrimaryActionPageBrief | null> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return null
  const { data: cfg } = await supabase
    .from('chatbot_configs')
    .select('primary_action_page_id')
    .eq('user_id', auth.user.id)
    .maybeSingle()
  if (!cfg?.primary_action_page_id) return null
  const { data: page } = await supabase
    .from('action_pages')
    .select('id, kind, title, config')
    .eq('id', cfg.primary_action_page_id)
    .maybeSingle()
  if (!page) return null
  return { id: page.id, kind: page.kind, title: page.title, config: page.config }
}
```

- [ ] **Step 2: Goal-content page (dispatcher)**

```tsx
// src/app/(app)/onboarding/goal-content/page.tsx
import Link from 'next/link'
import { WizardShell } from '../_components/WizardShell'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { getPrimaryActionPage } from '@/lib/onboarding/state'
import { t } from '@/lib/onboarding/i18n'
import { isActionPageKind } from '@/lib/action-pages/kinds'
import { CatalogContent } from './CatalogContent'
import { SalesContent } from './SalesContent'
import { BookingContent } from './BookingContent'
import { RealestateContent } from './RealestateContent'
import { FormFieldsContent } from './FormFieldsContent'

export const dynamic = 'force-dynamic'

export default async function GoalContentPage() {
  const [lang, page] = await Promise.all([getOnboardingLang(), getPrimaryActionPage()])

  if (!page || !isActionPageKind(page.kind)) {
    return (
      <WizardShell lang={lang} step="goal_content">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('goal_content.heading', lang)}</h1>
        <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p>{t('goal_content.error.no_goal', lang)}</p>
          <Link href="/onboarding/goal" className="mt-2 inline-block font-medium underline">
            {t('shell.back', lang)}
          </Link>
        </div>
      </WizardShell>
    )
  }

  return (
    <WizardShell lang={lang} step="goal_content">
      <h1 className="text-2xl font-semibold text-zinc-900">{t('goal_content.heading', lang)}</h1>
      <p className="mt-1 text-sm text-zinc-600">{t('goal_content.subheading', lang)}</p>
      <div className="mt-6">
        {page.kind === 'catalog' && <CatalogContent lang={lang} pageId={page.id} />}
        {page.kind === 'sales' && <SalesContent lang={lang} pageId={page.id} config={page.config} />}
        {page.kind === 'booking' && <BookingContent lang={lang} pageId={page.id} config={page.config} />}
        {page.kind === 'realestate' && <RealestateContent lang={lang} pageId={page.id} />}
        {(page.kind === 'form' || page.kind === 'qualification') && (
          <FormFieldsContent lang={lang} pageId={page.id} kind={page.kind} config={page.config} />
        )}
      </div>
    </WizardShell>
  )
}
```

- [ ] **Step 3: Add i18n shared keys**

```ts
  'goal_content.heading':       { tl: 'Detalye ng iyong action page', en: 'Fill in your action page' },
  'goal_content.subheading':    { tl: 'Light na detalye lang — kompleto mo na maya-maya sa editor.', en: "Just the essentials — you can finish later in the editor." },
  'goal_content.save':          { tl: 'I-save at magpatuloy',        en: 'Save and continue' },
  'goal_content.saving':        { tl: 'Sini-save…',                   en: 'Saving…' },
  'goal_content.error.no_goal': { tl: 'Pumili muna ng goal step.',    en: 'Pick a goal first.' },
  'goal_content.error.save':    { tl: 'May error. Subukan ulit.',     en: 'Could not save. Try again.' },
```

- [ ] **Step 4: Add per-kind save actions to `actions.ts`**

```ts
const SaveCatalogProductsSchema = z.object({
  products: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(160),
        price_amount: z.number().nonnegative().nullable(),
        summary: z.string().trim().max(280).optional(),
      }),
    )
    .max(5),
})

export async function saveCatalogProductsAction(
  _prev: { error?: 'save_failed' } | undefined,
  formData: FormData,
): Promise<{ error?: 'save_failed' }> {
  const raw = formData.get('products_json')
  let parsed: unknown
  try { parsed = JSON.parse(String(raw ?? '[]')) } catch { return { error: 'save_failed' } }
  const result = SaveCatalogProductsSchema.safeParse({ products: parsed })
  if (!result.success) return { error: 'save_failed' }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { error: 'save_failed' }

  if (result.data.products.length > 0) {
    const rows = result.data.products.map((p) => ({
      user_id: auth.user!.id,
      kind: 'product' as const,
      status: 'published' as const,
      title: p.title,
      slug: `${p.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40) || 'item'}-${Math.random().toString(36).slice(2,7)}`,
      summary: p.summary ?? null,
      price_amount: p.price_amount,
      currency: 'PHP',
      pricing_model: p.price_amount == null ? 'quote' as const : 'fixed' as const,
    }))
    const { error } = await supabase.from('business_items').insert(rows)
    if (error) {
      console.error('[saveCatalogProductsAction]', error)
      return { error: 'save_failed' }
    }
  }

  await markStep('goal_content')
  redirect('/onboarding/flow')
}

const SaveSalesSchema = z.object({
  pageId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  headline: z.string().trim().max(240).optional(),
  description: z.string().trim().max(4000).optional(),
  price_amount: z.number().nonnegative().nullable(),
})

export async function saveSalesContentAction(
  _prev: { error?: 'save_failed' } | undefined,
  formData: FormData,
): Promise<{ error?: 'save_failed' }> {
  const parsed = SaveSalesSchema.safeParse({
    pageId: formData.get('page_id'),
    name: formData.get('name'),
    headline: formData.get('headline') || undefined,
    description: formData.get('description') || undefined,
    price_amount: formData.get('price_amount') ? Number(formData.get('price_amount')) : null,
  })
  if (!parsed.success) return { error: 'save_failed' }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: page } = await supabase.from('action_pages').select('config').eq('id', parsed.data.pageId).maybeSingle()
  if (!page) return { error: 'save_failed' }
  const config = (page.config as Record<string, unknown>) ?? {}
  const product = { ...(config.product as object ?? {}), name: parsed.data.name, headline: parsed.data.headline ?? '', description: parsed.data.description ?? '' }
  const price = { ...(config.price as object ?? {}), amount: parsed.data.price_amount }
  const newConfig = { ...config, product, price }

  const { error } = await supabase.from('action_pages').update({ config: newConfig, status: 'published' }).eq('id', parsed.data.pageId)
  if (error) {
    console.error('[saveSalesContentAction]', error)
    return { error: 'save_failed' }
  }
  await markStep('goal_content')
  redirect('/onboarding/flow')
}

const SaveBookingSchema = z.object({
  pageId: z.string().uuid(),
  duration_min: z.coerce.number().int().min(5).max(480),
})

export async function saveBookingContentAction(
  _prev: { error?: 'save_failed' } | undefined,
  formData: FormData,
): Promise<{ error?: 'save_failed' }> {
  const parsed = SaveBookingSchema.safeParse({
    pageId: formData.get('page_id'),
    duration_min: formData.get('duration_min'),
  })
  if (!parsed.success) return { error: 'save_failed' }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: page } = await supabase.from('action_pages').select('config').eq('id', parsed.data.pageId).maybeSingle()
  if (!page) return { error: 'save_failed' }
  const config = (page.config as Record<string, unknown>) ?? {}
  const appointment = { ...(config.appointment as object ?? {}), duration_min: parsed.data.duration_min }
  const newConfig = { ...config, appointment }

  const { error } = await supabase.from('action_pages').update({ config: newConfig }).eq('id', parsed.data.pageId)
  if (error) {
    console.error('[saveBookingContentAction]', error)
    return { error: 'save_failed' }
  }
  await markStep('goal_content')
  redirect('/onboarding/flow')
}

const SaveRealestateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  price_amount: z.number().nonnegative().nullable(),
  location: z.string().trim().max(280).optional(),
})

export async function saveRealestatePropertyAction(
  _prev: { error?: 'save_failed' } | undefined,
  formData: FormData,
): Promise<{ error?: 'save_failed' }> {
  const parsed = SaveRealestateSchema.safeParse({
    title: formData.get('title'),
    price_amount: formData.get('price_amount') ? Number(formData.get('price_amount')) : null,
    location: formData.get('location') || undefined,
  })
  if (!parsed.success) return { error: 'save_failed' }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { error: 'save_failed' }

  const slug = `${parsed.data.title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40) || 'property'}-${Math.random().toString(36).slice(2,7)}`

  const { error } = await supabase.from('business_items').insert({
    user_id: auth.user.id,
    kind: 'property' as const,
    status: 'published' as const,
    title: parsed.data.title,
    slug,
    summary: parsed.data.location ?? null,
    price_amount: parsed.data.price_amount,
    currency: 'PHP',
    pricing_model: parsed.data.price_amount == null ? 'quote' as const : 'fixed' as const,
  })
  if (error) {
    console.error('[saveRealestatePropertyAction]', error)
    return { error: 'save_failed' }
  }
  await markStep('goal_content')
  redirect('/onboarding/flow')
}

const SaveFormFieldsSchema = z.object({
  pageId: z.string().uuid(),
  blocks_json: z.string(),
})

export async function saveFormFieldsAction(
  _prev: { error?: 'save_failed' } | undefined,
  formData: FormData,
): Promise<{ error?: 'save_failed' }> {
  const parsed = SaveFormFieldsSchema.safeParse({
    pageId: formData.get('page_id'),
    blocks_json: formData.get('blocks_json'),
  })
  if (!parsed.success) return { error: 'save_failed' }

  let blocks: unknown
  try { blocks = JSON.parse(parsed.data.blocks_json) } catch { return { error: 'save_failed' } }
  if (!Array.isArray(blocks)) return { error: 'save_failed' }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: page } = await supabase.from('action_pages').select('config').eq('id', parsed.data.pageId).maybeSingle()
  if (!page) return { error: 'save_failed' }
  const config = (page.config as Record<string, unknown>) ?? {}
  const newConfig = { ...config, blocks }

  const { error } = await supabase.from('action_pages').update({ config: newConfig }).eq('id', parsed.data.pageId)
  if (error) {
    console.error('[saveFormFieldsAction]', error)
    return { error: 'save_failed' }
  }
  await markStep('goal_content')
  redirect('/onboarding/flow')
}
```

- [ ] **Step 5: tsc clean. Commit.**

```bash
git add src/lib/onboarding/state.ts 'src/app/(app)/onboarding/actions.ts' 'src/app/(app)/onboarding/goal-content/page.tsx' src/lib/onboarding/i18n.ts
git commit -m "feat(onboarding): goal-content dispatcher + per-kind save actions"
```

---

## Task 3: Goal content — five per-kind UI components

**Files:**
- Create: `src/app/(app)/onboarding/goal-content/CatalogContent.tsx`
- Create: `src/app/(app)/onboarding/goal-content/SalesContent.tsx`
- Create: `src/app/(app)/onboarding/goal-content/BookingContent.tsx`
- Create: `src/app/(app)/onboarding/goal-content/RealestateContent.tsx`
- Create: `src/app/(app)/onboarding/goal-content/FormFieldsContent.tsx`
- Create: `src/lib/onboarding/ai/form-fields.ts` (+ test)
- Modify: `src/lib/onboarding/i18n.ts`

- [ ] **Step 1: i18n keys**

```ts
  'gc.catalog.heading':   { tl: 'Magdagdag ng 1-3 products', en: 'Add 1–3 products' },
  'gc.catalog.add':       { tl: '+ Magdagdag ng product',   en: '+ Add product' },
  'gc.product.title_ph':  { tl: 'Pangalan ng product',      en: 'Product name' },
  'gc.product.price_ph':  { tl: 'Presyo (PHP, optional)',   en: 'Price (PHP, optional)' },
  'gc.product.summary_ph':{ tl: 'Short na description',     en: 'Short description' },
  'gc.product.remove':    { tl: 'Tanggalin',                en: 'Remove' },

  'gc.sales.heading':     { tl: 'Mga detalye ng product mo', en: 'Your product details' },
  'gc.sales.name':        { tl: 'Pangalan ng product',      en: 'Product name' },
  'gc.sales.headline':    { tl: 'Headline (optional)',      en: 'Headline (optional)' },
  'gc.sales.description': { tl: 'Description (optional)',   en: 'Description (optional)' },
  'gc.sales.price':       { tl: 'Presyo (PHP, optional)',   en: 'Price (PHP, optional)' },

  'gc.booking.heading':   { tl: 'I-confirm ang duration', en: 'Confirm appointment duration' },
  'gc.booking.duration':  { tl: 'Tagal (minutes)',           en: 'Duration (minutes)' },
  'gc.booking.note':      { tl: 'Default hours: Mon-Fri 9am-5pm. Babaguhin mo ito sa booking editor maya-maya.', en: 'Default hours: Mon-Fri 9am-5pm. You can adjust this in the booking editor later.' },

  'gc.realestate.heading': { tl: 'Magdagdag ng property',   en: 'Add a property' },
  'gc.realestate.title':   { tl: 'Pamagat / kategorya',     en: 'Title / type' },
  'gc.realestate.price':   { tl: 'Presyo (PHP, optional)',  en: 'Price (PHP, optional)' },
  'gc.realestate.location':{ tl: 'Lokasyon',                en: 'Location' },

  'gc.form.heading':         { tl: 'I-confirm ang form fields',         en: 'Confirm form fields' },
  'gc.form.subheading':      { tl: 'Inisuhestiyon ng AI base sa info mo.', en: 'AI suggested these from your info.' },
  'gc.qualification.heading':{ tl: 'I-confirm ang mga qualification questions', en: 'Confirm qualifying questions' },
  'gc.form.add_field':       { tl: '+ Magdagdag ng field',  en: '+ Add field' },
  'gc.form.label_ph':        { tl: 'Label ng field',        en: 'Field label' },
  'gc.form.error.generation':{ tl: 'Hindi nag-generate ang AI. Subukan ulit o i-skip.', en: 'AI failed. Retry or skip.' },
```

- [ ] **Step 2: `CatalogContent.tsx`**

```tsx
'use client'

import { useActionState, useState } from 'react'
import { saveCatalogProductsAction } from '../actions'
import { StepNav } from '../_components/StepNav'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

interface P { title: string; price_amount: number | null; summary: string }

export function CatalogContent({ lang }: { lang: OnboardingLang; pageId: string }) {
  const [products, setProducts] = useState<P[]>([{ title: '', price_amount: null, summary: '' }])
  const [state, action, pending] = useActionState(saveCatalogProductsAction, {})

  const payload = products
    .map((p) => ({
      title: p.title.trim(),
      price_amount: p.price_amount,
      summary: p.summary.trim() || undefined,
    }))
    .filter((p) => p.title.length > 0)

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="products_json" value={JSON.stringify(payload)} />
      <h2 className="text-sm font-medium text-zinc-700">{t('gc.catalog.heading', lang)}</h2>

      <ul className="space-y-3">
        {products.map((p, i) => (
          <li key={i} className="rounded-md border border-zinc-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <input
                type="text"
                value={p.title}
                onChange={(e) => setProducts((prev) => prev.map((it, j) => (j === i ? { ...it, title: e.target.value } : it)))}
                placeholder={t('gc.product.title_ph', lang)}
                maxLength={160}
                className="w-full border-0 bg-transparent text-sm font-medium text-zinc-900 focus:outline-none"
              />
              {products.length > 1 && (
                <button
                  type="button"
                  onClick={() => setProducts((prev) => prev.filter((_, j) => j !== i))}
                  className="text-xs text-zinc-500 hover:text-red-600"
                >
                  {t('gc.product.remove', lang)}
                </button>
              )}
            </div>
            <input
              type="number"
              value={p.price_amount ?? ''}
              onChange={(e) =>
                setProducts((prev) =>
                  prev.map((it, j) => (j === i ? { ...it, price_amount: e.target.value ? Number(e.target.value) : null } : it)),
                )
              }
              placeholder={t('gc.product.price_ph', lang)}
              min={0}
              className="mt-2 block w-40 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm"
            />
            <textarea
              value={p.summary}
              onChange={(e) => setProducts((prev) => prev.map((it, j) => (j === i ? { ...it, summary: e.target.value } : it)))}
              placeholder={t('gc.product.summary_ph', lang)}
              maxLength={280}
              rows={2}
              className="mt-2 w-full resize-y border-0 bg-transparent text-sm text-zinc-700 focus:outline-none"
            />
          </li>
        ))}
      </ul>

      {products.length < 5 && (
        <button
          type="button"
          onClick={() => setProducts((prev) => [...prev, { title: '', price_amount: null, summary: '' }])}
          className="text-sm font-medium text-emerald-700 hover:text-emerald-900"
        >
          {t('gc.catalog.add', lang)}
        </button>
      )}

      {state.error && <p className="text-sm text-red-600">{t('goal_content.error.save', lang)}</p>}

      <StepNav
        step="goal_content"
        lang={lang}
        continueSlot={
          <button type="submit" disabled={pending} className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
            {pending ? t('goal_content.saving', lang) : t('goal_content.save', lang)}
          </button>
        }
      />
    </form>
  )
}
```

- [ ] **Step 3: `SalesContent.tsx`**

```tsx
'use client'

import { useActionState } from 'react'
import { saveSalesContentAction } from '../actions'
import { StepNav } from '../_components/StepNav'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

export function SalesContent({ lang, pageId, config }: { lang: OnboardingLang; pageId: string; config: unknown }) {
  const cfg = (config as Record<string, any>) ?? {}
  const product = cfg.product ?? {}
  const price = cfg.price ?? {}
  const [state, action, pending] = useActionState(saveSalesContentAction, {})

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="page_id" value={pageId} />
      <h2 className="text-sm font-medium text-zinc-700">{t('gc.sales.heading', lang)}</h2>

      <Labeled label={t('gc.sales.name', lang)}><input name="name" defaultValue={product.name ?? ''} required maxLength={160} className={inp} /></Labeled>
      <Labeled label={t('gc.sales.headline', lang)}><input name="headline" defaultValue={product.headline ?? ''} maxLength={240} className={inp} /></Labeled>
      <Labeled label={t('gc.sales.description', lang)}><textarea name="description" rows={4} defaultValue={product.description ?? ''} maxLength={4000} className={inp} /></Labeled>
      <Labeled label={t('gc.sales.price', lang)}><input type="number" name="price_amount" defaultValue={price.amount ?? ''} min={0} className={`${inp} w-40`} /></Labeled>

      {state.error && <p className="text-sm text-red-600">{t('goal_content.error.save', lang)}</p>}
      <StepNav step="goal_content" lang={lang} continueSlot={<SaveButton pending={pending} lang={lang} />} />
    </form>
  )
}

const inp = 'mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm'
function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-sm font-medium text-zinc-900">{label}</span>{children}</label>
}
function SaveButton({ pending, lang }: { pending: boolean; lang: OnboardingLang }) {
  return (
    <button type="submit" disabled={pending} className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
      {pending ? t('goal_content.saving', lang) : t('goal_content.save', lang)}
    </button>
  )
}
```

- [ ] **Step 4: `BookingContent.tsx`**

```tsx
'use client'

import { useActionState } from 'react'
import { saveBookingContentAction } from '../actions'
import { StepNav } from '../_components/StepNav'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

export function BookingContent({ lang, pageId, config }: { lang: OnboardingLang; pageId: string; config: unknown }) {
  const cfg = (config as Record<string, any>) ?? {}
  const duration = cfg.appointment?.duration_min ?? 30
  const [state, action, pending] = useActionState(saveBookingContentAction, {})

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="page_id" value={pageId} />
      <h2 className="text-sm font-medium text-zinc-700">{t('gc.booking.heading', lang)}</h2>
      <label className="block">
        <span className="block text-sm font-medium text-zinc-900">{t('gc.booking.duration', lang)}</span>
        <input type="number" name="duration_min" defaultValue={duration} min={5} max={480} className="mt-1 block w-40 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm" />
      </label>
      <p className="text-xs text-zinc-500">{t('gc.booking.note', lang)}</p>
      {state.error && <p className="text-sm text-red-600">{t('goal_content.error.save', lang)}</p>}
      <StepNav step="goal_content" lang={lang} continueSlot={
        <button type="submit" disabled={pending} className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
          {pending ? t('goal_content.saving', lang) : t('goal_content.save', lang)}
        </button>
      } />
    </form>
  )
}
```

- [ ] **Step 5: `RealestateContent.tsx`**

```tsx
'use client'

import { useActionState } from 'react'
import { saveRealestatePropertyAction } from '../actions'
import { StepNav } from '../_components/StepNav'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

export function RealestateContent({ lang }: { lang: OnboardingLang; pageId: string }) {
  const [state, action, pending] = useActionState(saveRealestatePropertyAction, {})
  return (
    <form action={action} className="space-y-4">
      <h2 className="text-sm font-medium text-zinc-700">{t('gc.realestate.heading', lang)}</h2>
      <Labeled label={t('gc.realestate.title', lang)}><input name="title" required maxLength={160} className={inp} /></Labeled>
      <Labeled label={t('gc.realestate.price', lang)}><input type="number" name="price_amount" min={0} className={`${inp} w-40`} /></Labeled>
      <Labeled label={t('gc.realestate.location', lang)}><input name="location" maxLength={280} className={inp} /></Labeled>
      {state.error && <p className="text-sm text-red-600">{t('goal_content.error.save', lang)}</p>}
      <StepNav step="goal_content" lang={lang} continueSlot={
        <button type="submit" disabled={pending} className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
          {pending ? t('goal_content.saving', lang) : t('goal_content.save', lang)}
        </button>
      } />
    </form>
  )
}

const inp = 'mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm'
function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-sm font-medium text-zinc-900">{label}</span>{children}</label>
}
```

- [ ] **Step 6: AI form fields generator + test**

`src/lib/onboarding/ai/form-fields.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rag', () => ({
  HfRouterLlm: vi.fn().mockImplementation(function HfRouterLlmMock(this: { complete: ReturnType<typeof vi.fn> }) {
    this.complete = vi.fn(async () =>
      JSON.stringify({
        blocks: [
          { id: 'f_name',  type: 'field', key: 'full_name', label: 'Buong pangalan',  field_kind: 'short_text', required: true },
          { id: 'f_email', type: 'field', key: 'email',     label: 'Email',           field_kind: 'email',      required: true },
          { id: 'f_msg',   type: 'field', key: 'message',   label: 'Tanong mo?',     field_kind: 'long_text',  required: false },
        ],
      }),
    )
    return this
  }),
}))

import { generateFormFields } from './form-fields'
import type { BusinessBasics } from '@/lib/onboarding/business-basics'

const basics: BusinessBasics = {
  name: 'Aling Nena Bakery', offer: 'Fresh ensaymada', business_type: 'ecom',
  audience: 'Tita moms in QC', pain: 'no time to bake', tone: 'friendly',
}

describe('generateFormFields', () => {
  it('returns block list', async () => {
    const out = await generateFormFields({ basics, kind: 'form', lang: 'tl' })
    expect(out.blocks.length).toBeGreaterThan(0)
    expect(out.blocks[0].key).toBe('full_name')
  })
})
```

`src/lib/onboarding/ai/form-fields.ts`:

```ts
import 'server-only'
import { z } from 'zod'
import { HfRouterLlm } from '@/lib/rag'
import type { BusinessBasics } from '@/lib/onboarding/business-basics'
import type { OnboardingLang } from '@/lib/onboarding/types'

export type FormFieldKind = 'short_text' | 'long_text' | 'email' | 'phone' | 'number' | 'single_choice'

export interface SuggestedBlock {
  id: string
  type: 'field' | 'heading'
  key?: string
  label?: string
  text?: string
  level?: number
  field_kind?: FormFieldKind
  required?: boolean
  options?: { label: string; value: string }[]
  prompt?: string  // for qualification questions
}

const BlockSchema = z.object({
  id: z.string(),
  type: z.enum(['field', 'heading']),
  key: z.string().optional(),
  label: z.string().optional(),
  text: z.string().optional(),
  level: z.number().int().optional(),
  field_kind: z.enum(['short_text','long_text','email','phone','number','single_choice']).optional(),
  required: z.boolean().optional(),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  prompt: z.string().optional(),
})
const ResponseSchema = z.object({ blocks: z.array(BlockSchema).min(1).max(15) })

function sys(kind: 'form' | 'qualification', lang: OnboardingLang) {
  const lline = lang === 'tl' ? 'I-label sa Tagalog (Taglish OK).' : 'Label in English.'
  if (kind === 'qualification') {
    return [
      'Generate 3-6 qualification questions for a small Filipino business chatbot.',
      'Each question scores the lead\'s fit (decision maker, budget, timeline, need).',
      'Output JSON: { "blocks": [{ "id": string, "type": "field", "key": string, "field_kind": "single_choice", "prompt": string, "label": string, "required": true, "options": [{ "label": string, "value": string }] }] }',
      lline,
    ].join('\n')
  }
  return [
    'Generate 3-6 form fields for a lead-capture form.',
    'Always include full_name (short_text required) and at least one contact (email or phone).',
    'Output JSON: { "blocks": [{ "id": string, "type": "field", "key": string, "label": string, "field_kind": "short_text"|"long_text"|"email"|"phone"|"number", "required": boolean }] }',
    lline,
  ].join('\n')
}

function usr(b: BusinessBasics) {
  return [`Business: ${b.name}`, `Offer: ${b.offer}`, `Audience: ${b.audience}`, `Pain: ${b.pain}`].join('\n')
}

export async function generateFormFields(input: {
  basics: BusinessBasics
  kind: 'form' | 'qualification'
  lang: OnboardingLang
}): Promise<{ blocks: SuggestedBlock[] }> {
  const llm = new HfRouterLlm()
  let raw: string
  try {
    raw = await llm.complete(
      [{ role: 'system', content: sys(input.kind, input.lang) }, { role: 'user', content: usr(input.basics) }],
      { responseFormat: 'json_object', temperature: 0.5, maxTokens: 900 },
    )
  } catch (err) { throw new Error('generation_failed: llm_call', { cause: err }) }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error('generation_failed: invalid_json') }
  const r = ResponseSchema.safeParse(parsed)
  if (!r.success) throw new Error('generation_failed: schema_mismatch')
  return r.data
}
```

- [ ] **Step 7: Wire the AI into a small generator action**

In `actions.ts` add:

```ts
import { generateFormFields, type SuggestedBlock } from '@/lib/onboarding/ai/form-fields'

export async function generateFormFieldsAction(kind: 'form' | 'qualification'): Promise<
  | { ok: true; blocks: SuggestedBlock[] }
  | { ok: false; error: 'no_basics' | 'generation_failed' }
> {
  const basics = await getBusinessBasics()
  if (!basics) return { ok: false, error: 'no_basics' }
  try {
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return { ok: false, error: 'generation_failed' }
    const { data: state } = await supabase.from('onboarding_state').select('ui_language').eq('profile_id', auth.user.id).maybeSingle()
    const lang = state?.ui_language === 'en' ? 'en' : 'tl'
    const { blocks } = await generateFormFields({ basics, kind, lang })
    return { ok: true, blocks }
  } catch (err) {
    console.error('[generateFormFieldsAction]', err)
    return { ok: false, error: 'generation_failed' }
  }
}
```

- [ ] **Step 8: `FormFieldsContent.tsx`**

```tsx
import { generateFormFieldsAction, saveFormFieldsAction } from '../actions'
import { FormFieldsEditor } from './FormFieldsEditor'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

export async function FormFieldsContent({
  lang,
  pageId,
  kind,
  config,
}: {
  lang: OnboardingLang
  pageId: string
  kind: 'form' | 'qualification'
  config: unknown
}) {
  const existing = (config as { blocks?: unknown[] })?.blocks ?? []
  let blocks = existing as { id: string; label?: string; prompt?: string }[]
  if (blocks.length === 0) {
    const r = await generateFormFieldsAction(kind)
    if (r.ok) blocks = r.blocks
    else {
      return (
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          {t('gc.form.error.generation', lang)}
        </div>
      )
    }
  }

  return (
    <div>
      <h2 className="text-sm font-medium text-zinc-700">
        {kind === 'qualification' ? t('gc.qualification.heading', lang) : t('gc.form.heading', lang)}
      </h2>
      <p className="mt-1 text-xs text-zinc-500">{t('gc.form.subheading', lang)}</p>
      <FormFieldsEditor lang={lang} pageId={pageId} initialBlocks={blocks} kind={kind} />
    </div>
  )
}
```

`FormFieldsEditor.tsx` (separate client component):

```tsx
'use client'

import { useActionState, useState } from 'react'
import { saveFormFieldsAction } from '../actions'
import { StepNav } from '../_components/StepNav'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

interface BlockLite { id: string; label?: string; prompt?: string }

export function FormFieldsEditor({
  lang, pageId, initialBlocks, kind,
}: {
  lang: OnboardingLang; pageId: string; initialBlocks: BlockLite[]; kind: 'form' | 'qualification'
}) {
  const [blocks, setBlocks] = useState<BlockLite[]>(initialBlocks)
  const [state, action, pending] = useActionState(saveFormFieldsAction, {})

  return (
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="page_id" value={pageId} />
      <input type="hidden" name="blocks_json" value={JSON.stringify(blocks)} />

      <ul className="space-y-2">
        {blocks.map((b, i) => (
          <li key={b.id} className="rounded-md border border-zinc-200 bg-white p-3">
            <input
              type="text"
              value={(kind === 'qualification' ? b.prompt : b.label) ?? ''}
              onChange={(e) =>
                setBlocks((prev) =>
                  prev.map((it, j) =>
                    j === i
                      ? kind === 'qualification'
                        ? { ...it, prompt: e.target.value }
                        : { ...it, label: e.target.value }
                      : it,
                  ),
                )
              }
              maxLength={300}
              className="w-full border-0 bg-transparent text-sm font-medium text-zinc-900 focus:outline-none"
              placeholder={t('gc.form.label_ph', lang)}
            />
          </li>
        ))}
      </ul>

      {state.error && <p className="text-sm text-red-600">{t('goal_content.error.save', lang)}</p>}

      <StepNav step="goal_content" lang={lang} continueSlot={
        <button type="submit" disabled={pending} className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
          {pending ? t('goal_content.saving', lang) : t('goal_content.save', lang)}
        </button>
      } />
    </form>
  )
}
```

- [ ] **Step 9: tsc clean. Commit.**

```bash
git add 'src/app/(app)/onboarding/goal-content/' src/lib/onboarding/ai/form-fields.ts src/lib/onboarding/ai/form-fields.test.ts src/lib/onboarding/i18n.ts
git commit -m "feat(onboarding): per-kind goal content forms (step 6)"
```

---

## Task 4: Flow step — AI bot-instructions generator

**Files:**
- Create: `src/lib/onboarding/ai/bot-instructions.ts`
- Create: `src/lib/onboarding/ai/bot-instructions.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rag', () => ({
  HfRouterLlm: vi.fn().mockImplementation(function HfRouterLlmMock(this: { complete: ReturnType<typeof vi.fn> }) {
    this.complete = vi.fn(async () =>
      JSON.stringify({
        bot_send_instructions: 'Send the booking link when the customer asks about scheduling.',
        recommendation_rules: 'Wait until the customer mentions a specific date/time or asks "kelan available". Confirm need then send link.',
        required_slots: ['preferred_date'],
        confidence_threshold: 0.6,
      }),
    )
    return this
  }),
}))

import { generateBotInstructions } from './bot-instructions'
import type { BusinessBasics } from '@/lib/onboarding/business-basics'

const basics: BusinessBasics = {
  name: 'Bakery', offer: 'ensaymada', business_type: 'ecom',
  audience: 'titas', pain: 'no time', tone: 'friendly',
}

describe('generateBotInstructions', () => {
  it('returns parsed fields', async () => {
    const r = await generateBotInstructions({
      basics, lang: 'tl', goal: 'booking',
      action_page: { title: 'Book a tasting', cta_label: 'Book a slot' },
      flow_description: 'They ask price, then I send booking link.',
    })
    expect(r.bot_send_instructions).toMatch(/booking/i)
    expect(r.recommendation_rules).toMatch(/specific date/i)
    expect(r.required_slots).toEqual(['preferred_date'])
    expect(r.confidence_threshold).toBeCloseTo(0.6)
  })
})
```

- [ ] **Step 2: Implement**

```ts
import 'server-only'
import { z } from 'zod'
import { HfRouterLlm } from '@/lib/rag'
import type { BusinessBasics } from '@/lib/onboarding/business-basics'
import type { OnboardingLang } from '@/lib/onboarding/types'
import type { ActionPageKind } from '@/lib/action-pages/kinds'

export interface GeneratedBotInstructions {
  bot_send_instructions: string
  recommendation_rules: string
  required_slots: string[]
  confidence_threshold: number
}

const ResponseSchema = z.object({
  bot_send_instructions: z.string().trim().min(20).max(2000),
  recommendation_rules: z.string().trim().min(20).max(2000),
  required_slots: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  confidence_threshold: z.number().min(0).max(1).default(0.55),
})

function sys(lang: OnboardingLang, kind: ActionPageKind): string {
  const lline = lang === 'tl' ? 'Sumagot sa Tagalog/Taglish — kung paano nagtatanong ang totoong customers.' : 'Reply in English.'
  return [
    `You design when a Filipino business chatbot should send the user's "${kind}" action page.`,
    'Given the business basics, the chosen action page, and the owner\'s description of the ideal conversation flow, produce:',
    '1) bot_send_instructions: natural-language guidance the bot follows for THIS specific page. Concrete triggers ("when X happens, send this"). Include guardrails ("do NOT send before Y").',
    '2) recommendation_rules: stricter conditions when the bot must wait or qualify further before sending. Specific signals/phrases that customers actually say.',
    '3) required_slots: short list of conversation slots the bot should confirm before sending (e.g., "preferred_date", "budget", "address"). Empty array if none.',
    '4) confidence_threshold: 0..1 — how confident the classifier must be before sending. 0.5 default. 0.65 for sensitive conversions.',
    'Output strict JSON only: { "bot_send_instructions": string, "recommendation_rules": string, "required_slots": string[], "confidence_threshold": number }',
    lline,
  ].join('\n')
}

function usr(b: BusinessBasics, page: { title: string; cta_label: string }, flow: string): string {
  return [
    `Business: ${b.name} — ${b.offer}`,
    `Audience: ${b.audience}`,
    `Action page: "${page.title}" (CTA: "${page.cta_label}")`,
    `Owner's ideal flow:`,
    flow,
  ].join('\n')
}

export async function generateBotInstructions(input: {
  basics: BusinessBasics
  goal: ActionPageKind
  action_page: { title: string; cta_label: string }
  flow_description: string
  lang: OnboardingLang
}): Promise<GeneratedBotInstructions> {
  const llm = new HfRouterLlm()
  let raw: string
  try {
    raw = await llm.complete(
      [{ role: 'system', content: sys(input.lang, input.goal) }, { role: 'user', content: usr(input.basics, input.action_page, input.flow_description) }],
      { responseFormat: 'json_object', temperature: 0.5, maxTokens: 900 },
    )
  } catch (err) { throw new Error('generation_failed: llm_call', { cause: err }) }
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { throw new Error('generation_failed: invalid_json') }
  const r = ResponseSchema.safeParse(parsed)
  if (!r.success) throw new Error('generation_failed: schema_mismatch')
  return r.data
}
```

- [ ] **Step 3: Run, PASS. Commit.**

```bash
git add src/lib/onboarding/ai/bot-instructions.ts src/lib/onboarding/ai/bot-instructions.test.ts
git commit -m "feat(onboarding): AI bot-instructions generator"
```

---

## Task 5: Flow step — server actions + page + i18n

**Files:**
- Modify: `src/app/(app)/onboarding/actions.ts`
- Create: `src/app/(app)/onboarding/flow/page.tsx`
- Create: `src/app/(app)/onboarding/flow/FlowForm.tsx`
- Create: `src/app/(app)/onboarding/flow/FlowPreview.tsx`

- [ ] **Step 1: i18n keys**

```ts
  'flow.heading':         { tl: 'Daloy ng usapan',         en: 'Conversation flow' },
  'flow.subheading':      { tl: 'I-describe sa simpleng salita kung paano dapat mag-usap ang bot mo. Gagawa ng AI ng instructions + rules.', en: 'Describe in plain words how your bot should flow with customers. AI turns this into send-instructions + rules.' },
  'flow.description.label': { tl: 'Halimbawa, "Tinatanong nila ang presyo, sinasagot ko, tinatanong ko kung gusto mag-book."', en: 'e.g. "They ask about price, I answer, then I ask if they want to book."' },
  'flow.description.ph':  { tl: 'Sulatin mo dito…',          en: 'Type here…' },
  'flow.generate':        { tl: 'Mag-generate ng instructions', en: 'Generate instructions' },
  'flow.generating':      { tl: 'Sini-generate ng AI…',      en: 'AI is drafting…' },
  'flow.preview.bot_instructions': { tl: 'Kailan ipapadala ang action page', en: 'When to send the action page' },
  'flow.preview.rules':            { tl: 'Recommendation rules',           en: 'Recommendation rules' },
  'flow.preview.slots':            { tl: 'Slots na kailangang confirm-in', en: 'Slots to confirm first' },
  'flow.save':            { tl: 'I-save at tapusin',         en: 'Save and finish' },
  'flow.saving':          { tl: 'Sini-save…',                 en: 'Saving…' },
  'flow.error.no_goal':   { tl: 'Pumili muna ng goal.',       en: 'Pick a goal first.' },
  'flow.error.generation':{ tl: 'Hindi nag-generate ang AI. Subukan ulit o i-skip.', en: 'AI failed. Retry or skip.' },
  'flow.error.save':      { tl: 'May error sa pag-save.',     en: 'Could not save.' },
```

- [ ] **Step 2: Server actions**

Imports (consolidate):
```ts
import { generateBotInstructions, type GeneratedBotInstructions } from '@/lib/onboarding/ai/bot-instructions'
```

Append:

```ts
const FlowPayloadSchema = z.object({
  flow_description: z.string().trim().min(20).max(2000),
})

export type FlowStepError = 'no_goal' | 'no_basics' | 'generation_failed' | 'save_failed'

export async function generateFlowAction(
  formData: FormData,
): Promise<
  | { ok: true; data: GeneratedBotInstructions; pageId: string }
  | { ok: false; error: FlowStepError }
> {
  const parsed = FlowPayloadSchema.safeParse({ flow_description: formData.get('flow_description') })
  if (!parsed.success) return { ok: false, error: 'save_failed' }

  const basics = await getBusinessBasics()
  if (!basics) return { ok: false, error: 'no_basics' }
  const page = await (await import('@/lib/onboarding/state')).getPrimaryActionPage()
  if (!page) return { ok: false, error: 'no_goal' }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { ok: false, error: 'generation_failed' }

  const { data: state } = await supabase.from('onboarding_state').select('ui_language').eq('profile_id', auth.user.id).maybeSingle()
  const lang = state?.ui_language === 'en' ? 'en' : 'tl'

  // Persist the flow description for re-entry.
  await supabase.from('onboarding_state').update({ flow_description: parsed.data.flow_description }).eq('profile_id', auth.user.id)

  // Read the page's cta_label from config.cta.primary_label or top-level cta_label.
  const cfg = (page.config as Record<string, any>) ?? {}
  const ctaLabel = (cfg.cta?.primary_label as string | undefined) ?? page.title

  try {
    const data = await generateBotInstructions({
      basics,
      goal: page.kind as ActionPageKind,
      action_page: { title: page.title, cta_label: ctaLabel },
      flow_description: parsed.data.flow_description,
      lang,
    })
    return { ok: true, data, pageId: page.id }
  } catch (err) {
    console.error('[generateFlowAction]', err)
    return { ok: false, error: 'generation_failed' }
  }
}

const SaveFlowSchema = z.object({
  pageId: z.string().uuid(),
  bot_send_instructions: z.string().trim().min(10).max(2000),
  recommendation_rules: z.string().trim().min(10).max(2000),
  required_slots: z.array(z.string().trim().min(1).max(60)).max(10),
  confidence_threshold: z.number().min(0).max(1),
})

export async function saveFlowAction(
  _prev: { error?: FlowStepError } | undefined,
  formData: FormData,
): Promise<{ error?: FlowStepError }> {
  const slotsRaw = formData.get('required_slots_json')
  let slots: string[] = []
  try { slots = JSON.parse(String(slotsRaw ?? '[]')) } catch { /* keep empty */ }

  const parsed = SaveFlowSchema.safeParse({
    pageId: formData.get('page_id'),
    bot_send_instructions: formData.get('bot_send_instructions'),
    recommendation_rules: formData.get('recommendation_rules'),
    required_slots: slots,
    confidence_threshold: Number(formData.get('confidence_threshold') ?? 0.55),
  })
  if (!parsed.success) return { error: 'save_failed' }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { error: 'save_failed' }

  const { error: pageErr } = await supabase
    .from('action_pages')
    .update({ bot_send_instructions: parsed.data.bot_send_instructions })
    .eq('id', parsed.data.pageId)
    .eq('user_id', auth.user.id)
  if (pageErr) {
    console.error('[saveFlowAction] action_pages', pageErr)
    return { error: 'save_failed' }
  }

  // Recommendation rules format mirrors RecommendationRulesMap:
  // { defaultConfidenceThreshold, perActionPage: { [pageId]: { rules, requiredSlots, confidenceThreshold } } }
  const { data: cfgRow } = await supabase
    .from('chatbot_configs')
    .select('recommendation_rules')
    .eq('user_id', auth.user.id)
    .maybeSingle()
  const existing = (cfgRow?.recommendation_rules as Record<string, unknown> | null) ?? {}
  const per = (existing.perActionPage as Record<string, unknown> | undefined) ?? {}
  const next = {
    defaultConfidenceThreshold: (existing.defaultConfidenceThreshold as number | undefined) ?? 0.55,
    perActionPage: {
      ...per,
      [parsed.data.pageId]: {
        rules: parsed.data.recommendation_rules,
        requiredSlots: parsed.data.required_slots,
        confidenceThreshold: parsed.data.confidence_threshold,
      },
    },
  }

  const { error: cfgErr } = await supabase
    .from('chatbot_configs')
    .upsert({ user_id: auth.user.id, recommendation_rules: next }, { onConflict: 'user_id' })
  if (cfgErr) {
    console.error('[saveFlowAction] chatbot_configs', cfgErr)
    return { error: 'save_failed' }
  }

  await markStep('flow')
  redirect('/onboarding/done')
}
```

- [ ] **Step 3: Page + components**

`src/app/(app)/onboarding/flow/page.tsx`:

```tsx
import Link from 'next/link'
import { WizardShell } from '../_components/WizardShell'
import { FlowForm } from './FlowForm'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { getOnboardingState, getPrimaryActionPage } from '@/lib/onboarding/state'
import { t } from '@/lib/onboarding/i18n'

export const dynamic = 'force-dynamic'

export default async function FlowPage() {
  const [lang, page, state] = await Promise.all([
    getOnboardingLang(),
    getPrimaryActionPage(),
    getOnboardingState(),
  ])

  if (!page) {
    return (
      <WizardShell lang={lang} step="flow">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('flow.heading', lang)}</h1>
        <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p>{t('flow.error.no_goal', lang)}</p>
          <Link href="/onboarding/goal" className="mt-2 inline-block font-medium underline">
            {t('shell.back', lang)}
          </Link>
        </div>
      </WizardShell>
    )
  }

  return (
    <WizardShell lang={lang} step="flow">
      <h1 className="text-2xl font-semibold text-zinc-900">{t('flow.heading', lang)}</h1>
      <p className="mt-1 text-sm text-zinc-600">{t('flow.subheading', lang)}</p>
      <div className="mt-6">
        <FlowForm
          lang={lang}
          pageId={page.id}
          pageTitle={page.title}
          initialDescription={state?.flow_description ?? ''}
        />
      </div>
    </WizardShell>
  )
}
```

`src/app/(app)/onboarding/flow/FlowForm.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { generateFlowAction } from '../actions'
import { FlowPreview } from './FlowPreview'
import { StepNav } from '../_components/StepNav'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'
import type { GeneratedBotInstructions } from '@/lib/onboarding/ai/bot-instructions'

export function FlowForm({
  lang, pageId, pageTitle, initialDescription,
}: {
  lang: OnboardingLang; pageId: string; pageTitle: string; initialDescription: string
}) {
  const [description, setDescription] = useState(initialDescription)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<GeneratedBotInstructions | null>(null)
  const [pending, start] = useTransition()

  async function handleGenerate(formData: FormData) {
    start(async () => {
      setError(null)
      const r = await generateFlowAction(formData)
      if (r.ok) setPreview(r.data)
      else setError(r.error === 'generation_failed' ? t('flow.error.generation', lang) : t('flow.error.save', lang))
    })
  }

  if (preview) {
    return <FlowPreview lang={lang} pageId={pageId} initial={preview} onBack={() => setPreview(null)} />
  }

  return (
    <form action={handleGenerate} className="space-y-4">
      <p className="text-xs text-zinc-500">{pageTitle}</p>
      <label className="block">
        <span className="block text-sm font-medium text-zinc-900">{t('flow.description.label', lang)}</span>
        <textarea
          name="flow_description"
          rows={6}
          required
          minLength={20}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('flow.description.ph', lang)}
          className="mt-1 block w-full resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <StepNav step="flow" lang={lang} continueSlot={
        <button type="submit" disabled={pending || description.trim().length < 20} className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
          {pending ? t('flow.generating', lang) : t('flow.generate', lang)}
        </button>
      } />
    </form>
  )
}
```

`src/app/(app)/onboarding/flow/FlowPreview.tsx`:

```tsx
'use client'

import { useActionState, useState } from 'react'
import { saveFlowAction } from '../actions'
import { StepNav } from '../_components/StepNav'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'
import type { GeneratedBotInstructions } from '@/lib/onboarding/ai/bot-instructions'

export function FlowPreview({
  lang, pageId, initial, onBack,
}: {
  lang: OnboardingLang; pageId: string; initial: GeneratedBotInstructions; onBack: () => void
}) {
  const [data, setData] = useState(initial)
  const [state, action, pending] = useActionState(saveFlowAction, {})

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="page_id" value={pageId} />
      <input type="hidden" name="required_slots_json" value={JSON.stringify(data.required_slots)} />
      <input type="hidden" name="confidence_threshold" value={String(data.confidence_threshold)} />

      <Section title={t('flow.preview.bot_instructions', lang)}>
        <textarea
          name="bot_send_instructions"
          rows={4}
          maxLength={2000}
          value={data.bot_send_instructions}
          onChange={(e) => setData((p) => ({ ...p, bot_send_instructions: e.target.value }))}
          className={inp}
        />
      </Section>

      <Section title={t('flow.preview.rules', lang)}>
        <textarea
          name="recommendation_rules"
          rows={4}
          maxLength={2000}
          value={data.recommendation_rules}
          onChange={(e) => setData((p) => ({ ...p, recommendation_rules: e.target.value }))}
          className={inp}
        />
      </Section>

      <div className="text-xs text-zinc-600">
        <span className="font-medium">{t('flow.preview.slots', lang)}: </span>
        {data.required_slots.length === 0 ? '—' : data.required_slots.join(', ')}
      </div>

      <button type="button" onClick={onBack} className="text-sm text-zinc-600 hover:text-zinc-900">{t('shell.back', lang)}</button>

      {state.error && <p className="text-sm text-red-600">{t('flow.error.save', lang)}</p>}

      <StepNav step="flow" lang={lang} continueSlot={
        <button type="submit" disabled={pending} className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
          {pending ? t('flow.saving', lang) : t('flow.save', lang)}
        </button>
      } />
    </form>
  )
}

const inp = 'mt-1 block w-full resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600'
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-zinc-900">{title}</h3>
      {children}
    </div>
  )
}
```

- [ ] **Step 4: tsc clean. Run tests.**

```
npx tsc --noEmit
npx vitest run src/lib/onboarding/
```

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(app)/onboarding/flow/' 'src/app/(app)/onboarding/actions.ts' src/lib/onboarding/i18n.ts
git commit -m "feat(onboarding): conversation-flow → AI bot instructions (step 7)"
```

---

## Task 6: End-to-end smoke + final polish

- [ ] **Step 1: Verify happy path**

Fresh signup → business → knowledge save → faqs save → personality save → goal (catalog) → goal-content (1 product) → flow (describe, generate, save) → done. Verify in DB:
- `action_pages` row created with `kind='catalog'`, `bot_send_instructions` populated after step 7.
- `business_items` row(s) for the products.
- `chatbot_configs.primary_action_page_id` points at the new page.
- `chatbot_configs.recommendation_rules.perActionPage[pageId]` populated.
- `onboarding_state.completed_at` set.

- [ ] **Step 2: Verify each branch**

Repeat the flow with `service` business type (booking goal), `digital` (sales), `realestate` (realestate). Confirm each kind's goal-content form renders and saves to the right place.

- [ ] **Step 3: Verify error path**

Skip step 5, go straight to `/onboarding/flow` → expect "Pick a goal first" amber message + back link.

- [ ] **Step 4: Run full test suite**

```
npx vitest run src/lib/onboarding/
```

All passing.

- [ ] **Step 5: Commit any fixes; otherwise no commit.**

---

## Self-Review

**Spec coverage** (Phase 4):
- [x] Step 5 — pick goal, create starter action page from `KIND_REGISTRY`, set `primary_action_page_id` — Task 1
- [x] Step 6 light per-kind content for all 6 kinds — Tasks 2, 3
- [x] AI-suggested form fields (form/qualification) — Task 3
- [x] Step 7 — flow description → AI bot instructions + recommendation rules → editable preview → save — Tasks 4, 5
- [x] Re-entry pre-fill for flow description — Task 5
- [x] AI language matches `ui_language` — all generators

**Placeholder scan:** none.

**Type consistency:** `ActionPageKind` from `kinds.ts` used everywhere. `GeneratedBotInstructions` shape matches the save schema. `SuggestedBlock` shape matches what `FormFieldsEditor` reads.

**Known limitations (acceptable for v1):**
- Re-entering step 5 with a different kind leaves the old draft action page orphaned (not deleted). Cleanup deferred — user can archive in the dashboard.
- Goal-content forms write `status='published'` on save — sales kind defaults to draft but Phase 6 forces publish via the editor's "go live" UX, so this is fine for now.
- Form/qualification suggested blocks are stored with the AI's `id` strings as-is; the existing editor handles them.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-onboarding-phase4-goal-flow.md`. Continuing **Subagent-Driven** execution.
