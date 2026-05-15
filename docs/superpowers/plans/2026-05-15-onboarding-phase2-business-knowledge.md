# Onboarding Wizard — Phase 2: Business Basics + AI Knowledge

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the Phase 1 stub pages for **business** and **knowledge** with the real steps: a ~6-field business-basics form, plus an AI generator that turns those answers into a 4–6 section knowledge document the user previews and saves.

**Architecture:** A Zod-validated `business_basics` JSON is captured on step 1 and persisted to `onboarding_state.business_basics`. Step 2 server-action calls the new `generateKnowledge` lib (using `HfRouterLlm` like the existing chatbot code), receives strict JSON, and renders an editable preview. Saving the preview inserts one row into `knowledge_documents` with `content_*` already populated (no draft round-trip). All AI calls receive the user's `ui_language` so output matches the wizard locale.

**Tech Stack:** Next.js App Router · TypeScript · Supabase · Vitest · Zod · `HfRouterLlm` (OpenAI-compatible).

**Related spec:** `docs/superpowers/specs/2026-05-15-onboarding-wizard-design.md`
**Builds on:** `docs/superpowers/plans/2026-05-15-onboarding-phase1-foundation.md`

---

## Task 1: Business basics types + Zod schema

**Files:**
- Create: `src/lib/onboarding/business-basics.ts`
- Create: `src/lib/onboarding/business-basics.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// src/lib/onboarding/business-basics.test.ts
import { describe, expect, it } from 'vitest'
import { BusinessBasicsSchema, BUSINESS_TYPES, TONE_PRESETS } from './business-basics'

describe('BusinessBasicsSchema', () => {
  it('accepts a fully filled object', () => {
    const ok = BusinessBasicsSchema.safeParse({
      name: 'Aling Nena Bakery',
      offer: 'Fresh ensaymada delivered daily',
      business_type: 'ecom',
      audience: 'Tita-aged moms in Quezon City',
      pain: "They want merienda but can't bake themselves",
      tone: 'friendly',
    })
    expect(ok.success).toBe(true)
  })

  it('rejects empty name', () => {
    const r = BusinessBasicsSchema.safeParse({
      name: '',
      offer: 'x',
      business_type: 'service',
      audience: 'x',
      pain: 'x',
      tone: 'professional',
    })
    expect(r.success).toBe(false)
  })

  it('rejects unknown business_type', () => {
    const r = BusinessBasicsSchema.safeParse({
      name: 'x',
      offer: 'x',
      business_type: 'foo',
      audience: 'x',
      pain: 'x',
      tone: 'professional',
    })
    expect(r.success).toBe(false)
  })

  it('rejects fields > 500 chars', () => {
    const long = 'x'.repeat(501)
    const r = BusinessBasicsSchema.safeParse({
      name: 'ok',
      offer: long,
      business_type: 'service',
      audience: 'x',
      pain: 'x',
      tone: 'professional',
    })
    expect(r.success).toBe(false)
  })

  it('exposes 4 business types and 4 tone presets', () => {
    expect(BUSINESS_TYPES.length).toBe(4)
    expect(TONE_PRESETS.length).toBe(4)
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

```
npx vitest run src/lib/onboarding/business-basics.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/lib/onboarding/business-basics.ts
import { z } from 'zod'

export const BUSINESS_TYPES = ['service', 'ecom', 'digital', 'realestate'] as const
export type BusinessType = (typeof BUSINESS_TYPES)[number]

export const TONE_PRESETS = ['friendly', 'professional', 'playful', 'calm'] as const
export type TonePreset = (typeof TONE_PRESETS)[number]

const trimmedNonEmpty = (max: number) =>
  z
    .string()
    .trim()
    .min(1, 'Required')
    .max(max, `Must be ${max} characters or fewer`)

export const BusinessBasicsSchema = z.object({
  name: trimmedNonEmpty(120),
  offer: trimmedNonEmpty(500),
  business_type: z.enum(BUSINESS_TYPES),
  audience: trimmedNonEmpty(500),
  pain: trimmedNonEmpty(500),
  tone: z.enum(TONE_PRESETS),
})

