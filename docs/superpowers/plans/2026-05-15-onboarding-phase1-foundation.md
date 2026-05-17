# Onboarding Wizard — Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the skeleton of the post-signup onboarding wizard: DB state table, signup redirect, shared wizard layout with EN/TL language toggle, dashboard launch checklist, and welcome/done pages. The seven middle steps exist as routable stub pages with a working "Skip this step" button so the wizard is end-to-end navigable from day one. No AI yet.

**Architecture:** New `onboarding_state` table holds per-step `*_completed_at` timestamps, captured inputs, and audit metadata. Signup action upserts a row and redirects to `/onboarding/welcome`. A wizard layout reads the `ws_onboarding_lang` cookie (default `tl`) and renders progress + skip controls. Each step is its own server-rendered route under `src/app/(app)/onboarding/`. Dashboard renders `LaunchChecklist` from the same state. Pre-launch users are backfilled with `completed_at = now()` so they never see the wizard.

**Tech Stack:** Next.js App Router · TypeScript · Supabase (Postgres + RLS) · Vitest · Zod · server actions.

**Related spec:** `docs/superpowers/specs/2026-05-15-onboarding-wizard-design.md`

**Conventions in this repo to follow:**
- Server actions live in `actions.ts` next to the route group (see `src/app/(auth)/actions.ts`).
- Server-side Supabase: `createClient` from `@/lib/supabase/server`.
- Admin/service-role: `createAdminClient` from `@/lib/supabase/admin` (used for backfill).
- Migrations named `supabase/migrations/YYYYMMDDhhmmss_<slug>.sql`; apply via Supabase MCP `apply_migration`.
- Vitest tests live next to source files as `*.test.ts`.

---

## Task 1: DB migration — `onboarding_state` table

**Files:**
- Create: `supabase/migrations/20260528000000_onboarding_state.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =========================================================================
-- Onboarding state: tracks per-step progress for the post-signup wizard.
-- One row per profile. Created by the signup server action; backfilled for
-- pre-existing profiles in the same migration with completed_at = now() so
-- they never see the wizard.
-- =========================================================================

create table public.onboarding_state (
  profile_id uuid primary key references public.profiles(id) on delete cascade,

  -- Per-step completion. null = not done. Timestamp set on both completion
  -- and explicit skip (skipped steps are marked in ai_generations audit).
  business_completed_at         timestamptz,
  knowledge_completed_at        timestamptz,
  faqs_completed_at             timestamptz,
  personality_completed_at      timestamptz,
  goal_completed_at             timestamptz,
  goal_content_completed_at     timestamptz,
  flow_completed_at             timestamptz,

  -- Terminal states. completed_at = user finished the wizard.
  -- dismissed_at = user clicked "Skip for now" or hid the dashboard card.
  completed_at  timestamptz,
  dismissed_at  timestamptz,

  -- Captured user inputs (kept so we can regenerate AI later).
  business_basics     jsonb,
  faq_seeds           jsonb,
  personality_seeds   jsonb,
  flow_description    text,

  -- Audit trail of AI generations + skips.
  ai_generations jsonb not null default '[]'::jsonb,

  ui_language        text not null default 'tl'
    check (ui_language in ('tl','en')),
  customer_language  text not null default 'tl'
    check (customer_language in ('tl','en')),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger onboarding_state_set_updated_at
  before update on public.onboarding_state
  for each row execute function public.set_updated_at();

alter table public.onboarding_state enable row level security;

create policy onboarding_state_select_own on public.onboarding_state
  for select using (auth.uid() = profile_id);
create policy onboarding_state_insert_own on public.onboarding_state
  for insert with check (auth.uid() = profile_id);
create policy onboarding_state_update_own on public.onboarding_state
  for update using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);
-- No DELETE policy — rows cascade from profiles.

-- Backfill: existing profiles get a finished onboarding_state so they don't
-- see the wizard or the dashboard checklist after the feature ships.
insert into public.onboarding_state (profile_id, completed_at)
select id, now() from public.profiles
on conflict (profile_id) do nothing;
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool with name `onboarding_state` and the SQL above.

Expected: success. Verify with `list_tables` that `public.onboarding_state` exists with the listed columns.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260528000000_onboarding_state.sql
git commit -m "feat(db): add onboarding_state table for post-signup wizard"
```

---

## Task 2: Types + state library

**Files:**
- Create: `src/lib/onboarding/types.ts`
- Create: `src/lib/onboarding/steps.ts`
- Create: `src/lib/onboarding/state.ts`
- Create: `src/lib/onboarding/state.test.ts`

- [ ] **Step 1: Define types**

```ts
// src/lib/onboarding/types.ts
export type OnboardingLang = 'tl' | 'en'

export const ONBOARDING_STEPS = [
  'business',
  'knowledge',
  'faqs',
  'personality',
  'goal',
  'goal_content',
  'flow',
] as const

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number]

export interface OnboardingState {
  profileId: string
  business_completed_at: string | null
  knowledge_completed_at: string | null
  faqs_completed_at: string | null
  personality_completed_at: string | null
  goal_completed_at: string | null
  goal_content_completed_at: string | null
  flow_completed_at: string | null
  completed_at: string | null
  dismissed_at: string | null
  business_basics: unknown
  faq_seeds: unknown
  personality_seeds: unknown
  flow_description: string | null
  ai_generations: unknown
  ui_language: OnboardingLang
  customer_language: OnboardingLang
  created_at: string
  updated_at: string
}

export interface OnboardingAuditEntry {
  step: OnboardingStep
  at: string
  model?: string
  prompt_hash?: string
  skipped?: boolean
}
```

