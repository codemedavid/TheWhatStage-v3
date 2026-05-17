# Onboarding Wizard — Phase 3: FAQs + Personality

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Replace the Phase 1 stub pages for `faqs` and `personality` with the real steps. FAQs are a hybrid checklist (AI proposes 5–8, user (un)checks + adds custom). Personality is a vibe preset + 3 short prompts; AI auto-saves the generated `chatbot_configs` row without a preview gate.

**Architecture:** Two new AI generators in `src/lib/onboarding/ai/`. FAQs save into the existing `knowledge_faqs` table (one row per accepted item). Personality writes directly into `chatbot_configs` (`name`, `persona`, `do_rules`, `dont_rules`, `fallback_message`). Both generators consume the saved `business_basics` and `ui_language`. Auto-save for personality matches the spec's "Z" review-gate decision.

**Tech Stack:** Next.js App Router · TypeScript · Supabase · Vitest · Zod · `HfRouterLlm`.

**Related spec:** `docs/superpowers/specs/2026-05-15-onboarding-wizard-design.md`
**Builds on:** Phase 1 + Phase 2 plans (same branch).

---

## Task 1: AI FAQ generator

**Files:**
- Create: `src/lib/onboarding/ai/faqs.ts`
- Create: `src/lib/onboarding/ai/faqs.test.ts`

- [ ] **Step 1: Failing tests**

```ts
// src/lib/onboarding/ai/faqs.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rag', () => ({
  HfRouterLlm: vi.fn().mockImplementation(function HfRouterLlmMock(this: { complete: ReturnType<typeof vi.fn> }) {
    this.complete = vi.fn(async () =>
      JSON.stringify({
        suggestions: [
          { question: 'Magkano?', answer: 'PHP 250 each, free shipping in QC.' },
          { question: 'Anong oras kayo bukas?', answer: '8am-6pm Mon-Sat.' },
          { question: 'Pwede COD?', answer: 'Yes, cash on delivery in QC.' },
          { question: 'Saan kayo nag-deliver?', answer: 'QC, Marikina, Pasig.' },
          { question: 'Paano mag-order?', answer: 'Message us here on Messenger.' },
        ],
      }),
    )
    return this
  }),
}))

import { generateFaqs } from './faqs'
import type { BusinessBasics } from '@/lib/onboarding/business-basics'

const basics: BusinessBasics = {
  name: 'Aling Nena Bakery',
  offer: 'Fresh ensaymada delivered daily',
  business_type: 'ecom',
  audience: 'Tita-aged moms in QC',
  pain: "They want merienda but can't bake",
  tone: 'friendly',
}

describe('generateFaqs', () => {
  it('returns the suggested FAQ list', async () => {
    const out = await generateFaqs({ basics, lang: 'tl' })
    expect(out.suggestions).toHaveLength(5)
    expect(out.suggestions[0]).toEqual({ question: 'Magkano?', answer: 'PHP 250 each, free shipping in QC.' })
  })

  it('throws generation_failed on bad JSON', async () => {
    const { HfRouterLlm } = await import('@/lib/rag')
    ;(HfRouterLlm as unknown as { mockImplementationOnce: (fn: () => unknown) => void }).mockImplementationOnce(
      function Bad(this: { complete: ReturnType<typeof vi.fn> }) {
        this.complete = vi.fn(async () => 'nope')
        return this
      },
    )
    await expect(generateFaqs({ basics, lang: 'tl' })).rejects.toThrow(/generation_failed/i)
  })
})
```

- [ ] **Step 2: Run → expect FAIL**

```
npx vitest run src/lib/onboarding/ai/faqs.test.ts
```

- [ ] **Step 3: Implement**