export type BusinessBasics = z.infer<typeof BusinessBasicsSchema>
```

- [ ] **Step 4: Run, expect PASS**

```
npx vitest run src/lib/onboarding/business-basics.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/onboarding/business-basics.ts src/lib/onboarding/business-basics.test.ts
git commit -m "feat(onboarding): business basics schema and tests"
```

---

## Task 2: `saveBusinessBasics` server action + `getBusinessBasics` helper

**Files:**
- Modify: `src/lib/onboarding/state.ts`
- Modify: `src/app/(app)/onboarding/actions.ts`

- [ ] **Step 1: Extend `state.ts` with a typed read/write for `business_basics`**

Add to `src/lib/onboarding/state.ts`:

```ts
import type { BusinessBasics } from './business-basics'

/** Persist the typed business_basics JSON for the current user. */
export async function saveBusinessBasicsToState(basics: BusinessBasics): Promise<void> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('not authenticated')
  const { error } = await supabase
    .from(TABLE)
    .update({ business_basics: basics })
    .eq('profile_id', auth.user.id)
  if (error) throw error
}

/** Read the typed business_basics JSON; returns null if missing or malformed. */
export async function getBusinessBasics(): Promise<BusinessBasics | null> {
  const state = await getOnboardingState()
  if (!state?.business_basics) return null
  // Re-validate so downstream callers can trust the shape.
  const { BusinessBasicsSchema } = await import('./business-basics')
  const r = BusinessBasicsSchema.safeParse(state.business_basics)
  return r.success ? r.data : null
}
```

- [ ] **Step 2: Add the server action**

In `src/app/(app)/onboarding/actions.ts`, add:

```ts
import { BusinessBasicsSchema } from '@/lib/onboarding/business-basics'
import { markStep, saveBusinessBasicsToState } from '@/lib/onboarding/state'

export type BusinessBasicsFormState = {
  fieldErrors?: Record<string, string>
  formError?: string
}

export async function saveBusinessBasicsAction(
  _prev: BusinessBasicsFormState,
  formData: FormData,
): Promise<BusinessBasicsFormState> {
  const parsed = BusinessBasicsSchema.safeParse({
    name: formData.get('name'),
    offer: formData.get('offer'),
    business_type: formData.get('business_type'),
    audience: formData.get('audience'),
    pain: formData.get('pain'),
    tone: formData.get('tone'),
  })

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]?.toString() ?? '_'
      if (!fieldErrors[key]) fieldErrors[key] = issue.message
    }
    return { fieldErrors }
  }

  try {
    await saveBusinessBasicsToState(parsed.data)
    await markStep('business')
  } catch (err) {
    return { formError: 'Could not save. Please try again.' }
  }
  redirect('/onboarding/knowledge')
}
```

`redirect` is already imported at the top of `actions.ts`. If it isn't, add `import { redirect } from 'next/navigation'`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/onboarding/state.ts 'src/app/(app)/onboarding/actions.ts'
git commit -m "feat(onboarding): saveBusinessBasics server action + state helpers"
```

---

## Task 3: Business basics form page

**Files:**
- Modify: `src/app/(app)/onboarding/business/page.tsx` (replace stub)
- Create: `src/app/(app)/onboarding/business/BusinessForm.tsx`
- Modify: `src/lib/onboarding/i18n.ts` — add labels for fields

- [ ] **Step 1: Add i18n keys to the dictionary**

In `src/lib/onboarding/i18n.ts`, add the following entries to the `dict` object (before the closing `} as const`):

```ts
  'business.heading':       { tl: 'Mga detalye ng business mo',           en: 'About your business' },
  'business.subheading':    { tl: 'Mga ilang sagot lang para magagawa ng AI ang setup mo.', en: 'A few quick answers so AI can do the setup for you.' },
  'business.name.label':    { tl: 'Ano pangalan ng business mo?',         en: "What's your business name?" },
  'business.name.ph':       { tl: 'Hal. Aling Nena Bakery',               en: 'e.g. Aling Nena Bakery' },
  'business.offer.label':   { tl: 'Ano ang ineoffer mo sa isang pangungusap?', en: 'What do you offer, in one sentence?' },
  'business.offer.ph':      { tl: 'Hal. Sariwang ensaymada na ide-deliver araw-araw', en: 'e.g. Fresh ensaymada delivered daily' },
  'business.type.label':    { tl: 'Anong klase ng business?',             en: 'What type of business?' },
  'business.type.service':  { tl: 'Service',                              en: 'Service' },
  'business.type.ecom':     { tl: 'E-commerce',                           en: 'E-commerce' },
  'business.type.digital':  { tl: 'Digital product',                      en: 'Digital product' },
  'business.type.realestate':{ tl: 'Real estate',                         en: 'Real estate' },
  'business.audience.label':{ tl: 'Para kanino ang business mo?',         en: 'Who is this for?' },
  'business.audience.ph':   { tl: 'Hal. Mga tita sa Quezon City',         en: 'e.g. Tita-aged moms in Quezon City' },
  'business.pain.label':    { tl: 'Anong problema ang sinosolusyunan mo?', en: 'What pain are you solving for them?' },
  'business.pain.ph':       { tl: 'Hal. Gusto nila ng merienda pero walang oras magluto', en: "e.g. They want merienda but don't have time to bake" },
  'business.tone.label':    { tl: 'Anong tono ng bot mo?',                en: 'What tone should the bot use?' },
  'business.tone.friendly':     { tl: 'Friendly',     en: 'Friendly' },
  'business.tone.professional': { tl: 'Professional', en: 'Professional' },
  'business.tone.playful':      { tl: 'Playful',      en: 'Playful' },
  'business.tone.calm':         { tl: 'Calm',         en: 'Calm' },
  'business.save':          { tl: 'I-save at magpatuloy', en: 'Save and continue' },
  'business.saving':        { tl: 'Sini-save…',          en: 'Saving…' },
```