- [ ] **Step 2: Define ordered step metadata**

```ts
// src/lib/onboarding/steps.ts
import type { OnboardingState, OnboardingStep } from './types'

export interface StepMeta {
  id: OnboardingStep
  route: `/onboarding/${string}`
  /** label dictionary key (resolved via i18n.t) */
  labelKey: string
  /** state column predicate: returns true when the step is complete or skipped */
  isComplete: (s: OnboardingState) => boolean
}

export const STEP_ORDER: ReadonlyArray<StepMeta> = [
  {
    id: 'business',
    route: '/onboarding/business',
    labelKey: 'checklist.business',
    isComplete: (s) => s.business_completed_at != null,
  },
  {
    id: 'knowledge',
    route: '/onboarding/knowledge',
    labelKey: 'checklist.knowledge',
    isComplete: (s) => s.knowledge_completed_at != null,
  },
  {
    id: 'faqs',
    route: '/onboarding/faqs',
    labelKey: 'checklist.faqs',
    isComplete: (s) => s.faqs_completed_at != null,
  },
  {
    id: 'personality',
    route: '/onboarding/personality',
    labelKey: 'checklist.personality',
    isComplete: (s) => s.personality_completed_at != null,
  },
  {
    id: 'goal',
    route: '/onboarding/goal',
    labelKey: 'checklist.goal',
    isComplete: (s) => s.goal_completed_at != null,
  },
  {
    id: 'goal_content',
    route: '/onboarding/goal-content',
    labelKey: 'checklist.goal_content',
    isComplete: (s) => s.goal_content_completed_at != null,
  },
  {
    id: 'flow',
    route: '/onboarding/flow',
    labelKey: 'checklist.flow',
    isComplete: (s) => s.flow_completed_at != null,
  },
] as const

export function stepCompletionColumn(step: OnboardingStep): string {
  return `${step}_completed_at`
}

export function nextStepRoute(current: OnboardingStep): string {
  const idx = STEP_ORDER.findIndex((s) => s.id === current)
  const next = STEP_ORDER[idx + 1]
  return next?.route ?? '/onboarding/done'
}

export function prevStepRoute(current: OnboardingStep): string {
  const idx = STEP_ORDER.findIndex((s) => s.id === current)
  if (idx <= 0) return '/onboarding/welcome'
  return STEP_ORDER[idx - 1].route
}
```

- [ ] **Step 3: Write failing tests for state lib**

```ts
// src/lib/onboarding/state.test.ts
import { describe, expect, it } from 'vitest'
import { progressFraction } from './state'
import type { OnboardingState } from './types'

const empty: OnboardingState = {
  profileId: 'p1',
  business_completed_at: null,
  knowledge_completed_at: null,
  faqs_completed_at: null,
  personality_completed_at: null,
  goal_completed_at: null,
  goal_content_completed_at: null,
  flow_completed_at: null,
  completed_at: null,
  dismissed_at: null,
  business_basics: null,
  faq_seeds: null,
  personality_seeds: null,
  flow_description: null,
  ai_generations: [],
  ui_language: 'tl',
  customer_language: 'tl',
  created_at: '',
  updated_at: '',
}

describe('progressFraction', () => {
  it('returns 0 when no steps complete', () => {
    expect(progressFraction(empty)).toBe(0)
  })

  it('returns 1 when all steps complete', () => {
    const done: OnboardingState = {
      ...empty,
      business_completed_at: 'x',
      knowledge_completed_at: 'x',
      faqs_completed_at: 'x',
      personality_completed_at: 'x',
      goal_completed_at: 'x',
      goal_content_completed_at: 'x',
      flow_completed_at: 'x',
    }
    expect(progressFraction(done)).toBe(1)
  })

  it('returns 3/7 when three steps complete', () => {
    const partial: OnboardingState = {
      ...empty,
      business_completed_at: 'x',
      knowledge_completed_at: 'x',
      faqs_completed_at: 'x',
    }
    expect(progressFraction(partial)).toBeCloseTo(3 / 7)
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

```
npx vitest run src/lib/onboarding/state.test.ts
```

Expected: FAIL — `progressFraction` not exported.

- [ ] **Step 5: Implement the state lib**

```ts
// src/lib/onboarding/state.ts
import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { STEP_ORDER, stepCompletionColumn } from './steps'
import type {
  OnboardingAuditEntry,
  OnboardingState,
  OnboardingStep,
} from './types'

const TABLE = 'onboarding_state'