```ts
// src/lib/onboarding/ai/faqs.ts
import 'server-only'
import { z } from 'zod'
import { HfRouterLlm } from '@/lib/rag'
import type { BusinessBasics } from '@/lib/onboarding/business-basics'
import type { OnboardingLang } from '@/lib/onboarding/types'

export interface GeneratedFaq {
  question: string
  answer: string
}

export interface GeneratedFaqs {
  suggestions: GeneratedFaq[]
}

const ResponseSchema = z.object({
  suggestions: z
    .array(
      z.object({
        question: z.string().min(1).max(300),
        answer: z.string().min(1).max(2000),
      }),
    )
    .min(3)
    .max(10),
})

function systemPrompt(lang: OnboardingLang): string {
  const langLine =
    lang === 'tl'
      ? 'Isulat ang lahat sa Tagalog/Taglish — kung paano nagtatanong ang totoong customers sa Messenger (e.g. "magkano po?", "available pa ba?").'
      : 'Write all FAQs in conversational English — match how real customers ask on Messenger.'
  return [
    'You generate the seed FAQ list for a small Filipino business chatbot.',
    'Given the business basics, produce 5 to 8 high-value FAQs that real customers actually ask before they buy or book.',
    'Cover (when applicable): pricing, availability/stock, delivery/service area, hours, how to order, payment options, returns/guarantees, location.',
    'Keep questions short (≤ 15 words). Answers concrete and specific — invent reasonable defaults if the business basics do not specify (e.g., Mon-Sat 9am-6pm, COD + GCash, free delivery within QC).',
    'Output strict JSON only. Schema: { "suggestions": [ { "question": string, "answer": string }, ... ] }.',
    langLine,
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

export async function generateFaqs(input: {
  basics: BusinessBasics
  lang: OnboardingLang
}): Promise<GeneratedFaqs> {
  const llm = new HfRouterLlm()
  let raw: string
  try {
    raw = await llm.complete(
      [
        { role: 'system', content: systemPrompt(input.lang) },
        { role: 'user', content: userPrompt(input.basics) },
      ],
      { responseFormat: 'json_object', temperature: 0.6, maxTokens: 1200 },
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

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/onboarding/ai/faqs.ts src/lib/onboarding/ai/faqs.test.ts
git commit -m "feat(onboarding): AI FAQ generator"
```

---

## Task 2: FAQ step server actions

**Files:**
- Modify: `src/app/(app)/onboarding/actions.ts`

- [ ] **Step 1: Add the actions**

Top-of-file additional imports (consolidate with existing):
```ts
import { generateFaqs, type GeneratedFaqs } from '@/lib/onboarding/ai/faqs'
```

Append to `actions.ts`:

```ts
export type FaqsStepError = 'no_basics' | 'generation_failed' | 'save_failed'

export async function generateFaqsAction(): Promise<
  | { ok: true; data: GeneratedFaqs }
  | { ok: false; error: FaqsStepError }
> {
  const basics = await getBusinessBasics()
  if (!basics) return { ok: false, error: 'no_basics' }
  try {
    const { createClient } = await import('@/lib/supabase/server')
    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return { ok: false, error: 'generation_failed' }
    const { data: state } = await supabase
      .from('onboarding_state')
      .select('ui_language')
      .eq('profile_id', auth.user.id)
      .maybeSingle()
    const lang = state?.ui_language === 'en' ? 'en' : 'tl'
    const data = await generateFaqs({ basics, lang })
    return { ok: true, data }
  } catch (err) {
    console.error('[generateFaqsAction]', err)
    return { ok: false, error: 'generation_failed' }
  }
}

const FaqsPayloadSchema = z.object({
  items: z
    .array(
      z.object({
        question: z.string().trim().min(1).max(300),
        answer: z.string().trim().min(1).max(4000),
      }),
    )
    .max(20),
})

export async function saveFaqsAction(
  _prev: { error?: FaqsStepError } | undefined,
  formData: FormData,
): Promise<{ error?: FaqsStepError }> {
  const raw = formData.get('items_json')
  let parsed: unknown
  try {
    parsed = JSON.parse(String(raw ?? '[]'))
  } catch {
    return { error: 'save_failed' }
  }
  const result = FaqsPayloadSchema.safeParse({ items: parsed })
  if (!result.success) return { error: 'save_failed' }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { error: 'save_failed' }

  if (result.data.items.length > 0) {
    const rows = result.data.items.map((it, i) => ({
      user_id: auth.user!.id,
      question: it.question,
      answer: it.answer,
      position: i,
      is_published: true,
      version: 1,
      embedding_status: 'pending',
    }))
    const { error: insertErr } = await supabase.from('knowledge_faqs').insert(rows)
    if (insertErr) {
      console.error('[saveFaqsAction] insert', insertErr)
      return { error: 'save_failed' }
    }
  }

  await markStep('faqs')
  redirect('/onboarding/personality')
}
```

- [ ] **Step 2: tsc clean**

- [ ] **Step 3: Commit**

```bash
git add 'src/app/(app)/onboarding/actions.ts'
git commit -m "feat(onboarding): generate + save FAQ server actions"
```

---

## Task 3: FAQ checklist page + component + i18n

**Files:**
- Create: `src/app/(app)/onboarding/faqs/FaqChecklist.tsx`
- Modify: `src/app/(app)/onboarding/faqs/page.tsx`
- Modify: `src/lib/onboarding/i18n.ts`

- [ ] **Step 1: i18n keys (append inside `dict = { ... } as const`)**