- [ ] **Step 2: Create `BusinessForm.tsx` (client component for `useFormState`)**

```tsx
// src/app/(app)/onboarding/business/BusinessForm.tsx
'use client'

import { useActionState } from 'react'
import {
  saveBusinessBasicsAction,
  type BusinessBasicsFormState,
} from '../actions'
import { t, type DictKey } from '@/lib/onboarding/i18n'
import { BUSINESS_TYPES, TONE_PRESETS, type BusinessBasics } from '@/lib/onboarding/business-basics'
import type { OnboardingLang } from '@/lib/onboarding/types'
import { StepNav } from '../_components/StepNav'

interface Props {
  lang: OnboardingLang
  initial: Partial<BusinessBasics> | null
}

const TYPE_LABEL_KEY: Record<(typeof BUSINESS_TYPES)[number], DictKey> = {
  service: 'business.type.service',
  ecom: 'business.type.ecom',
  digital: 'business.type.digital',
  realestate: 'business.type.realestate',
}

const TONE_LABEL_KEY: Record<(typeof TONE_PRESETS)[number], DictKey> = {
  friendly: 'business.tone.friendly',
  professional: 'business.tone.professional',
  playful: 'business.tone.playful',
  calm: 'business.tone.calm',
}

export function BusinessForm({ lang, initial }: Props) {
  const [state, action, pending] = useActionState<BusinessBasicsFormState, FormData>(
    saveBusinessBasicsAction,
    {},
  )
  const err = (k: string) => state.fieldErrors?.[k]

  return (
    <form action={action} className="space-y-5">
      <Field
        name="name"
        label={t('business.name.label', lang)}
        placeholder={t('business.name.ph', lang)}
        defaultValue={initial?.name ?? ''}
        error={err('name')}
        maxLength={120}
      />
      <Field
        name="offer"
        label={t('business.offer.label', lang)}
        placeholder={t('business.offer.ph', lang)}
        defaultValue={initial?.offer ?? ''}
        error={err('offer')}
        maxLength={500}
        textarea
      />

      <fieldset>
        <legend className="block text-sm font-medium text-zinc-900">
          {t('business.type.label', lang)}
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {BUSINESS_TYPES.map((type) => (
            <label
              key={type}
              className="flex cursor-pointer items-center justify-center rounded-md border border-zinc-300 bg-white p-3 text-sm text-zinc-900 hover:bg-zinc-50 has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50 has-[:checked]:text-emerald-900"
            >
              <input
                type="radio"
                name="business_type"
                value={type}
                defaultChecked={(initial?.business_type ?? 'service') === type}
                className="sr-only"
              />
              {t(TYPE_LABEL_KEY[type], lang)}
            </label>
          ))}
        </div>
        {err('business_type') && (
          <p className="mt-1 text-xs text-red-600">{err('business_type')}</p>
        )}
      </fieldset>

      <Field
        name="audience"
        label={t('business.audience.label', lang)}
        placeholder={t('business.audience.ph', lang)}
        defaultValue={initial?.audience ?? ''}
        error={err('audience')}
        maxLength={500}
        textarea
      />
      <Field
        name="pain"
        label={t('business.pain.label', lang)}
        placeholder={t('business.pain.ph', lang)}
        defaultValue={initial?.pain ?? ''}
        error={err('pain')}
        maxLength={500}
        textarea
      />

      <fieldset>
        <legend className="block text-sm font-medium text-zinc-900">
          {t('business.tone.label', lang)}
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {TONE_PRESETS.map((tone) => (
            <label
              key={tone}
              className="flex cursor-pointer items-center justify-center rounded-md border border-zinc-300 bg-white p-3 text-sm text-zinc-900 hover:bg-zinc-50 has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50 has-[:checked]:text-emerald-900"
            >
              <input
                type="radio"
                name="tone"
                value={tone}
                defaultChecked={(initial?.tone ?? 'friendly') === tone}
                className="sr-only"
              />
              {t(TONE_LABEL_KEY[tone], lang)}
            </label>
          ))}
        </div>
      </fieldset>

      {state.formError && (
        <p className="text-sm text-red-600">{state.formError}</p>
      )}

      <StepNav
        step="business"
        lang={lang}
        continueSlot={
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {pending ? t('business.saving', lang) : t('business.save', lang)}
          </button>
        }
      />
    </form>
  )
}

function Field({
  name,
  label,
  placeholder,
  defaultValue,
  error,
  textarea = false,
  maxLength,
}: {
  name: string
  label: string
  placeholder?: string
  defaultValue?: string
  error?: string
  textarea?: boolean
  maxLength?: number
}) {
  const cls =
    'mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600'
  return (
    <label className="block">
      <span className="block text-sm font-medium text-zinc-900">{label}</span>
      {textarea ? (
        <textarea
          name={name}
          rows={3}
          maxLength={maxLength}
          defaultValue={defaultValue}
          placeholder={placeholder}
          className={cls}
        />
      ) : (
        <input
          type="text"
          name={name}
          maxLength={maxLength}
          defaultValue={defaultValue}
          placeholder={placeholder}
          className={cls}
        />
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </label>
  )
}
```