type Row = {
  profile_id: string
  business_completed_at: string | null
  knowledge_completed_at: string | null
  faqs_completed_at: string | null
  personality_completed_at: string | null
  goal_completed_at: string | null
  goal_content_completed_at: string | null
  flow_completed_at: string | null
  completed_at: string | null
  dismissed_at: string | null
  business_basics: unknown
  faq_seeds: unknown
  personality_seeds: unknown
  flow_description: string | null
  ai_generations: unknown
  ui_language: 'tl' | 'en'
  customer_language: 'tl' | 'en'
  created_at: string
  updated_at: string
}

function rowToState(row: Row): OnboardingState {
  return {
    profileId: row.profile_id,
    business_completed_at: row.business_completed_at,
    knowledge_completed_at: row.knowledge_completed_at,
    faqs_completed_at: row.faqs_completed_at,
    personality_completed_at: row.personality_completed_at,
    goal_completed_at: row.goal_completed_at,
    goal_content_completed_at: row.goal_content_completed_at,
    flow_completed_at: row.flow_completed_at,
    completed_at: row.completed_at,
    dismissed_at: row.dismissed_at,
    business_basics: row.business_basics,
    faq_seeds: row.faq_seeds,
    personality_seeds: row.personality_seeds,
    flow_description: row.flow_description,
    ai_generations: row.ai_generations ?? [],
    ui_language: row.ui_language,
    customer_language: row.customer_language,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/** Read the onboarding row for the signed-in user. Returns null if none exists. */
export async function getOnboardingState(): Promise<OnboardingState | null> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return null
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('profile_id', auth.user.id)
    .maybeSingle()
  if (error || !data) return null
  return rowToState(data as Row)
}

/** Insert an onboarding_state row for a freshly signed-up user. Idempotent. */
export async function initOnboardingForProfile(profileId: string): Promise<void> {
  const admin = createAdminClient()
  await admin
    .from(TABLE)
    .upsert({ profile_id: profileId }, { onConflict: 'profile_id', ignoreDuplicates: true })
}

/** Mark a step completed (or skipped) for the current user. */
export async function markStep(
  step: OnboardingStep,
  opts: { skipped?: boolean } = {},
): Promise<void> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('not authenticated')
  const col = stepCompletionColumn(step)
  const now = new Date().toISOString()

  // Append audit entry
  const { data: row } = await supabase
    .from(TABLE)
    .select('ai_generations')
    .eq('profile_id', auth.user.id)
    .maybeSingle()
  const audit: OnboardingAuditEntry[] = Array.isArray(row?.ai_generations)
    ? (row!.ai_generations as OnboardingAuditEntry[])
    : []
  audit.push({ step, at: now, skipped: !!opts.skipped })

  const patch: Record<string, unknown> = {
    [col]: now,
    ai_generations: audit,
  }
  const { error } = await supabase
    .from(TABLE)
    .update(patch)
    .eq('profile_id', auth.user.id)
  if (error) throw error
}

export async function dismissOnboarding(): Promise<void> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('not authenticated')
  await supabase
    .from(TABLE)
    .update({ dismissed_at: new Date().toISOString() })
    .eq('profile_id', auth.user.id)
}

export async function completeOnboarding(): Promise<void> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('not authenticated')
  await supabase
    .from(TABLE)
    .update({ completed_at: new Date().toISOString() })
    .eq('profile_id', auth.user.id)
}

export async function setOnboardingLanguage(
  lang: 'tl' | 'en',
  which: 'ui' | 'customer' | 'both' = 'ui',
): Promise<void> {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('not authenticated')
  const patch: Record<string, unknown> = {}
  if (which === 'ui' || which === 'both') patch.ui_language = lang
  if (which === 'customer' || which === 'both') patch.customer_language = lang
  await supabase.from(TABLE).update(patch).eq('profile_id', auth.user.id)
}

/** Pure helper: 0..1 progress fraction. Used by progress bar + tests. */
export function progressFraction(state: OnboardingState): number {
  const done = STEP_ORDER.filter((s) => s.isComplete(state)).length
  return done / STEP_ORDER.length
}
```

- [ ] **Step 6: Run tests to verify pass**

```
npx vitest run src/lib/onboarding/state.test.ts
```

Expected: PASS, all three tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/onboarding/
git commit -m "feat(onboarding): state lib + step metadata + types"
```

---

## Task 3: i18n dictionary

**Files:**
- Create: `src/lib/onboarding/i18n.ts`
- Create: `src/lib/onboarding/i18n.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/onboarding/i18n.test.ts
import { describe, expect, it } from 'vitest'
import { t, LANG_COOKIE, readLangFromCookie } from './i18n'

describe('t', () => {
  it('returns Tagalog by default', () => {
    expect(t('welcome.title', 'tl')).toBe('Tara, i-setup natin yung bot mo')
  })

  it('returns English when lang=en', () => {
    expect(t('welcome.title', 'en')).toBe("Let's set up your bot")
  })
})

describe('readLangFromCookie', () => {
  it('returns "tl" when cookie missing', () => {
    expect(readLangFromCookie(undefined)).toBe('tl')
  })

  it('returns "en" when cookie = "en"', () => {
    expect(readLangFromCookie('en')).toBe('en')
  })

  it('returns "tl" when cookie has unknown value', () => {
    expect(readLangFromCookie('jp')).toBe('tl')
  })

  it('cookie name is ws_onboarding_lang', () => {
    expect(LANG_COOKIE).toBe('ws_onboarding_lang')
  })
})
```