```ts
  'faqs.heading':         { tl: 'Mga FAQ ng business mo', en: 'Your FAQs' },
  'faqs.subheading':      { tl: 'Pinili ng AI base sa info mo. Alisin ang ayaw mo at magdagdag ng sarili.', en: "AI picked these from your info. Uncheck what you don't want and add your own." },
  'faqs.suggestion_label':{ tl: 'Mga suhestiyon',         en: 'AI suggestions' },
  'faqs.custom_label':    { tl: 'Idagdag mo pa',          en: 'Add your own' },
  'faqs.add':             { tl: '+ Magdagdag ng FAQ',     en: '+ Add FAQ' },
  'faqs.question_ph':     { tl: 'Tanong',                 en: 'Question' },
  'faqs.answer_ph':       { tl: 'Sagot',                  en: 'Answer' },
  'faqs.remove':          { tl: 'Tanggalin',              en: 'Remove' },
  'faqs.save':            { tl: 'I-save ang mga FAQ',     en: 'Save FAQs' },
  'faqs.saving':          { tl: 'Sini-save…',             en: 'Saving…' },
  'faqs.regenerate':      { tl: 'Mag-generate ulit',      en: 'Regenerate' },
  'faqs.generating':      { tl: 'Sini-sulat ng AI…',      en: 'AI is drafting…' },
  'faqs.error':           { tl: 'May error. Subukan ulit.', en: 'Could not save. Try again.' },
  'faqs.error.no_basics': { tl: 'Punan muna ang business basics step.', en: 'Fill in business basics first.' },
  'faqs.error.generation':{ tl: 'Hindi nag-generate ang AI. Subukan ulit o i-skip.', en: "AI couldn't generate. Retry or skip." },
```

- [ ] **Step 2: Create `FaqChecklist.tsx`**

```tsx
'use client'

import { useActionState, useState } from 'react'
import { saveFaqsAction } from '../actions'
import { StepNav } from '../_components/StepNav'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

interface FaqItem {
  question: string
  answer: string
}

interface Props {
  lang: OnboardingLang
  suggestions: FaqItem[]
}

export function FaqChecklist({ lang, suggestions }: Props) {
  const [checked, setChecked] = useState<boolean[]>(() => suggestions.map(() => true))
  const [editable, setEditable] = useState<FaqItem[]>(suggestions)
  const [custom, setCustom] = useState<FaqItem[]>([])
  const [state, action, pending] = useActionState(saveFaqsAction, {})

  const selectedSuggestions = editable.filter((_, i) => checked[i])
  const items = [...selectedSuggestions, ...custom].filter(
    (it) => it.question.trim() && it.answer.trim(),
  )

  function patchSuggestion(idx: number, patch: Partial<FaqItem>) {
    setEditable((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }
  function patchCustom(idx: number, patch: Partial<FaqItem>) {
    setCustom((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }
  function removeCustom(idx: number) {
    setCustom((prev) => prev.filter((_, i) => i !== idx))
  }

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="items_json" value={JSON.stringify(items)} />

      <section>
        <h2 className="text-sm font-medium text-zinc-700">{t('faqs.suggestion_label', lang)}</h2>
        <ul className="mt-2 space-y-2">
          {editable.map((item, i) => (
            <li key={i} className="rounded-md border border-zinc-200 bg-white p-3">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={checked[i]}
                  onChange={(e) =>
                    setChecked((prev) => prev.map((c, j) => (j === i ? e.target.checked : c)))
                  }
                  className="mt-1 h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-600"
                />
                <div className="flex-1 space-y-1">
                  <input
                    type="text"
                    value={item.question}
                    onChange={(e) => patchSuggestion(i, { question: e.target.value })}
                    maxLength={300}
                    disabled={!checked[i]}
                    className="w-full border-0 bg-transparent text-sm font-medium text-zinc-900 focus:outline-none disabled:text-zinc-400"
                  />
                  <textarea
                    value={item.answer}
                    onChange={(e) => patchSuggestion(i, { answer: e.target.value })}
                    rows={2}
                    maxLength={4000}
                    disabled={!checked[i]}
                    className="w-full resize-y border-0 bg-transparent text-sm text-zinc-700 focus:outline-none disabled:text-zinc-400"
                  />
                </div>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-medium text-zinc-700">{t('faqs.custom_label', lang)}</h2>
        <ul className="mt-2 space-y-2">
          {custom.map((item, i) => (
            <li key={i} className="rounded-md border border-zinc-200 bg-white p-3">
              <div className="flex items-start justify-between gap-2">
                <input
                  type="text"
                  value={item.question}
                  onChange={(e) => patchCustom(i, { question: e.target.value })}
                  maxLength={300}
                  placeholder={t('faqs.question_ph', lang)}
                  className="w-full border-0 bg-transparent text-sm font-medium text-zinc-900 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeCustom(i)}
                  className="text-xs text-zinc-500 hover:text-red-600"
                >
                  {t('faqs.remove', lang)}
                </button>
              </div>
              <textarea
                value={item.answer}
                onChange={(e) => patchCustom(i, { answer: e.target.value })}
                rows={2}
                maxLength={4000}
                placeholder={t('faqs.answer_ph', lang)}
                className="mt-1 w-full resize-y border-0 bg-transparent text-sm text-zinc-700 focus:outline-none"
              />
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setCustom((prev) => [...prev, { question: '', answer: '' }])}
          className="mt-2 text-sm font-medium text-emerald-700 hover:text-emerald-900"
        >
          {t('faqs.add', lang)}
        </button>
      </section>

      {state.error && <p className="text-sm text-red-600">{t('faqs.error', lang)}</p>}

      <StepNav
        step="faqs"
        lang={lang}
        continueSlot={
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {pending ? t('faqs.saving', lang) : t('faqs.save', lang)}
          </button>
        }
      />
    </form>
  )
}
```