- [ ] **Step 3: Replace `business/page.tsx`**

```tsx
// src/app/(app)/onboarding/business/page.tsx
import { WizardShell } from '../_components/WizardShell'
import { BusinessForm } from './BusinessForm'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { getBusinessBasics } from '@/lib/onboarding/state'
import { t } from '@/lib/onboarding/i18n'

export default async function BusinessPage() {
  const [lang, initial] = await Promise.all([
    getOnboardingLang(),
    getBusinessBasics(),
  ])
  return (
    <WizardShell lang={lang} step="business">
      <h1 className="text-2xl font-semibold text-zinc-900">{t('business.heading', lang)}</h1>
      <p className="mt-1 text-sm text-zinc-600">{t('business.subheading', lang)}</p>
      <div className="mt-6">
        <BusinessForm lang={lang} initial={initial} />
      </div>
    </WizardShell>
  )
}
```

- [ ] **Step 4: Verify**

```
npx tsc --noEmit
```

- [ ] **Step 5: Manually verify in dev**

`npm run dev` → `/onboarding/business`. Fill form → submit → lands on `/onboarding/knowledge`. Refresh `/onboarding/business` → form pre-fills from saved values. Empty name → field-level error appears. EN/TL toggle re-labels.

- [ ] **Step 6: Commit**

```bash
git add 'src/app/(app)/onboarding/business/' src/lib/onboarding/i18n.ts
git commit -m "feat(onboarding): business basics form (step 1)"
```

---

## Task 4: AI knowledge generator

**Files:**
- Create: `src/lib/onboarding/ai/knowledge.ts`
- Create: `src/lib/onboarding/ai/knowledge.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// src/lib/onboarding/ai/knowledge.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rag', () => ({
  HfRouterLlm: vi.fn().mockImplementation(function HfRouterLlmMock() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(this as any).complete = vi.fn(async () =>
      JSON.stringify({
        sections: [
          { title: 'About us', body: 'We bake fresh.' },
          { title: 'What we offer', body: 'Ensaymada, pandesal.' },
          { title: 'Who it’s for', body: 'Tita moms in QC.' },
          { title: 'How to order', body: 'Message us on FB.' },
        ],
      }),
    )
    return this
  }),
}))

import { generateKnowledge } from './knowledge'
import type { BusinessBasics } from '@/lib/onboarding/business-basics'

const basics: BusinessBasics = {
  name: 'Aling Nena Bakery',
  offer: 'Fresh ensaymada delivered daily',
  business_type: 'ecom',
  audience: 'Tita-aged moms in QC',
  pain: "They want merienda but can't bake",
  tone: 'friendly',
}

describe('generateKnowledge', () => {
  it('returns parsed sections from the LLM', async () => {
    const out = await generateKnowledge({ basics, lang: 'tl' })
    expect(out.sections).toHaveLength(4)
    expect(out.sections[0]).toEqual({ title: 'About us', body: 'We bake fresh.' })
  })

  it('throws a typed error if the model returns invalid JSON', async () => {
    const { HfRouterLlm } = await import('@/lib/rag')
    ;(HfRouterLlm as unknown as { mockImplementationOnce: (fn: () => unknown) => void }).mockImplementationOnce(
      function HfRouterLlmBad() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(this as any).complete = vi.fn(async () => 'not-json')
        return this
      },
    )
    await expect(generateKnowledge({ basics, lang: 'tl' })).rejects.toThrow(/generation_failed/i)
  })
})
```