- [ ] **Step 2: Run tests, expect FAIL**

```
npx vitest run src/lib/onboarding/i18n.test.ts
```

- [ ] **Step 3: Implement the dictionary + helpers**

```ts
// src/lib/onboarding/i18n.ts
import type { OnboardingLang } from './types'

export const LANG_COOKIE = 'ws_onboarding_lang'

export const dict = {
  // Shared shell
  'shell.skip_for_now':         { tl: 'I-skip muna',          en: 'Skip for now' },
  'shell.skip_step':            { tl: 'I-skip ang step na ito', en: 'Skip this step' },
  'shell.back':                 { tl: 'Bumalik',              en: 'Back' },
  'shell.continue':             { tl: 'Magpatuloy',           en: 'Continue' },
  'shell.lang_toggle':          { tl: 'EN',                    en: 'TL' },
  'shell.progress':             { tl: 'Step {{n}} of {{total}}', en: 'Step {{n}} of {{total}}' },

  // Welcome step
  'welcome.title':              { tl: 'Tara, i-setup natin yung bot mo', en: "Let's set up your bot" },
  'welcome.body':               {
    tl: 'Maglalagay tayo ng kaunting info tungkol sa business mo, tapos sasagutan ng AI ang madaming detalye para sa iyo. Pwede mong i-skip ang kahit anong step.',
    en: "We'll capture a little about your business, and AI will fill in the rest. You can skip any step.",
  },
  'welcome.start':              { tl: 'Simulan na', en: 'Get started' },

  // Done step
  'done.title':                 { tl: 'Tapos na ang setup mo', en: 'Setup complete' },
  'done.body':                  {
    tl: 'Subukan mo na yung bot mo sa tester, o pumunta sa dashboard.',
    en: 'Try your bot in the tester, or jump into the dashboard.',
  },
  'done.open_tester':           { tl: 'Buksan ang tester',  en: 'Open chatbot tester' },
  'done.go_dashboard':          { tl: 'Pumunta sa dashboard', en: 'Go to dashboard' },

  // Checklist labels
  'checklist.title':            { tl: 'I-launch ang account mo',    en: 'Launch your account' },
  'checklist.business':         { tl: 'Mga detalye ng business',    en: 'Business basics' },
  'checklist.knowledge':        { tl: 'Knowledge base',             en: 'Knowledge base' },
  'checklist.faqs':             { tl: 'Mga FAQ',                    en: 'FAQs' },
  'checklist.personality':      { tl: 'Personality ng bot',         en: 'Bot personality' },
  'checklist.goal':             { tl: 'Pangunahing goal',           en: 'Primary goal' },
  'checklist.goal_content':     { tl: 'Detalye ng action page',     en: 'Action page content' },
  'checklist.flow':             { tl: 'Flow ng conversation',            en: 'Conversation flow' },
  'checklist.dismiss':          { tl: 'Itago ang checklist',        en: 'Hide checklist' },
  'checklist.resume':           { tl: 'Ituloy',                     en: 'Resume' },
  'checklist.start':            { tl: 'Simulan',                    en: 'Start' },

  // Stub copy (used by middle-step pages until later phases replace them)
  'stub.title':                 { tl: 'Step na ito ay paparating pa', en: 'This step is coming soon' },
  'stub.body':                  {
    tl: 'I-skip muna ito at magpapatuloy tayo sa susunod na step.',
    en: "Skip this for now — we'll continue to the next step.",
  },
} as const

export type DictKey = keyof typeof dict

export function t(key: DictKey, lang: OnboardingLang, vars: Record<string, string | number> = {}): string {
  let s: string = dict[key][lang]
  for (const [k, v] of Object.entries(vars)) {
    s = s.replaceAll(`{{${k}}}`, String(v))
  }
  return s
}

export function readLangFromCookie(value: string | undefined): OnboardingLang {
  return value === 'en' ? 'en' : 'tl'
}
```

- [ ] **Step 4: Run tests, expect PASS**

```
npx vitest run src/lib/onboarding/i18n.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/onboarding/i18n.ts src/lib/onboarding/i18n.test.ts
git commit -m "feat(onboarding): i18n dictionary with EN/TL labels"
```

---

## Task 4: Wire signup to create onboarding state + redirect

**Files:**
- Modify: `src/app/(auth)/actions.ts` — `signUpAction`

- [ ] **Step 1: Edit `signUpAction` to init onboarding + redirect to wizard**

Find the existing `signUpAction` in `src/app/(auth)/actions.ts`. After the successful auto sign-in but before the existing `redirect('/dashboard')`:

1. Import `initOnboardingForProfile` from `@/lib/onboarding/state`.
2. After `signInWithPassword` succeeds, fetch the user and call `initOnboardingForProfile(user.id)`.
3. Replace `redirect('/dashboard')` with `redirect('/onboarding/welcome')`.

Concrete diff inside the function:

```ts
import { initOnboardingForProfile } from '@/lib/onboarding/state'

// ...after the successful signInWithPassword block...
const { data: meAuth } = await supabase.auth.getUser()
if (meAuth.user) {
  await initOnboardingForProfile(meAuth.user.id)
}
redirect('/onboarding/welcome')
```

Leave `signInAction` unchanged — existing users keep landing on `/dashboard`.

- [ ] **Step 2: Manually verify**

Run `npm run dev`. Sign up a new test account. Expected: lands on `/onboarding/welcome` (route will 404 until Task 6 — that's fine for this step, the redirect itself is what we're verifying via the URL bar).

- [ ] **Step 3: Commit**

```bash
git add src/app/\(auth\)/actions.ts
git commit -m "feat(onboarding): redirect new signups to wizard and init state"
```

---

## Task 5: Wizard layout + LangToggle + shared shell components

**Files:**
- Create: `src/app/(app)/onboarding/layout.tsx`
- Create: `src/app/(app)/onboarding/loading.tsx`
- Create: `src/app/(app)/onboarding/actions.ts`
- Create: `src/app/(app)/onboarding/_components/WizardShell.tsx`
- Create: `src/app/(app)/onboarding/_components/LangToggle.tsx`
- Create: `src/app/(app)/onboarding/_components/StepNav.tsx`

- [ ] **Step 1: Create the server actions for the shell**

```ts
// src/app/(app)/onboarding/actions.ts
'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import {
  completeOnboarding as completeOnboardingState,
  dismissOnboarding as dismissOnboardingState,
  markStep,
  setOnboardingLanguage,
} from '@/lib/onboarding/state'
import { LANG_COOKIE } from '@/lib/onboarding/i18n'
import { ONBOARDING_STEPS, type OnboardingLang, type OnboardingStep } from '@/lib/onboarding/types'
import { nextStepRoute } from '@/lib/onboarding/steps'

function isStep(value: unknown): value is OnboardingStep {
  return typeof value === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(value)
}

export async function setLangAction(formData: FormData): Promise<void> {
  const raw = formData.get('lang')
  const lang: OnboardingLang = raw === 'en' ? 'en' : 'tl'
  const jar = await cookies()
  jar.set(LANG_COOKIE, lang, { path: '/', maxAge: 60 * 60 * 24 * 365 })
  await setOnboardingLanguage(lang, 'both')
  revalidatePath('/onboarding')
  revalidatePath('/dashboard')
}

export async function skipStepAction(formData: FormData): Promise<void> {
  const step = formData.get('step')
  if (!isStep(step)) throw new Error('invalid step')
  await markStep(step, { skipped: true })
  redirect(nextStepRoute(step))
}

export async function dismissOnboardingAction(): Promise<void> {
  await dismissOnboardingState()
  redirect('/dashboard')
}

export async function completeOnboardingAction(): Promise<void> {
  await completeOnboardingState()
  redirect('/dashboard')
}
```

- [ ] **Step 2: Create `LangToggle` component**

```tsx
// src/app/(app)/onboarding/_components/LangToggle.tsx
import { setLangAction } from '../actions'
import type { OnboardingLang } from '@/lib/onboarding/types'

export function LangToggle({ lang }: { lang: OnboardingLang }) {
  const next: OnboardingLang = lang === 'tl' ? 'en' : 'tl'
  return (
    <form action={setLangAction}>
      <input type="hidden" name="lang" value={next} />
      <button
        type="submit"
        className="text-xs font-medium px-2 py-1 rounded border border-zinc-300 hover:bg-zinc-50"
        aria-label={`Switch language to ${next.toUpperCase()}`}
      >
        {lang === 'tl' ? 'EN' : 'TL'}
      </button>
    </form>
  )
}
```

- [ ] **Step 3: Create `StepNav` component**

```tsx
// src/app/(app)/onboarding/_components/StepNav.tsx
import Link from 'next/link'
import { skipStepAction } from '../actions'
import { t } from '@/lib/onboarding/i18n'
import { prevStepRoute } from '@/lib/onboarding/steps'
import type { OnboardingLang, OnboardingStep } from '@/lib/onboarding/types'

interface Props {
  step: OnboardingStep
  lang: OnboardingLang
  /** Render a primary submit/continue button (caller decides label + form). */
  continueSlot?: React.ReactNode
}

export function StepNav({ step, lang, continueSlot }: Props) {
  return (
    <div className="flex items-center justify-between gap-3 pt-6">
      <Link
        href={prevStepRoute(step)}
        className="text-sm text-zinc-600 hover:text-zinc-900"
      >
        {t('shell.back', lang)}
      </Link>
      <div className="flex items-center gap-3">
        <form action={skipStepAction}>
          <input type="hidden" name="step" value={step} />
          <button
            type="submit"
            className="text-sm text-zinc-600 hover:text-zinc-900"
          >
            {t('shell.skip_step', lang)}
          </button>
        </form>
        {continueSlot}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create `WizardShell` component**

```tsx
// src/app/(app)/onboarding/_components/WizardShell.tsx
import { LangToggle } from './LangToggle'
import { dismissOnboardingAction } from '../actions'
import { t } from '@/lib/onboarding/i18n'
import { STEP_ORDER } from '@/lib/onboarding/steps'
import type { OnboardingLang, OnboardingStep } from '@/lib/onboarding/types'