- [ ] **Step 3: Replace `faqs/page.tsx`**

```tsx
import Link from 'next/link'
import { WizardShell } from '../_components/WizardShell'
import { FaqChecklist } from './FaqChecklist'
import { RegenerateButton } from '../knowledge/RegenerateButton'
import { generateFaqsAction } from '../actions'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { t } from '@/lib/onboarding/i18n'

export const dynamic = 'force-dynamic'

export default async function FaqsPage() {
  const lang = await getOnboardingLang()
  const result = await generateFaqsAction()

  return (
    <WizardShell lang={lang} step="faqs">
      <h1 className="text-2xl font-semibold text-zinc-900">{t('faqs.heading', lang)}</h1>
      <p className="mt-1 text-sm text-zinc-600">{t('faqs.subheading', lang)}</p>

      {result.ok === false && result.error === 'no_basics' ? (
        <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p>{t('faqs.error.no_basics', lang)}</p>
          <Link href="/onboarding/business" className="mt-2 inline-block font-medium underline">
            {t('shell.back', lang)}
          </Link>
        </div>
      ) : result.ok === false ? (
        <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          <p>{t('faqs.error.generation', lang)}</p>
          <div className="mt-3"><RegenerateButton lang={lang} /></div>
        </div>
      ) : (
        <div className="mt-6">
          <div className="mb-3 flex justify-end"><RegenerateButton lang={lang} /></div>
          <FaqChecklist lang={lang} suggestions={result.data.suggestions} />
        </div>
      )}
    </WizardShell>
  )
}
```

Reusing the Phase 2 `RegenerateButton` — it just calls `router.refresh()` so it works for any AI step. Its label `knowledge.regenerate` reads "Regenerate" in both langs; that's fine. If you want a step-specific label later, parameterize it then. For Phase 3 keep the reuse.

Actually — the `RegenerateButton` uses `t('knowledge.generating', lang)` and `t('knowledge.regenerate', lang)`. Those strings work for FAQs too (no domain noun in them). Reuse as-is.

- [ ] **Step 4: tsc clean**

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(app)/onboarding/faqs/' src/lib/onboarding/i18n.ts
git commit -m "feat(onboarding): FAQs hybrid checklist (step 3)"
```

---

## Task 4: AI personality generator

**Files:**
- Create: `src/lib/onboarding/ai/personality.ts`
- Create: `src/lib/onboarding/ai/personality.test.ts`

The output mirrors the existing `chatbot_configs` row shape: `name`, `persona`, `do_rules[]`, `dont_rules[]`, `fallback_message`.

- [ ] **Step 1: Tests**

```ts
// src/lib/onboarding/ai/personality.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/rag', () => ({
  HfRouterLlm: vi.fn().mockImplementation(function HfRouterLlmMock(this: { complete: ReturnType<typeof vi.fn> }) {
    this.complete = vi.fn(async () =>
      JSON.stringify({
        name: 'Nena',
        persona: 'Friendly tita bakery helper who speaks Taglish and is genuinely warm.',
        do_rules: ['Greet with "Hi po!"', 'Confirm address before quoting delivery.'],
        dont_rules: ['Never argue about prices.', "Never promise next-day delivery outside QC."],
        fallback_message: 'Pasensya po, ipapasa ko sa owner para sa exact info.',
      }),
    )
    return this
  }),
}))