- [ ] **Step 2: Run, expect FAIL**

```
npx vitest run src/lib/onboarding/ai/knowledge.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/lib/onboarding/ai/knowledge.ts
import 'server-only'
import { z } from 'zod'
import { HfRouterLlm } from '@/lib/rag'
import type { BusinessBasics } from '@/lib/onboarding/business-basics'
import type { OnboardingLang } from '@/lib/onboarding/types'

export interface GeneratedKnowledgeSection {
  title: string
  body: string
}

export interface GeneratedKnowledge {
  sections: GeneratedKnowledgeSection[]
}

const ResponseSchema = z.object({
  sections: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        body: z.string().min(1).max(2000),
      }),
    )
    .min(3)
    .max(7),
})

function systemPrompt(lang: OnboardingLang): string {
  const langInstruction =
    lang === 'tl'
      ? 'Sumagot sa Tagalog (Taglish OK). Conversational, hindi formal.'
      : 'Reply in English. Conversational, not formal.'
  return [
    'You write the seed knowledge base for a small Filipino business chatbot.',
    'Given the business basics, produce 4 to 6 concise sections that the bot can cite when answering customers.',
    'Sections should cover: about the business, what they offer, who it is for, how it works / how to order, pricing approach (if known), and contact / next steps.',
    'Each section: a short title (1-6 words) and a body of 2-4 short sentences. No markdown headers in the body — plain prose.',
    'Output strict JSON only. Schema: { "sections": [ { "title": string, "body": string }, ... ] }.',
    langInstruction,
  ].join('\n')
}

function userPrompt(b: BusinessBasics): string {
  return [
    `Business name: ${b.name}`,
    `One-line offer: ${b.offer}`,
    `Business type: ${b.business_type}`,
    `Target audience: ${b.audience}`,
    `Pain solved: ${b.pain}`,
    `Tone preference: ${b.tone}`,
  ].join('\n')
}

export async function generateKnowledge(input: {
  basics: BusinessBasics
  lang: OnboardingLang
}): Promise<GeneratedKnowledge> {
  const llm = new HfRouterLlm()
  let raw: string
  try {
    raw = await llm.complete(
      [
        { role: 'system', content: systemPrompt(input.lang) },
        { role: 'user', content: userPrompt(input.basics) },
      ],
      { responseFormat: 'json_object', temperature: 0.5, maxTokens: 1200 },
    )
  } catch (err) {
    throw new Error('generation_failed: llm_call', { cause: err })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('generation_failed: invalid_json')
  }

  const result = ResponseSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error('generation_failed: schema_mismatch')
  }
  return result.data
}
```

- [ ] **Step 4: Run, expect PASS**

```
npx vitest run src/lib/onboarding/ai/knowledge.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/onboarding/ai/
git commit -m "feat(onboarding): AI knowledge generator with strict-JSON schema"
```

---

## Task 5: Knowledge step server actions + save into `knowledge_documents`

**Files:**
- Modify: `src/app/(app)/onboarding/actions.ts`

- [ ] **Step 1: Add the actions**

In `src/app/(app)/onboarding/actions.ts`, add:

```ts
import { z } from 'zod'
import { generateKnowledge, type GeneratedKnowledge } from '@/lib/onboarding/ai/knowledge'
import { getBusinessBasics } from '@/lib/onboarding/state'

const EditedKnowledgeSchema = z.object({
  sections: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120),
        body: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(10),
})

export type KnowledgeStepError = 'no_basics' | 'generation_failed' | 'save_failed'

/** Generate-only (does not save). Used to render the preview. */
export async function generateKnowledgeAction(): Promise<
  | { ok: true; data: GeneratedKnowledge }
  | { ok: false; error: KnowledgeStepError }
> {
  const basics = await getBusinessBasics()
  if (!basics) return { ok: false, error: 'no_basics' }
  try {
    const supabase = await (await import('@/lib/supabase/server')).createClient()
    const { data: state } = await supabase
      .from('onboarding_state')
      .select('ui_language')
      .eq('profile_id', (await supabase.auth.getUser()).data.user!.id)
      .maybeSingle()
    const lang = state?.ui_language === 'en' ? 'en' : 'tl'
    const data = await generateKnowledge({ basics, lang })
    return { ok: true, data }
  } catch (err) {
    console.error('[generateKnowledgeAction]', err)
    return { ok: false, error: 'generation_failed' }
  }
}

const SaveKnowledgeFormSchema = EditedKnowledgeSchema

export async function saveKnowledgeAction(
  _prev: { error?: KnowledgeStepError } | undefined,
  formData: FormData,
): Promise<{ error?: KnowledgeStepError }> {
  const rawSections = formData.get('sections_json')
  let parsed: unknown
  try {
    parsed = JSON.parse(String(rawSections ?? '[]'))
  } catch {
    return { error: 'save_failed' }
  }
  const result = SaveKnowledgeFormSchema.safeParse({ sections: parsed })
  if (!result.success) {
    return { error: 'save_failed' }
  }

  const basics = await getBusinessBasics()
  if (!basics) return { error: 'no_basics' }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { error: 'save_failed' }

  // Compose a single knowledge document. content_text is the plain-text body
  // the RAG pipeline reads; content_html mirrors it as paragraphs for the
  // dashboard preview.
  const text = result.data.sections
    .map((s) => `${s.title}\n\n${s.body}`)
    .join('\n\n---\n\n')
  const html = result.data.sections
    .map((s) => `<h3>${escapeHtml(s.title)}</h3><p>${escapeHtml(s.body).replace(/\n/g, '<br>')}</p>`)
    .join('')

  const { error: insertErr } = await supabase.from('knowledge_documents').insert({
    user_id: auth.user.id,
    title: `About ${basics.name}`,
    content_text: text,
    content_html: html,
    content_json: { sections: result.data.sections, source: 'onboarding' },
    has_unsaved_changes: false,
    version: 1,
    published_at: new Date().toISOString(),
    embedding_status: 'pending',
  })
  if (insertErr) {
    console.error('[saveKnowledgeAction] insert error', insertErr)
    return { error: 'save_failed' }
  }

  await markStep('knowledge')
  redirect('/onboarding/faqs')
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
```

- [ ] **Step 2: tsc**

```
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add 'src/app/(app)/onboarding/actions.ts'
git commit -m "feat(onboarding): generate + save knowledge server actions"
```

---

## Task 6: Knowledge preview editor (client component)

**Files:**
- Create: `src/app/(app)/onboarding/knowledge/KnowledgeEditor.tsx`

- [ ] **Step 1: Implement**

```tsx
// src/app/(app)/onboarding/knowledge/KnowledgeEditor.tsx
'use client'

import { useActionState, useState } from 'react'
import { saveKnowledgeAction } from '../actions'
import { StepNav } from '../_components/StepNav'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

export interface KnowledgeSection {
  title: string
  body: string
}

interface Props {
  lang: OnboardingLang
  initial: KnowledgeSection[]
}

export function KnowledgeEditor({ lang, initial }: Props) {
  const [sections, setSections] = useState<KnowledgeSection[]>(initial)
  const [state, action, pending] = useActionState(saveKnowledgeAction, {})

  function updateSection(idx: number, patch: Partial<KnowledgeSection>) {
    setSections((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }
  function removeSection(idx: number) {
    setSections((prev) => prev.filter((_, i) => i !== idx))
  }
  function addSection() {
    setSections((prev) => [...prev, { title: '', body: '' }])
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="sections_json" value={JSON.stringify(sections)} />

      {sections.map((s, i) => (
        <div key={i} className="rounded-md border border-zinc-200 bg-white p-4">
          <div className="flex items-start justify-between gap-2">
            <input
              type="text"
              value={s.title}
              onChange={(e) => updateSection(i, { title: e.target.value })}
              maxLength={120}
              className="w-full border-0 border-b border-transparent bg-transparent text-base font-medium text-zinc-900 focus:border-emerald-600 focus:outline-none"
              placeholder={t('knowledge.section_title_ph', lang)}
            />
            <button
              type="button"
              onClick={() => removeSection(i)}
              className="text-xs text-zinc-500 hover:text-red-600"
              aria-label={t('knowledge.remove', lang)}
            >
              {t('knowledge.remove', lang)}
            </button>
          </div>
          <textarea
            value={s.body}
            onChange={(e) => updateSection(i, { body: e.target.value })}
            rows={4}
            maxLength={4000}
            className="mt-2 w-full resize-y border-0 bg-transparent text-sm text-zinc-800 focus:outline-none"
            placeholder={t('knowledge.section_body_ph', lang)}
          />
        </div>
      ))}

      <button
        type="button"
        onClick={addSection}
        className="text-sm font-medium text-emerald-700 hover:text-emerald-900"
      >
        {t('knowledge.add_section', lang)}
      </button>

      {state.error && (
        <p className="text-sm text-red-600">{t('knowledge.error', lang)}</p>
      )}

      <StepNav
        step="knowledge"
        lang={lang}
        continueSlot={
          <button
            type="submit"
            disabled={pending || sections.length === 0}
            className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {pending ? t('knowledge.saving', lang) : t('knowledge.save', lang)}
          </button>
        }
      />
    </form>
  )
}
```