interface Props {
  lang: OnboardingLang
  /** Current step id, or null for welcome/done pages. */
  step: OnboardingStep | null
  children: React.ReactNode
}

export function WizardShell({ lang, step, children }: Props) {
  const total = STEP_ORDER.length
  const idx = step ? STEP_ORDER.findIndex((s) => s.id === step) : -1
  const stepNumber = idx >= 0 ? idx + 1 : null

  return (
    <div className="min-h-svh bg-zinc-50">
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-zinc-900">WhatStage</span>
          {stepNumber != null ? (
            <span className="text-xs text-zinc-500">
              {t('shell.progress', lang, { n: stepNumber, total })}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          <LangToggle lang={lang} />
          <form action={dismissOnboardingAction}>
            <button
              type="submit"
              className="text-xs text-zinc-600 hover:text-zinc-900"
            >
              {t('shell.skip_for_now', lang)}
            </button>
          </form>
        </div>
      </header>

      {stepNumber != null ? (
        <div
          className="h-1 w-full bg-zinc-200"
          role="progressbar"
          aria-valuenow={stepNumber}
          aria-valuemin={0}
          aria-valuemax={total}
        >
          <div
            className="h-full bg-emerald-600 transition-all"
            style={{ width: `${(stepNumber / total) * 100}%` }}
          />
        </div>
      ) : null}

      <main className="mx-auto max-w-2xl px-4 py-10">{children}</main>
    </div>
  )
}
```

- [ ] **Step 5: Create the route layout**

Layouts can't see the active route, so each page renders its own `<WizardShell step={...}>` and reads the cookie via a tiny helper. The layout itself is a pass-through that just forces dynamic rendering (cookies block static).

```tsx
// src/app/(app)/onboarding/layout.tsx
export const dynamic = 'force-dynamic'

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return children
}
```

- [ ] **Step 6: Add the lang helper**

```ts
// src/lib/onboarding/lang.ts
import 'server-only'
import { cookies } from 'next/headers'
import { LANG_COOKIE, readLangFromCookie } from './i18n'
import type { OnboardingLang } from './types'

export async function getOnboardingLang(): Promise<OnboardingLang> {
  const jar = await cookies()
  return readLangFromCookie(jar.get(LANG_COOKIE)?.value)
}
```

- [ ] **Step 7: Add a basic loading state**

```tsx
// src/app/(app)/onboarding/loading.tsx
export default function Loading() {
  return (
    <div className="min-h-svh bg-zinc-50">
      <div className="h-12 w-full border-b border-zinc-200 bg-white" />
      <div className="mx-auto max-w-2xl animate-pulse px-4 py-10">
        <div className="h-6 w-2/3 rounded bg-zinc-200" />
        <div className="mt-4 h-4 w-full rounded bg-zinc-200" />
        <div className="mt-2 h-4 w-5/6 rounded bg-zinc-200" />
      </div>
    </div>
  )
}
```

- [ ] **Step 8: Commit**

```bash
git add src/app/\(app\)/onboarding/ src/lib/onboarding/lang.ts
git commit -m "feat(onboarding): wizard shell, lang toggle, step nav, layout"
```

---

## Task 6: Welcome page

**Files:**
- Create: `src/app/(app)/onboarding/welcome/page.tsx`

- [ ] **Step 1: Implement the welcome page**

```tsx
// src/app/(app)/onboarding/welcome/page.tsx
import Link from 'next/link'
import { WizardShell } from '../_components/WizardShell'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { t } from '@/lib/onboarding/i18n'

export default async function WelcomePage() {
  const lang = await getOnboardingLang()
  return (
    <WizardShell lang={lang} step={null}>
      <h1 className="text-2xl font-semibold text-zinc-900">{t('welcome.title', lang)}</h1>
      <p className="mt-3 text-zinc-700">{t('welcome.body', lang)}</p>
      <div className="mt-8">
        <Link
          href="/onboarding/business"
          className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          {t('welcome.start', lang)}
        </Link>
      </div>
    </WizardShell>
  )
}
```

- [ ] **Step 2: Manually verify**

`npm run dev`, navigate to `/onboarding/welcome` (signed in). Expected: page renders in Tagalog with EN toggle in header. Clicking EN flips labels and persists across refresh (cookie + `setLangAction`).

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/onboarding/welcome/
git commit -m "feat(onboarding): welcome page"
```

---

## Task 7: Stub pages for all seven middle steps

Each middle step gets a minimal page that renders title + body + `StepNav` so the user can click "Skip this step" and progress. These pages will be replaced in Phases 2–4.

**Files:**
- Create: `src/app/(app)/onboarding/business/page.tsx`
- Create: `src/app/(app)/onboarding/knowledge/page.tsx`
- Create: `src/app/(app)/onboarding/faqs/page.tsx`
- Create: `src/app/(app)/onboarding/personality/page.tsx`
- Create: `src/app/(app)/onboarding/goal/page.tsx`
- Create: `src/app/(app)/onboarding/goal-content/page.tsx`
- Create: `src/app/(app)/onboarding/flow/page.tsx`

- [ ] **Step 1: Create a shared stub renderer**

```tsx
// src/app/(app)/onboarding/_components/StepStub.tsx
import { WizardShell } from './WizardShell'
import { StepNav } from './StepNav'
import { t } from '@/lib/onboarding/i18n'
import type { OnboardingLang, OnboardingStep } from '@/lib/onboarding/types'

interface Props {
  step: OnboardingStep
  lang: OnboardingLang
  titleKey: string
}

export function StepStub({ step, lang, titleKey }: Props) {
  return (
    <WizardShell lang={lang} step={step}>
      <h1 className="text-2xl font-semibold text-zinc-900">
        {t(titleKey as never, lang)}
      </h1>
      <p className="mt-2 text-sm text-zinc-600">{t('stub.body', lang)}</p>
      <StepNav step={step} lang={lang} />
    </WizardShell>
  )
}
```

- [ ] **Step 2: Create the seven stub pages**

For each route below, create the page with the matching body. Pattern:

```tsx
// src/app/(app)/onboarding/business/page.tsx
import { StepStub } from '../_components/StepStub'
import { getOnboardingLang } from '@/lib/onboarding/lang'

export default async function BusinessPage() {
  const lang = await getOnboardingLang()
  return <StepStub step="business" lang={lang} titleKey="checklist.business" />
}
```

Repeat with these `step` / `titleKey` pairs:

| File | step | titleKey |
|---|---|---|
| `knowledge/page.tsx` | `knowledge` | `checklist.knowledge` |
| `faqs/page.tsx` | `faqs` | `checklist.faqs` |
| `personality/page.tsx` | `personality` | `checklist.personality` |
| `goal/page.tsx` | `goal` | `checklist.goal` |
| `goal-content/page.tsx` | `goal_content` | `checklist.goal_content` |
| `flow/page.tsx` | `flow` | `checklist.flow` |

- [ ] **Step 3: Manually verify navigation**

`npm run dev`. Start at `/onboarding/welcome` → click Get started → land on `/onboarding/business`. Click "Skip this step" seven times: business → knowledge → faqs → personality → goal → goal-content → flow → `/onboarding/done` (404 until Task 8 — that's fine).

Open Supabase: `select business_completed_at, ai_generations from onboarding_state where profile_id = '<your uid>'`. Expect each `*_completed_at` filled and seven audit entries with `skipped: true`.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/onboarding/{business,knowledge,faqs,personality,goal,goal-content,flow}/ src/app/\(app\)/onboarding/_components/StepStub.tsx
git commit -m "feat(onboarding): stub pages for steps 1-7 with skip flow"
```

---

## Task 8: Done page

**Files:**
- Create: `src/app/(app)/onboarding/done/page.tsx`

- [ ] **Step 1: Implement done page**

```tsx
// src/app/(app)/onboarding/done/page.tsx
import Link from 'next/link'
import { WizardShell } from '../_components/WizardShell'
import { completeOnboardingAction } from '../actions'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { t } from '@/lib/onboarding/i18n'

export default async function DonePage() {
  const lang = await getOnboardingLang()
  return (
    <WizardShell lang={lang} step={null}>
      <h1 className="text-2xl font-semibold text-zinc-900">{t('done.title', lang)}</h1>
      <p className="mt-3 text-zinc-700">{t('done.body', lang)}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/dashboard/chatbot"
          className="inline-flex items-center rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          {t('done.open_tester', lang)}
        </Link>
        <form action={completeOnboardingAction}>
          <button
            type="submit"
            className="inline-flex items-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
          >
            {t('done.go_dashboard', lang)}
          </button>
        </form>
      </div>
    </WizardShell>
  )
}
```

The "Open tester" link doesn't call `completeOnboardingAction` because we want the user to be able to finish later; only "Go to dashboard" marks the wizard complete. (Phase 4 will revisit this — for now, opening the tester leaves `completed_at` null, and the checklist still shows on the dashboard with the last unskipped step.)

- [ ] **Step 2: Manually verify**

Visit `/onboarding/done`. Both buttons render and route correctly. Clicking "Go to dashboard" sets `completed_at` and lands on `/dashboard`.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/onboarding/done/
git commit -m "feat(onboarding): done page with tester + dashboard CTAs"
```

---

## Task 9: Dashboard launch checklist component

**Files:**
- Create: `src/app/(app)/dashboard/_components/LaunchChecklist.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx` — render `<LaunchChecklist />` near the top

- [ ] **Step 1: Implement checklist**

```tsx
// src/app/(app)/dashboard/_components/LaunchChecklist.tsx
import Link from 'next/link'
import { getOnboardingState } from '@/lib/onboarding/state'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { STEP_ORDER } from '@/lib/onboarding/steps'
import { t } from '@/lib/onboarding/i18n'
import { dismissOnboardingAction } from '@/app/(app)/onboarding/actions'

export async function LaunchChecklist() {
  const [state, lang] = await Promise.all([getOnboardingState(), getOnboardingLang()])
  if (!state) return null
  if (state.completed_at || state.dismissed_at) return null

  return (
    <section
      className="rounded-lg border border-emerald-200 bg-emerald-50 p-5"
      aria-labelledby="launch-checklist-title"
    >
      <div className="flex items-center justify-between">
        <h2 id="launch-checklist-title" className="text-sm font-semibold text-emerald-900">
          {t('checklist.title', lang)}
        </h2>
        <form action={dismissOnboardingAction}>
          <button type="submit" className="text-xs text-emerald-700 hover:text-emerald-900">
            {t('checklist.dismiss', lang)}
          </button>
        </form>
      </div>

      <ul className="mt-3 divide-y divide-emerald-100">
        {STEP_ORDER.map((meta) => {
          const done = meta.isComplete(state)
          return (
            <li key={meta.id} className="flex items-center justify-between py-2">
              <span className="flex items-center gap-2 text-sm">
                <span
                  aria-hidden
                  className={`inline-flex h-4 w-4 items-center justify-center rounded-full border ${
                    done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-zinc-300 bg-white'
                  }`}
                >
                  {done ? '✓' : ''}
                </span>
                <span className={done ? 'text-zinc-500 line-through' : 'text-zinc-900'}>
                  {t(meta.labelKey as never, lang)}
                </span>
              </span>
              <Link
                href={meta.route}
                className="text-xs font-medium text-emerald-700 hover:text-emerald-900"
              >
                {done ? t('checklist.resume', lang) : t('checklist.start', lang)}
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
```

- [ ] **Step 2: Render on the dashboard**

Open `src/app/(app)/dashboard/page.tsx`. Import and render `<LaunchChecklist />` near the top of the main content area (above existing widgets). Use Suspense if the file already uses it; otherwise a direct `await` from the server component is fine.

```tsx
import { LaunchChecklist } from './_components/LaunchChecklist'
// ...
// inside the returned JSX, near the top:
<LaunchChecklist />
```

- [ ] **Step 3: Manually verify**

Sign up a fresh account → skip out of the wizard via "Skip for now" → land on `/dashboard`. Expected: checklist card visible, all 7 items unchecked, "Hide checklist" button works (sets `dismissed_at`, hides card, persists on refresh). Visit `/onboarding/business` directly and skip; refresh dashboard, expect that item checked.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/dashboard/_components/LaunchChecklist.tsx src/app/\(app\)/dashboard/page.tsx
git commit -m "feat(onboarding): dashboard launch checklist"
```

---

## Task 10: Test the signup → wizard → dashboard end-to-end flow

This is a manual integration pass to catch wiring bugs before Phase 2 starts adding AI.

- [ ] **Step 1: Fresh signup walkthrough**

1. Run `npm run dev`.
2. Sign up a new account at `/signup`.
3. Expected: lands on `/onboarding/welcome` in Tagalog.
4. Toggle EN → labels switch; refresh → still EN.
5. Click "Get started" → `/onboarding/business`. Progress bar reads `Step 1 of 7`.
6. Skip every step. Verify the progress bar increments and lands on `/onboarding/done`.
7. Click "Go to dashboard". Verify checklist is hidden (because `completed_at` was set).

- [ ] **Step 2: Mid-flow dismiss walkthrough**

1. Sign up a second test account.
2. On `/onboarding/welcome`, click "Skip for now" → lands on `/dashboard`.
3. Verify checklist appears with all unchecked.
4. Click "Start" next to "Business basics" → wizard reopens at `/onboarding/business`.
5. Skip that step → land on `/onboarding/knowledge`.
6. Click "Skip for now" again → dashboard. Verify "Business basics" is now checked, others unchecked. "Hide checklist" works and persists.

- [ ] **Step 3: Pre-launch user verification**

Pick an existing (pre-launch) profile from the DB. Sign in as that user. Expected: lands on `/dashboard` (existing behavior), no checklist visible (because the backfill set `completed_at`).

- [ ] **Step 4: Commit a note**

If everything passes, no code commit needed. If you fix anything, commit it on the fly:

```bash
git add .
git commit -m "fix(onboarding): <whatever you fixed>"
```

---

## Self-Review

**Spec coverage** (Phase 1 scope only):
- [x] `onboarding_state` table — Task 1
- [x] Signup redirect + row init — Task 4
- [x] Wizard shell + EN/TL toggle + progress bar — Task 5
- [x] Skippable navigation through 7 stub steps — Tasks 5, 7
- [x] Welcome + done pages — Tasks 6, 8
- [x] Dashboard launch checklist — Task 9
- [x] Backfill pre-launch users — Task 1 (inline `insert ... on conflict do nothing`)
- [x] Cookie-based language persistence + DB mirror — Tasks 3, 5

Phase 2 will add: business basics form, knowledge AI generator + preview editor.
Phase 3 will add: FAQ hybrid checklist + personality auto-save.
Phase 4 will add: goal/action-page creation, goal-content branching, flow → bot instructions.

**Placeholder scan:** none — every step has concrete code, paths, and commands.

**Type consistency:** `OnboardingStep`, `OnboardingLang`, `OnboardingState` defined in `types.ts` and reused by `steps.ts`, `state.ts`, `i18n.ts`, and every route. `STEP_ORDER` is the single source of step truth.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-15-onboarding-phase1-foundation.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach?