import { generatePersonality } from './personality'
import type { BusinessBasics } from '@/lib/onboarding/business-basics'

const basics: BusinessBasics = {
  name: 'Aling Nena Bakery',
  offer: 'Fresh ensaymada delivered daily',
  business_type: 'ecom',
  audience: 'Tita moms in QC',
  pain: "They want merienda but can't bake",
  tone: 'friendly',
}

describe('generatePersonality', () => {
  it('returns name, persona, rules, fallback', async () => {
    const out = await generatePersonality({ basics, seeds: {}, lang: 'tl' })
    expect(out.name).toBe('Nena')
    expect(out.do_rules.length).toBeGreaterThan(0)
    expect(out.dont_rules.length).toBeGreaterThan(0)
    expect(out.fallback_message).toMatch(/owner/i)
  })

  it('throws generation_failed on bad JSON', async () => {
    const { HfRouterLlm } = await import('@/lib/rag')
    ;(HfRouterLlm as unknown as { mockImplementationOnce: (fn: () => unknown) => void }).mockImplementationOnce(
      function Bad(this: { complete: ReturnType<typeof vi.fn> }) {
        this.complete = vi.fn(async () => 'nope')
        return this
      },
    )
    await expect(generatePersonality({ basics, seeds: {}, lang: 'tl' })).rejects.toThrow(/generation_failed/i)
  })
})
```

- [ ] **Step 2: Implement**

```ts
// src/lib/onboarding/ai/personality.ts
import 'server-only'
import { z } from 'zod'
import { HfRouterLlm } from '@/lib/rag'
import type { BusinessBasics, TonePreset } from '@/lib/onboarding/business-basics'
import type { OnboardingLang } from '@/lib/onboarding/types'

export const VIBE_PRESETS = ['friendly_kuya_ate', 'professional_consultant', 'hype_closer', 'calm_expert'] as const
export type VibePreset = (typeof VIBE_PRESETS)[number]

export interface PersonalitySeeds {
  vibe_preset?: VibePreset
  greet?: string
  must_use?: string
  must_not?: string
}

export interface GeneratedPersonality {
  name: string
  persona: string
  do_rules: string[]
  dont_rules: string[]
  fallback_message: string
}

const ResponseSchema = z.object({
  name: z.string().trim().min(1).max(60),
  persona: z.string().trim().min(20).max(800),
  do_rules: z.array(z.string().trim().min(1).max(200)).min(2).max(8),
  dont_rules: z.array(z.string().trim().min(1).max(200)).min(2).max(8),
  fallback_message: z.string().trim().min(10).max(300),
})

function vibeLine(v: VibePreset | undefined, tone: TonePreset): string {
  if (!v) return `Tone preset: ${tone}.`
  const map: Record<VibePreset, string> = {
    friendly_kuya_ate: 'Vibe: warm Pinoy kuya/ate energy — uses "po/opo", calls customer "ka", playful.',
    professional_consultant: 'Vibe: calm professional consultant — concise, no slang, never aggressive.',
    hype_closer: 'Vibe: hype closer — confident, energetic, uses urgency without being scammy.',
    calm_expert: 'Vibe: calm expert — explains patiently, technical when needed, never condescending.',
  }
  return map[v]
}

function systemPrompt(lang: OnboardingLang, seeds: PersonalitySeeds, tone: TonePreset): string {
  const langLine =
    lang === 'tl'
      ? 'Sumagot sa Tagalog/Taglish ang `persona`, `do_rules`, `dont_rules`, at `fallback_message`. Yung `name` ay isang short Filipino-friendly name.'
      : 'Reply in English for persona, do_rules, dont_rules, and fallback_message. The name should be short and human (e.g., "Nena", "Kuya Jay").'
  return [
    'You design the personality config for a small Filipino business chatbot.',
    'Output strict JSON with these fields: { "name": string, "persona": string (1-2 paragraphs), "do_rules": string[], "dont_rules": string[], "fallback_message": string }.',
    'Rules should be concrete and behavioral — e.g., "Always confirm address before quoting delivery" or "Never argue about pricing — escalate to owner."',
    'fallback_message is the exact line the bot uses when it does not know — keep it warm and offer to ask the owner.',
    vibeLine(seeds.vibe_preset, tone),
    seeds.greet ? `User-provided opening line guidance: ${seeds.greet}` : '',
    seeds.must_use ? `Must use: ${seeds.must_use}` : '',
    seeds.must_not ? `Must not: ${seeds.must_not}` : '',
    langLine,
  ]
    .filter(Boolean)
    .join('\n')
}