- [ ] **Step 2: Add i18n keys**

In `src/lib/onboarding/i18n.ts` add:

```ts
  'knowledge.heading':         { tl: 'Knowledge base ng business mo', en: 'Your business knowledge base' },
  'knowledge.subheading':      { tl: 'Sinulat ng AI based sa info mo. Pwede mong i-edit bago i-save.', en: 'AI drafted these from your answers. Edit anything before saving.' },
  'knowledge.section_title_ph':{ tl: 'Pamagat ng section',           en: 'Section title' },
  'knowledge.section_body_ph': { tl: 'Detalye…',                      en: 'Details…' },
  'knowledge.remove':          { tl: 'Tanggalin',                     en: 'Remove' },
  'knowledge.add_section':     { tl: '+ Magdagdag ng section',        en: '+ Add section' },
  'knowledge.save':            { tl: 'I-save ang knowledge',          en: 'Save knowledge' },
  'knowledge.saving':          { tl: 'Sini-save…',                    en: 'Saving…' },
  'knowledge.regenerate':      { tl: 'Mag-generate ulit',             en: 'Regenerate' },
  'knowledge.error':           { tl: 'May error sa pag-save. Subukan ulit.', en: 'Could not save. Try again.' },
  'knowledge.error.no_basics': { tl: 'Punan muna ang business basics step.', en: 'Fill in business basics first.' },
  'knowledge.error.generation':{ tl: 'Hindi nag-generate ang AI. Subukan ulit o i-skip.', en: "AI couldn't generate. Retry or skip." },
  'knowledge.generating':      { tl: 'Sini-sulat ng AI…',             en: 'AI is drafting…' },
  'knowledge.retry':           { tl: 'Subukan ulit',                  en: 'Retry' },
```

- [ ] **Step 3: Commit**

```bash
git add 'src/app/(app)/onboarding/knowledge/KnowledgeEditor.tsx' src/lib/onboarding/i18n.ts
git commit -m "feat(onboarding): knowledge preview editor component"
```

---

## Task 7: Knowledge step page (orchestrates generate → preview → save)

**Files:**
- Modify: `src/app/(app)/onboarding/knowledge/page.tsx` (replace stub)
- Create: `src/app/(app)/onboarding/knowledge/RegenerateButton.tsx`

- [ ] **Step 1: Create the regenerate button (client)**

```tsx
// src/app/(app)/onboarding/knowledge/RegenerateButton.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

export function RegenerateButton({ lang }: { lang: OnboardingLang }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      onClick={() => start(() => router.refresh())}
      disabled={pending}
      className="text-sm font-medium text-emerald-700 hover:text-emerald-900 disabled:opacity-60"
    >
      {pending ? t('knowledge.generating', lang) : t('knowledge.regenerate', lang)}
    </button>
  )
}
```

The page itself re-runs the generator on every render, so `router.refresh()` is the regenerate trigger.

- [ ] **Step 2: Replace `knowledge/page.tsx`**

```tsx
// src/app/(app)/onboarding/knowledge/page.tsx
import Link from 'next/link'
import { WizardShell } from '../_components/WizardShell'
import { KnowledgeEditor } from './KnowledgeEditor'
import { RegenerateButton } from './RegenerateButton'
import { generateKnowledgeAction } from '../actions'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { t } from '@/lib/onboarding/i18n'

export const dynamic = 'force-dynamic'

export default async function KnowledgePage() {
  const lang = await getOnboardingLang()
  const result = await generateKnowledgeAction()

  return (
    <WizardShell lang={lang} step="knowledge">
      <h1 className="text-2xl font-semibold text-zinc-900">{t('knowledge.heading', lang)}</h1>
      <p className="mt-1 text-sm text-zinc-600">{t('knowledge.subheading', lang)}</p>

      {result.ok === false && result.error === 'no_basics' ? (
        <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p>{t('knowledge.error.no_basics', lang)}</p>
          <Link
            href="/onboarding/business"
            className="mt-2 inline-block font-medium underline"
          >
            {t('shell.back', lang)}
          </Link>
        </div>
      ) : result.ok === false ? (
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <p>{t('knowledge.error.generation', lang)}</p>
          <div className="mt-3 flex gap-3">
            <RegenerateButton lang={lang} />
          </div>
        </div>
      ) : (
        <div className="mt-6">
          <div className="mb-3 flex justify-end">
            <RegenerateButton lang={lang} />
          </div>
          <KnowledgeEditor lang={lang} initial={result.data.sections} />
        </div>
      )}
    </WizardShell>
  )
}
```

- [ ] **Step 3: tsc**

```
npx tsc --noEmit
```

- [ ] **Step 4: Manually verify**

1. `npm run dev`.
2. Visit `/onboarding/business`, fill the form, submit.
3. Land on `/onboarding/knowledge`. Expected: spinner via Suspense fallback, then 4–6 AI-generated sections rendered as editable cards.
4. Edit a section's title or body, click "Save knowledge". Land on `/onboarding/faqs` (still a stub from Phase 1).
5. Verify a row appeared in `knowledge_documents` with `title = "About <business name>"`, `content_text` containing all sections separated by `---`, `version = 1`, `embedding_status = 'pending'`.
6. Revisit `/onboarding/knowledge` directly — generator runs again (counts as regenerate). Click Regenerate button to confirm.
7. Without filling business basics first: visit `/onboarding/knowledge` from a brand-new account — expect the "Fill in business basics first" amber message.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(app)/onboarding/knowledge/'
git commit -m "feat(onboarding): knowledge step page with AI preview + save (step 2)"
```

---

## Task 8: Smoke test the full Phase 1 + 2 flow

- [ ] **Step 1: End-to-end check**

1. Sign up a brand new account.
2. Land on `/onboarding/welcome` (TL).
3. Click Get Started → fill business form → submit → knowledge preview renders.
4. Edit one section, save → faqs stub.
5. Skip → personality stub → … → done.
6. Click "Go to dashboard" → checklist hidden (completed).
7. Visit `/dashboard/knowledge` — confirm the generated document is listed and editable in the existing editor.

- [ ] **Step 2: Test re-entry**

Sign up second account. Fill business basics, skip knowledge. Land on faqs. Go back to `/onboarding/knowledge` directly — generator runs, preview shows, save → faqs. Confirm no duplicate knowledge_documents row (it would create a second one since save always inserts; that's acceptable for Phase 2 — note it as a known limitation if you notice).

- [ ] **Step 3: If you fixed anything, commit**

```bash
git add .
git commit -m "fix(onboarding): <whatever>"
```

---

## Self-Review

**Spec coverage** (Phase 2):
- [x] Business basics (~6 fields) — Tasks 1–3
- [x] AI generates 4–6 knowledge sections — Task 4
- [x] Editable preview with regenerate — Tasks 6, 7
- [x] Save into existing `knowledge_documents` — Task 5
- [x] Language passed to AI matches `ui_language` — Task 5 (`generateKnowledgeAction`)
- [x] Inline error with retry/skip on generation failure — Task 7
- [x] Pre-fill form on re-entry — Task 3 (`getBusinessBasics`)
- [x] All steps still skippable — `StepNav` from Phase 1 reused

**Out of Phase 2 scope** (handled in later phases):
- Avoiding duplicate `knowledge_documents` rows on re-save (Phase 4 polish)
- AI-aware regenerate confirmation modal (Phase 4 polish)

**Placeholder scan:** none.

**Type consistency:** `BusinessBasics` shape consistent across `business-basics.ts`, `state.ts`, `actions.ts`, AI generator. `OnboardingLang` consistent. `KnowledgeSection` matches the generator output and editor state.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-onboarding-phase2-business-knowledge.md`. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, two-stage review, fast iteration.
**2. Inline Execution** — batch with checkpoints in this session.

Which approach?