function userPrompt(b: BusinessBasics): string {
  return [
    `Business name: ${b.name}`,
    `Offer: ${b.offer}`,
    `Type: ${b.business_type}`,
    `Audience: ${b.audience}`,
    `Pain solved: ${b.pain}`,
  ].join('\n')
}

export async function generatePersonality(input: {
  basics: BusinessBasics
  seeds: PersonalitySeeds
  lang: OnboardingLang
}): Promise<GeneratedPersonality> {
  const llm = new HfRouterLlm()
  let raw: string
  try {
    raw = await llm.complete(
      [
        { role: 'system', content: systemPrompt(input.lang, input.seeds, input.basics.tone) },
        { role: 'user', content: userPrompt(input.basics) },
      ],
      { responseFormat: 'json_object', temperature: 0.6, maxTokens: 900 },
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
  const r = ResponseSchema.safeParse(parsed)
  if (!r.success) throw new Error('generation_failed: schema_mismatch')
  return r.data
}
```

- [ ] **Step 3: PASS**

- [ ] **Step 4: Commit**

```bash
git add src/lib/onboarding/ai/personality.ts src/lib/onboarding/ai/personality.test.ts
git commit -m "feat(onboarding): AI personality generator"
```

---

## Task 5: Personality step server action

**Files:**
- Modify: `src/app/(app)/onboarding/actions.ts`

- [ ] **Step 1: Add the action**

Imports (consolidate):
```ts
import { generatePersonality, VIBE_PRESETS, type VibePreset } from '@/lib/onboarding/ai/personality'
```

Append:

```ts
const PersonalitySeedsSchema = z.object({
  vibe_preset: z.enum(VIBE_PRESETS).optional(),
  greet: z.string().trim().max(300).optional(),
  must_use: z.string().trim().max(300).optional(),
  must_not: z.string().trim().max(300).optional(),
})

export type PersonalityStepError = 'no_basics' | 'generation_failed' | 'save_failed'
export type PersonalityFormState = { error?: PersonalityStepError }

/**
 * Single-shot: parse seeds, store them, call AI, upsert into chatbot_configs,
 * mark step, redirect. No preview gate (per spec's hybrid review-gate "Z").
 */
export async function savePersonalityAction(
  _prev: PersonalityFormState | undefined,
  formData: FormData,
): Promise<PersonalityFormState> {
  const seedsParsed = PersonalitySeedsSchema.safeParse({
    vibe_preset: (formData.get('vibe_preset') || undefined) as VibePreset | undefined,
    greet: formData.get('greet') || undefined,
    must_use: formData.get('must_use') || undefined,
    must_not: formData.get('must_not') || undefined,
  })
  if (!seedsParsed.success) return { error: 'save_failed' }

  const basics = await getBusinessBasics()
  if (!basics) return { error: 'no_basics' }

  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return { error: 'save_failed' }

  const { data: state } = await supabase
    .from('onboarding_state')
    .select('ui_language')
    .eq('profile_id', auth.user.id)
    .maybeSingle()
  const lang = state?.ui_language === 'en' ? 'en' : 'tl'

  let generated
  try {
    generated = await generatePersonality({
      basics,
      seeds: seedsParsed.data,
      lang,
    })
  } catch (err) {
    console.error('[savePersonalityAction] generate', err)
    return { error: 'generation_failed' }
  }

  // Persist seeds for re-entry pre-fill + audit.
  await supabase
    .from('onboarding_state')
    .update({ personality_seeds: seedsParsed.data })
    .eq('profile_id', auth.user.id)

  // Upsert chatbot_configs.
  const { error: upsertErr } = await supabase.from('chatbot_configs').upsert(
    {
      user_id: auth.user.id,
      name: generated.name,
      persona: generated.persona,
      do_rules: generated.do_rules,
      dont_rules: generated.dont_rules,
      fallback_message: generated.fallback_message,
      personality_source: 'custom',
    },
    { onConflict: 'user_id' },
  )
  if (upsertErr) {
    console.error('[savePersonalityAction] upsert', upsertErr)
    return { error: 'save_failed' }
  }

  await markStep('personality')
  redirect('/onboarding/goal')
}
```

- [ ] **Step 2: tsc clean. Commit.**

```bash
git add 'src/app/(app)/onboarding/actions.ts'
git commit -m "feat(onboarding): save personality server action"
```

---

## Task 6: Personality form + page + i18n

**Files:**
- Create: `src/app/(app)/onboarding/personality/PersonalityForm.tsx`
- Modify: `src/app/(app)/onboarding/personality/page.tsx`
- Modify: `src/lib/onboarding/i18n.ts`

- [ ] **Step 1: i18n keys**

```ts
  'personality.heading':       { tl: 'Personality ng bot mo',           en: "Your bot's personality" },
  'personality.subheading':    { tl: 'Pumili ng vibe at magbigay ng kaunting guidance — i-fill ng AI ang iba.', en: 'Pick a vibe and add a little guidance — AI fills in the rest.' },
  'personality.vibe.label':    { tl: 'Anong vibe ng bot mo?',           en: 'What vibe should the bot have?' },
  'personality.vibe.friendly_kuya_ate':       { tl: 'Friendly Kuya/Ate', en: 'Friendly Kuya/Ate' },
  'personality.vibe.professional_consultant': { tl: 'Professional',      en: 'Professional consultant' },
  'personality.vibe.hype_closer':             { tl: 'Hype Closer',       en: 'Hype closer' },
  'personality.vibe.calm_expert':             { tl: 'Calm Expert',       en: 'Calm expert' },
  'personality.greet.label':   { tl: 'Paano dapat bumati ang bot?',     en: 'How should the bot greet?' },
  'personality.greet.ph':      { tl: 'Hal. "Hi po! Welcome sa Aling Nena Bakery."', en: 'e.g. "Hi po! Welcome to Aling Nena Bakery."' },
  'personality.must_use.label':{ tl: 'Mga salita / phrases na dapat gamitin', en: 'Words or phrases it must always use' },
  'personality.must_use.ph':   { tl: 'Hal. "Sariwang luto araw-araw"',  en: 'e.g. "Baked fresh daily"' },
  'personality.must_not.label':{ tl: 'Mga bawal na sabihin',            en: 'What it must never do' },
  'personality.must_not.ph':   { tl: 'Hal. "Huwag mag-promise ng next-day delivery"', en: "e.g. \"Don't promise next-day delivery\"" },
  'personality.save':          { tl: 'I-save ang personality',          en: 'Save personality' },
  'personality.saving':        { tl: 'Sini-generate ng AI…',            en: 'AI is drafting…' },
  'personality.error':         { tl: 'May error. Subukan ulit o i-skip.', en: 'Could not save. Retry or skip.' },
  'personality.error.no_basics': { tl: 'Punan muna ang business basics step.', en: 'Fill in business basics first.' },
```

- [ ] **Step 2: Create `PersonalityForm.tsx`**

```tsx
'use client'

import { useActionState } from 'react'
import { savePersonalityAction, type PersonalityFormState } from '../actions'
import { VIBE_PRESETS, type VibePreset } from '@/lib/onboarding/ai/personality'
import { StepNav } from '../_components/StepNav'
import { t, type DictKey } from '@/lib/onboarding/i18n'
import type { OnboardingLang } from '@/lib/onboarding/types'

interface Seeds {
  vibe_preset?: VibePreset
  greet?: string
  must_use?: string
  must_not?: string
}

interface Props {
  lang: OnboardingLang
  initial: Seeds | null
}

const VIBE_KEY: Record<VibePreset, DictKey> = {
  friendly_kuya_ate: 'personality.vibe.friendly_kuya_ate',
  professional_consultant: 'personality.vibe.professional_consultant',
  hype_closer: 'personality.vibe.hype_closer',
  calm_expert: 'personality.vibe.calm_expert',
}

export function PersonalityForm({ lang, initial }: Props) {
  const [state, action, pending] = useActionState<PersonalityFormState, FormData>(
    savePersonalityAction,
    {},
  )

  return (
    <form action={action} className="space-y-5">
      <fieldset>
        <legend className="block text-sm font-medium text-zinc-900">
          {t('personality.vibe.label', lang)}
        </legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {VIBE_PRESETS.map((vibe) => (
            <label
              key={vibe}
              className="flex cursor-pointer items-center justify-center rounded-md border border-zinc-300 bg-white p-3 text-sm text-zinc-900 hover:bg-zinc-50 has-[:checked]:border-emerald-600 has-[:checked]:bg-emerald-50 has-[:checked]:text-emerald-900"
            >
              <input
                type="radio"
                name="vibe_preset"
                value={vibe}
                defaultChecked={(initial?.vibe_preset ?? 'friendly_kuya_ate') === vibe}
                className="sr-only"
              />
              {t(VIBE_KEY[vibe], lang)}
            </label>
          ))}
        </div>
      </fieldset>

      <Field name="greet"     label={t('personality.greet.label', lang)}     placeholder={t('personality.greet.ph', lang)}     defaultValue={initial?.greet ?? ''} />
      <Field name="must_use"  label={t('personality.must_use.label', lang)}  placeholder={t('personality.must_use.ph', lang)}  defaultValue={initial?.must_use ?? ''} />
      <Field name="must_not"  label={t('personality.must_not.label', lang)}  placeholder={t('personality.must_not.ph', lang)}  defaultValue={initial?.must_not ?? ''} />

      {state.error === 'no_basics' && (
        <p className="text-sm text-red-600">{t('personality.error.no_basics', lang)}</p>
      )}
      {state.error && state.error !== 'no_basics' && (
        <p className="text-sm text-red-600">{t('personality.error', lang)}</p>
      )}

      <StepNav
        step="personality"
        lang={lang}
        continueSlot={
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {pending ? t('personality.saving', lang) : t('personality.save', lang)}
          </button>
        }
      />
    </form>
  )
}

function Field({ name, label, placeholder, defaultValue }: { name: string; label: string; placeholder: string; defaultValue: string }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-zinc-900">{label}</span>
      <input
        type="text"
        name={name}
        maxLength={300}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
      />
    </label>
  )
}
```

- [ ] **Step 3: Replace `personality/page.tsx`**

```tsx
import { WizardShell } from '../_components/WizardShell'
import { PersonalityForm } from './PersonalityForm'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { getOnboardingState } from '@/lib/onboarding/state'
import { t } from '@/lib/onboarding/i18n'
import type { VibePreset } from '@/lib/onboarding/ai/personality'

export const dynamic = 'force-dynamic'

interface Seeds {
  vibe_preset?: VibePreset
  greet?: string
  must_use?: string
  must_not?: string
}

function readSeeds(value: unknown): Seeds | null {
  if (!value || typeof value !== 'object') return null
  const r = value as Record<string, unknown>
  return {
    vibe_preset: typeof r.vibe_preset === 'string' ? (r.vibe_preset as VibePreset) : undefined,
    greet: typeof r.greet === 'string' ? r.greet : undefined,
    must_use: typeof r.must_use === 'string' ? r.must_use : undefined,
    must_not: typeof r.must_not === 'string' ? r.must_not : undefined,
  }
}

export default async function PersonalityPage() {
  const [lang, state] = await Promise.all([getOnboardingLang(), getOnboardingState()])
  const initial = readSeeds(state?.personality_seeds)

  return (
    <WizardShell lang={lang} step="personality">
      <h1 className="text-2xl font-semibold text-zinc-900">{t('personality.heading', lang)}</h1>
      <p className="mt-1 text-sm text-zinc-600">{t('personality.subheading', lang)}</p>
      <div className="mt-6">
        <PersonalityForm lang={lang} initial={initial} />
      </div>
    </WizardShell>
  )
}
```

- [ ] **Step 4: tsc clean. Manually verify.**

`npm run dev`, walk business → knowledge → faqs → personality. Pick a vibe, type a greet, submit. Expect redirect to `/onboarding/goal` (still a stub). Check the DB: `chatbot_configs` row for your user exists with the new `name`, `persona`, `do_rules`, `dont_rules`, `fallback_message`. `onboarding_state.personality_seeds` contains your inputs.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(app)/onboarding/personality/' src/lib/onboarding/i18n.ts
git commit -m "feat(onboarding): personality vibe + 3-prompts form (step 4)"
```

---

## Self-Review

**Spec coverage** (Phase 3):
- [x] FAQs hybrid: AI 5–8 suggestions, pre-checked, add own, skip — Tasks 1–3
- [x] FAQs saved to `knowledge_faqs` — Task 2
- [x] Personality vibe preset + 3 prompts, all skippable — Task 6
- [x] Personality auto-save (no preview gate) — Task 5
- [x] Save to `chatbot_configs` with existing schema columns — Task 5
- [x] AI language matches `ui_language` cookie — Tasks 2, 5
- [x] Re-entry pre-fill — Task 6 reads `personality_seeds`

**Out of scope (Phase 4):**
- Editing AI-generated personality before save (existing chatbot settings already supports this — user can tweak there)
- FAQ regenerate carrying over user's custom additions

**Placeholder scan:** none.

**Type consistency:** `BusinessBasics`, `OnboardingLang`, `VibePreset`, `PersonalitySeeds` all consistent across tests, generators, actions, and forms. `RegenerateButton` reused without modification — its labels are step-agnostic.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-onboarding-phase3-faqs-personality.md`. Continuing with **Subagent-Driven** execution (same as Phases 1+2).
