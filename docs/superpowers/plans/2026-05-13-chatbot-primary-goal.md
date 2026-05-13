# Chatbot Primary Goal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single chatbot-level "primary goal" action page that the bot gently steers open-ended conversations toward, with UI on both the chatbot settings page and action-pages list, plus a prompt to set/replace the goal after publishing a new page.

**Architecture:** New nullable `primary_action_page_id` column on `chatbot_configs` (FK to `action_pages`, `on delete set null`). A new `loadPrimaryGoalInstruction` helper composes a goal block from the page's title, public URL, and `bot_send_instructions`, and is fed into the existing `funnelInstruction` slot of `buildPrompt` only when no campaign override is present. Detect first-time `draft → published` transition in the action-page update server action; auto-assign if it's the user's only published page, else redirect with query params so a client banner can offer the choice.

**Tech Stack:** Next.js App Router · TypeScript · Supabase · Vitest · server actions.

**Related spec:** `docs/superpowers/specs/2026-05-13-chatbot-primary-goal-design.md`

**Status enum note:** `action_pages.status` is `'draft' | 'published' | 'archived'` (not "live"). Use `'published'`.

---

## Task 1: DB migration — add `primary_action_page_id`

**Files:**
- Create: `supabase/migrations/20260526000000_chatbot_primary_action_page.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Add primary_action_page_id to chatbot_configs.
-- Soft pointer to a user's chosen "primary goal" action page. When set, the
-- chatbot uses it to gently steer open-ended conversations. Nullable so users
-- can have no goal. ON DELETE SET NULL so deleting the page doesn't break
-- chatbot config rows.

alter table public.chatbot_configs
  add column if not exists primary_action_page_id uuid
    references public.action_pages(id) on delete set null;

create index if not exists chatbot_configs_primary_action_page_idx
  on public.chatbot_configs(primary_action_page_id)
  where primary_action_page_id is not null;
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP `apply_migration` tool with name `chatbot_primary_action_page` and the SQL above.

Expected: success, no errors. Verify with `list_tables` that `chatbot_configs` has the new column.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260526000000_chatbot_primary_action_page.sql
git commit -m "feat(db): add primary_action_page_id to chatbot_configs"
```

---

## Task 2: Extend `ChatbotConfig` type and persistence

**Files:**
- Modify: `src/lib/chatbot/config.ts`

- [ ] **Step 1: Add field to row + config types and defaults**

In `src/lib/chatbot/config.ts`:

1. Add `primary_action_page_id: string | null` to `ChatbotConfigRow`.
2. Add `primaryActionPageId: string | null` to `ChatbotConfig` (extend the type literal that adds runtime fields onto `ChatbotPersona`).
3. Add `primaryActionPageId: null` to `DEFAULT_CHATBOT_CONFIG`.
4. In `rowToConfig`, set `primaryActionPageId: row.primary_action_page_id ?? null`.

Concrete diffs:

```ts
export type ChatbotConfigRow = {
  // ...existing fields...
  recommendation_rules: unknown
  primary_action_page_id: string | null
  created_at: string
  updated_at: string
}

export type ChatbotConfig = ChatbotPersona & {
  temperature: number
  maxContext: number
  autoClassifyEnabled: boolean
  activeTemplateId: string | null
  personalitySource: 'custom' | 'template'
  recommendationRules: RecommendationRulesMap
  primaryActionPageId: string | null
  updatedAt: string
}

export const DEFAULT_CHATBOT_CONFIG: ChatbotConfig = {
  ...DEFAULT_CHATBOT_PERSONA,
  temperature: 0.4,
  maxContext: 12,
  autoClassifyEnabled: false,
  activeTemplateId: null,
  personalitySource: 'custom',
  recommendationRules: DEFAULT_RECOMMENDATION_RULES,
  primaryActionPageId: null,
  updatedAt: '',
}
```

In `rowToConfig`, add the line:

```ts
primaryActionPageId: row.primary_action_page_id ?? null,
```

- [ ] **Step 2: Add a new dedicated setter**

Append at the end of `src/lib/chatbot/config.ts`:

```ts
export async function setPrimaryActionPageId(
  supabase: SupabaseClient,
  userId: string,
  actionPageId: string | null,
): Promise<void> {
  const { error } = await supabase
    .from('chatbot_configs')
    .upsert(
      { user_id: userId, primary_action_page_id: actionPageId },
      { onConflict: 'user_id' },
    )
  if (error) throw new Error(`setPrimaryActionPageId: ${error.message}`)
}
```

Rationale: keep `upsertChatbotConfig` focused on personality fields; this setter is called from a separate server action used by both the action-pages list and the publish banner.

- [ ] **Step 3: Verify it compiles**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/chatbot/config.ts
git commit -m "feat(chatbot): track primary_action_page_id on chatbot config"
```

---

## Task 3: `loadPrimaryGoalInstruction` helper — TDD

**Files:**
- Create: `src/lib/chatbot/primary-goal.test.ts`
- Create: `src/lib/chatbot/primary-goal.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/chatbot/primary-goal.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { loadPrimaryGoalInstruction } from './primary-goal'

function mockClient(
  configRow: { primary_action_page_id: string | null } | null,
  pageRow: {
    title: string
    slug: string
    bot_send_instructions: string | null
    status: string
  } | null,
) {
  const from = vi.fn((table: string) => {
    if (table === 'chatbot_configs') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: configRow, error: null }),
          }),
        }),
      }
    }
    if (table === 'action_pages') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: pageRow, error: null }),
            }),
          }),
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
  return { from } as unknown as Parameters<typeof loadPrimaryGoalInstruction>[0]
}

describe('loadPrimaryGoalInstruction', () => {
  const userId = 'user-1'
  const origEnv = process.env.NEXT_PUBLIC_APP_URL

  beforeAll(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
  })
  afterAll(() => {
    process.env.NEXT_PUBLIC_APP_URL = origEnv
  })

  it('returns null when no config row', async () => {
    const c = mockClient(null, null)
    expect(await loadPrimaryGoalInstruction(c, userId)).toBeNull()
  })

  it('returns null when primary_action_page_id is null', async () => {
    const c = mockClient({ primary_action_page_id: null }, null)
    expect(await loadPrimaryGoalInstruction(c, userId)).toBeNull()
  })

  it('returns null when page is not published', async () => {
    const c = mockClient(
      { primary_action_page_id: 'page-1' },
      null, // RPC filtered by status='published' returns null for draft/archived
    )
    expect(await loadPrimaryGoalInstruction(c, userId)).toBeNull()
  })

  it('returns formatted block when page is published and has instructions', async () => {
    const c = mockClient(
      { primary_action_page_id: 'page-1' },
      {
        title: 'Book a demo',
        slug: 'demo',
        bot_send_instructions: 'Offer when curiosity is high.',
        status: 'published',
      },
    )
    const out = await loadPrimaryGoalInstruction(c, userId)
    expect(out).toContain('Book a demo')
    expect(out).toContain('https://app.example.com/a/demo')
    expect(out).toContain('Offer when curiosity is high.')
    expect(out).toMatch(/Do not force/i)
  })

  it('omits the instructions line when bot_send_instructions is empty', async () => {
    const c = mockClient(
      { primary_action_page_id: 'page-1' },
      {
        title: 'Book a demo',
        slug: 'demo',
        bot_send_instructions: null,
        status: 'published',
      },
    )
    const out = await loadPrimaryGoalInstruction(c, userId)
    expect(out).not.toContain('When to send / what to say')
    expect(out).toContain('Book a demo')
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm vitest run src/lib/chatbot/primary-goal.test.ts`
Expected: FAIL — module `./primary-goal` does not exist.

- [ ] **Step 3: Implement the helper**

`src/lib/chatbot/primary-goal.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { publicActionPageUrl } from '@/lib/action-pages/urls'

interface ConfigRow {
  primary_action_page_id: string | null
}

interface PageRow {
  title: string
  slug: string
  bot_send_instructions: string | null
  status: string
}

/**
 * Returns a fully-formatted "primary goal" instruction block for the system
 * prompt, or null when no goal is set / the page was deleted / the page is
 * not currently published.
 */
export async function loadPrimaryGoalInstruction(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data: cfg, error: cErr } = await supabase
    .from('chatbot_configs')
    .select('primary_action_page_id')
    .eq('user_id', userId)
    .maybeSingle<ConfigRow>()
  if (cErr) throw new Error(`loadPrimaryGoalInstruction config: ${cErr.message}`)
  if (!cfg?.primary_action_page_id) return null

  const { data: page, error: pErr } = await supabase
    .from('action_pages')
    .select('title, slug, bot_send_instructions, status')
    .eq('id', cfg.primary_action_page_id)
    .eq('status', 'published')
    .maybeSingle<PageRow>()
  if (pErr) throw new Error(`loadPrimaryGoalInstruction page: ${pErr.message}`)
  if (!page) return null

  const trigger = page.bot_send_instructions?.trim()
  const lines = [
    'Your primary goal is to guide the conversation toward sharing this page with the customer when it fits naturally:',
    '',
    `Page: ${page.title}`,
    `Link: ${publicActionPageUrl(page.slug)}`,
  ]
  if (trigger) {
    lines.push('', 'When to send / what to say:', trigger)
  }
  lines.push(
    '',
    "Continue answering the customer's actual questions first. When the conversation is open-ended, winding down, or the customer asks generally about what you offer, steer toward this page. Do not force it if the customer's intent clearly points elsewhere.",
  )
  return lines.join('\n')
}
```

- [ ] **Step 4: Run tests, confirm pass**

Run: `pnpm vitest run src/lib/chatbot/primary-goal.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chatbot/primary-goal.ts src/lib/chatbot/primary-goal.test.ts
git commit -m "feat(chatbot): add loadPrimaryGoalInstruction helper"
```

---

## Task 4: Wire primary goal into `answer.ts` prompt assembly

**Files:**
- Modify: `src/lib/chatbot/answer.ts`

Precedence: campaign `funnelInstruction` > chatbot primary goal > nothing.

- [ ] **Step 1: Add the helper call**

In `src/lib/chatbot/answer.ts`, change the imports to include the new helper:

```ts
import { getChatbotConfig } from './config'
import { loadPrimaryGoalInstruction } from './primary-goal'
```

Replace the config-merge block (currently around the section starting `const baseConfig = await getChatbotConfig(...)`) with:

```ts
const baseConfig = await getChatbotConfig(supabase, userId)
const cp = options.campaignPersona

// Resolve the primary goal block: campaign funnelInstruction wins; otherwise
// fall back to the chatbot's configured primary action page.
const campaignGoal = cp?.funnelInstruction?.trim()
const chatbotGoal = campaignGoal
  ? null
  : await loadPrimaryGoalInstruction(supabase, userId)
const funnelInstruction = campaignGoal || chatbotGoal || undefined

const config = cp
  ? {
      ...baseConfig,
      ...(cp.persona ? { persona: cp.persona } : {}),
      doRules: [...baseConfig.doRules, ...(cp.doRules ?? [])],
      dontRules: [...baseConfig.dontRules, ...(cp.dontRules ?? [])],
      ...(funnelInstruction ? { funnelInstruction } : {}),
      ...(cp.instructions !== undefined ? { instructions: cp.instructions } : {}),
    }
  : funnelInstruction
    ? { ...baseConfig, funnelInstruction }
    : baseConfig
```

Note: `funnelInstruction` is already an optional field on `ChatbotPersona` (used by `buildPrompt`'s `goalSection`). Spreading it into the config object is the same wiring campaign overrides already use.

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Quick sanity test**

Run: `pnpm vitest run src/lib/chatbot`
Expected: existing tests still pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/chatbot/answer.ts
git commit -m "feat(chatbot): feed primary goal into system prompt when no campaign override"
```

---

## Task 5: `setPrimaryActionPage` server action

**Files:**
- Modify: `src/app/(app)/dashboard/chatbot/actions.ts`

- [ ] **Step 1: Add the server action**

Append to `src/app/(app)/dashboard/chatbot/actions.ts`:

```ts
import { setPrimaryActionPageId } from '@/lib/chatbot/config'

/**
 * Server action: set or clear the chatbot's primary goal action page.
 * Callable from the chatbot settings page, the action-pages list, and the
 * published-banner. Pass null to clear.
 */
export async function setPrimaryActionPage(
  actionPageId: string | null,
): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Validate ownership when a value is provided.
  if (actionPageId) {
    const { data: page } = await supabase
      .from('action_pages')
      .select('id, status')
      .eq('id', actionPageId)
      .eq('user_id', user.id)
      .maybeSingle<{ id: string; status: string }>()
    if (!page) throw new Error('action page not found')
    if (page.status !== 'published') throw new Error('action page not published')
  }

  await setPrimaryActionPageId(supabase, user.id, actionPageId)

  revalidatePath('/dashboard/chatbot')
  revalidatePath('/dashboard/action-pages')
}
```

Merge the `setPrimaryActionPageId` import with the existing `upsertChatbotConfig` import line.

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/dashboard/chatbot/actions.ts
git commit -m "feat(chatbot): server action to set chatbot primary action page"
```

---

## Task 6: Primary-goal dropdown on chatbot settings page

**Files:**
- Modify: `src/app/(app)/dashboard/chatbot/page.tsx`
- Create: `src/app/(app)/dashboard/chatbot/_components/PrimaryGoalSection.tsx`

- [ ] **Step 1: Add a client section component**

`src/app/(app)/dashboard/chatbot/_components/PrimaryGoalSection.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { setPrimaryActionPage } from '../actions'

export interface PrimaryGoalOption {
  id: string
  title: string
  slug: string
}

export function PrimaryGoalSection({
  current,
  options,
}: {
  current: string | null
  options: PrimaryGoalOption[]
}) {
  const [value, setValue] = useState<string>(current ?? '')
  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  function onChange(next: string) {
    setValue(next)
    setSaved(false)
    startTransition(async () => {
      await setPrimaryActionPage(next === '' ? null : next)
      setSaved(true)
    })
  }

  return (
    <div className="cb-section">
      <div className="cb-section-head">
        <h2>Primary goal</h2>
        <p>
          When set, your chatbot will gently steer open-ended conversations
          toward this page. Campaign-specific goals override this.
        </p>
      </div>
      <div className="cb-section-body">
        <div className="cb-field">
          <label htmlFor="primary-goal">Action page</label>
          <select
            id="primary-goal"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={pending}
          >
            <option value="">None</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </select>
          {pending && <span className="cb-muted">Saving…</span>}
          {saved && !pending && <span className="cb-muted">Saved</span>}
        </div>
        {options.length === 0 && (
          <p className="cb-muted">
            Publish an action page first to use it as a primary goal.
          </p>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Render it on the chatbot page**

In `src/app/(app)/dashboard/chatbot/page.tsx`, fetch published action pages for the user and pass to `PrimaryGoalSection`. Add (above the existing `ConfigForm`):

```tsx
import { PrimaryGoalSection, type PrimaryGoalOption } from './_components/PrimaryGoalSection'

// inside the page server component, after fetching `config` and `user`:
const { data: published } = await supabase
  .from('action_pages')
  .select('id, title, slug')
  .eq('user_id', user.id)
  .eq('status', 'published')
  .order('updated_at', { ascending: false })

const goalOptions: PrimaryGoalOption[] = (published ?? []).map((p) => ({
  id: p.id as string,
  title: p.title as string,
  slug: p.slug as string,
}))
```

Then render `<PrimaryGoalSection current={config.primaryActionPageId} options={goalOptions} />` immediately before the existing `<ConfigForm ... />`.

If `page.tsx` already passes `actionPages` to `ConfigForm`, you may reuse that fetch — but only if it filters `status='published'`. Confirm before reusing; otherwise issue a separate query as above.

- [ ] **Step 3: Smoke test**

Run: `pnpm dev`, log in, visit `/dashboard/chatbot`. Confirm:
- The "Primary goal" section renders above personality.
- The dropdown lists only published action pages.
- Changing it saves (no error toast) and persists on reload.
- Setting "None" clears it.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/dashboard/chatbot/page.tsx src/app/\(app\)/dashboard/chatbot/_components/PrimaryGoalSection.tsx
git commit -m "feat(chatbot): primary goal section on chatbot settings"
```

---

## Task 7: Surface goal on action-pages list

**Files:**
- Modify: `src/app/(app)/dashboard/action-pages/_lib/queries.ts`
- Modify: `src/app/(app)/dashboard/action-pages/page.tsx`
- Modify: `src/app/(app)/dashboard/action-pages/_components/ActionPagesList.tsx`

- [ ] **Step 1: Extend `ActionPageListItem` with a flag and load the current primary goal**

In `src/app/(app)/dashboard/action-pages/_lib/queries.ts`, add a new exported helper:

```ts
export async function fetchPrimaryActionPageId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('chatbot_configs')
    .select('primary_action_page_id')
    .eq('user_id', userId)
    .maybeSingle<{ primary_action_page_id: string | null }>()
  if (error) throw new Error(`fetchPrimaryActionPageId: ${error.message}`)
  return data?.primary_action_page_id ?? null
}
```

(`ActionPageListItem` itself stays as-is; the flag is computed in the page and passed alongside.)

- [ ] **Step 2: Pass the current id through the page**

In `src/app/(app)/dashboard/action-pages/page.tsx`, inside the `List()` async function, after `const pages = ...`:

```ts
const primaryId = await fetchPrimaryActionPageId(supabase, user.id)
return <ActionPagesList pages={pages} primaryActionPageId={primaryId} />
```

Add the import at the top:

```ts
import { fetchActionPages, fetchPrimaryActionPageId } from './_lib/queries'
```

- [ ] **Step 3: Render the badge and row action**

In `ActionPagesList.tsx`:

1. Add `primaryActionPageId: string | null` to the component's prop type.
2. Where each row is rendered (in table and grid view), if `page.id === primaryActionPageId` show a small badge with the text "Primary goal" near the title.
3. Add a row action button "Set as primary goal" / "Clear primary goal":
   - For `status='published'` and `page.id !== primaryActionPageId`: button labeled "Set as primary goal", calls `setPrimaryActionPage(page.id)`.
   - For `status='published'` and `page.id === primaryActionPageId`: button labeled "Clear primary goal", calls `setPrimaryActionPage(null)`.
   - For `status !== 'published'`: render disabled button with title attribute `"Publish to use as primary goal"`.

Pseudocode (place wherever row controls live):

```tsx
import { setPrimaryActionPage } from '../../chatbot/actions'

function PrimaryGoalControl({
  page,
  isPrimary,
}: {
  page: ActionPageListItem
  isPrimary: boolean
}) {
  const [pending, startTransition] = useTransition()
  if (page.status !== 'published') {
    return (
      <button
        type="button"
        className="apl-row-btn"
        disabled
        title="Publish to use as primary goal"
      >
        Set as primary goal
      </button>
    )
  }
  return (
    <button
      type="button"
      className="apl-row-btn"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await setPrimaryActionPage(isPrimary ? null : page.id)
        })
      }
    >
      {isPrimary ? 'Clear primary goal' : 'Set as primary goal'}
    </button>
  )
}
```

And the badge near the title:

```tsx
{isPrimary && <span className="apl-badge apl-badge-primary">Primary goal</span>}
```

Add `useTransition` to the existing react import.

- [ ] **Step 4: Smoke test**

Run dev server, visit `/dashboard/action-pages`. Confirm:
- Published page shows "Set as primary goal" button; clicking it adds the "Primary goal" badge and the same button on other rows still says "Set as primary goal".
- Click "Clear primary goal" — badge disappears.
- Draft rows show the disabled button with the tooltip.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/dashboard/action-pages/_lib/queries.ts src/app/\(app\)/dashboard/action-pages/page.tsx src/app/\(app\)/dashboard/action-pages/_components/ActionPagesList.tsx
git commit -m "feat(action-pages): show primary-goal badge and row action"
```

---

## Task 8: Detect first-time publish in `updateActionPage`

**Files:**
- Modify: `src/app/(app)/dashboard/action-pages/actions/crud.ts`

This task changes only the publish detection + redirect logic. The banner UI is Task 9.

- [ ] **Step 1: Read existing status before update**

In `updateActionPage` inside `src/app/(app)/dashboard/action-pages/actions/crud.ts`, the existing block:

```ts
const { data: existing } = await supabase
  .from('action_pages')
  .select('slug, kind')
  .eq('id', parsed.data.id)
  .eq('user_id', userId)
  .maybeSingle<{ slug: string; kind: string }>()
```

Expand the select to include `status` and `title`:

```ts
const { data: existing } = await supabase
  .from('action_pages')
  .select('slug, kind, status, title')
  .eq('id', parsed.data.id)
  .eq('user_id', userId)
  .maybeSingle<{ slug: string; kind: string; status: 'draft' | 'published' | 'archived'; title: string }>()
```

- [ ] **Step 2: Apply auto-default or queue a publish-prompt query param**

Immediately after the existing `revalidatePath`/`updateTag` block but **before** the final `redirect(...)` at the end of `updateActionPage`, add:

```ts
// Detect first-time draft -> published transition and decide whether to
// silently auto-assign as the chatbot's primary goal, or redirect with a
// query param so a banner can prompt the user.
let primaryGoalRedirect: 'offer' | 'switch' | null = null
if (existing && existing.status === 'draft' && parsed.data.status === 'published') {
  const { data: cfg } = await supabase
    .from('chatbot_configs')
    .select('primary_action_page_id')
    .eq('user_id', userId)
    .maybeSingle<{ primary_action_page_id: string | null }>()
  const currentGoalId = cfg?.primary_action_page_id ?? null

  if (currentGoalId === parsed.data.id) {
    // Already the goal — nothing to do.
  } else if (currentGoalId === null) {
    // No goal yet. Count user's other published pages.
    const { count } = await supabase
      .from('action_pages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'published')
      .neq('id', parsed.data.id)
    if ((count ?? 0) === 0) {
      // First published page — silently auto-assign.
      await supabase
        .from('chatbot_configs')
        .upsert(
          { user_id: userId, primary_action_page_id: parsed.data.id },
          { onConflict: 'user_id' },
        )
      revalidatePath('/dashboard/chatbot')
      revalidatePath('/dashboard/action-pages')
    } else {
      primaryGoalRedirect = 'offer'
    }
  } else {
    primaryGoalRedirect = 'switch'
  }
}

const params = new URLSearchParams({ saved: '1' })
if (primaryGoalRedirect) {
  params.set('just_published', '1')
  params.set('offer_primary', primaryGoalRedirect)
}
redirect(`/dashboard/action-pages/${parsed.data.id}?${params.toString()}`)
```

Replace the existing final `redirect(...)` line with the constructed URL above.

- [ ] **Step 3: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/dashboard/action-pages/actions/crud.ts
git commit -m "feat(action-pages): detect first publish and steer chatbot primary goal"
```

---

## Task 9: Published-primary-goal banner component

**Files:**
- Create: `src/app/(app)/dashboard/action-pages/_components/PublishedPrimaryGoalBanner.tsx`
- Modify: the action-page editor shell that already renders the saved/error banners (most likely `src/app/(app)/dashboard/action-pages/[id]/page.tsx` or the kind-specific `*Shell.tsx` — locate by searching for `searchParams.saved`).

- [ ] **Step 1: Locate the existing editor entry-point**

Run: `rg "searchParams" src/app/\(app\)/dashboard/action-pages/\[id\] -n | head`
Identify the file that reads `searchParams` and renders the edit shell. That's where the banner mounts.

- [ ] **Step 2: Create the banner**

`src/app/(app)/dashboard/action-pages/_components/PublishedPrimaryGoalBanner.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { setPrimaryActionPage } from '../../chatbot/actions'

export function PublishedPrimaryGoalBanner({
  actionPageId,
  mode,
  currentGoalTitle,
}: {
  actionPageId: string
  mode: 'offer' | 'switch'
  currentGoalTitle: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function dismiss() {
    const url = new URL(window.location.href)
    url.searchParams.delete('just_published')
    url.searchParams.delete('offer_primary')
    router.replace(url.pathname + (url.search ? url.search : ''))
  }

  function accept() {
    startTransition(async () => {
      await setPrimaryActionPage(actionPageId)
      dismiss()
    })
  }

  const heading =
    mode === 'switch'
      ? `This page is published. Replace your current primary goal${
          currentGoalTitle ? ` ("${currentGoalTitle}")` : ''
        } with this one?`
      : "This page is published. Make it your chatbot's primary goal?"

  const acceptLabel = mode === 'switch' ? 'Replace' : 'Set as primary goal'
  const dismissLabel = mode === 'switch' ? 'Keep current' : 'Not now'

  return (
    <div className="ap-banner ap-banner-info" role="status">
      <p>{heading}</p>
      <div className="ap-banner-actions">
        <button type="button" onClick={accept} disabled={pending}>
          {acceptLabel}
        </button>
        <button type="button" onClick={dismiss} disabled={pending}>
          {dismissLabel}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Mount the banner in the editor page**

In the editor server component identified in Step 1 (the page that handles `/dashboard/action-pages/[id]`):

```tsx
import { PublishedPrimaryGoalBanner } from '../_components/PublishedPrimaryGoalBanner'

// inside the component, after fetching the page and user:
const justPublished = searchParams?.just_published === '1'
const offerMode =
  searchParams?.offer_primary === 'switch'
    ? ('switch' as const)
    : searchParams?.offer_primary === '1'
      ? ('offer' as const)
      : null

let currentGoalTitle: string | null = null
if (justPublished && offerMode === 'switch') {
  const { data: cfg } = await supabase
    .from('chatbot_configs')
    .select('primary_action_page_id')
    .eq('user_id', user.id)
    .maybeSingle<{ primary_action_page_id: string | null }>()
  if (cfg?.primary_action_page_id) {
    const { data: cur } = await supabase
      .from('action_pages')
      .select('title')
      .eq('id', cfg.primary_action_page_id)
      .maybeSingle<{ title: string }>()
    currentGoalTitle = cur?.title ?? null
  }
}

// in the JSX, above the existing edit shell:
{justPublished && offerMode && (
  <PublishedPrimaryGoalBanner
    actionPageId={page.id}
    mode={offerMode}
    currentGoalTitle={currentGoalTitle}
  />
)}
```

If `searchParams` is a Promise in this codebase (Next 15+), `await` it. Match the surrounding file's existing pattern.

- [ ] **Step 4: Smoke test the 4-case matrix**

In dev, manually test each branch:

| Setup | Action | Expected |
| --- | --- | --- |
| No primary goal, no other published pages | Publish a draft | No banner; primary goal is silently set; chatbot settings page now shows the page as goal |
| No primary goal, ≥1 other published page | Publish a draft | Banner reading "Make it your chatbot's primary goal?"; clicking Set as primary goal sets it and dismisses |
| Primary goal = page A, publishing page B | Publish B | Banner reading "Replace your current primary goal ("A") with this one?"; Replace switches; Keep current dismisses without change |
| Primary goal = page A, re-publishing page A | (e.g. status flip) | No banner |

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/dashboard/action-pages/_components/PublishedPrimaryGoalBanner.tsx src/app/\(app\)/dashboard/action-pages/\[id\]
git commit -m "feat(action-pages): published primary-goal banner"
```

---

## Task 10: End-to-end manual verification

**Files:** none

- [ ] **Step 1: Verify prompt injection**

In the chatbot test harness (`/api/chatbot/test` or the in-dashboard tester):

1. Set a primary goal in chatbot settings.
2. Send a generic message ("hi, what do you offer?").
3. Confirm the bot's reply references the goal page link or topic.
4. Send a clearly off-topic message ("what's the weather?") — confirm the bot does *not* force the goal page.

- [ ] **Step 2: Verify campaign override precedence**

If a campaign with `funnelInstruction` exists, send messages from a lead assigned to it and confirm the campaign goal — not the chatbot goal — appears in the system prompt (inspect logs or dump the assembled system message).

- [ ] **Step 3: Verify auto-default fires only once**

1. Delete `chatbot_configs.primary_action_page_id` for the test user.
2. Confirm there are no published pages.
3. Publish a draft. Confirm the column is now set.
4. Publish a second draft. Confirm: the auto-default does *not* re-run (the existing goal stays), and the offer-banner appears instead.

- [ ] **Step 4: Final commit (if anything needed tweaking)**

```bash
git commit -am "chore: tweaks from manual verification"
```

---

## Self-Review

**Spec coverage:**
- Data model column → Task 1, 2 ✓
- `loadPrimaryGoalInstruction` helper → Task 3 ✓
- `answer.ts` precedence wiring → Task 4 ✓
- `setPrimaryActionPage` server action → Task 5 ✓
- Chatbot settings dropdown → Task 6 ✓
- Action-pages list badge + row action → Task 7 ✓
- First-publish detection (4-case matrix) → Task 8 + 9 ✓
- Banner UI → Task 9 ✓
- Edge cases (deleted/non-published page) → covered by `loadPrimaryGoalInstruction` filter in Task 3 ✓
- Campaign override precedence → Task 4 (`campaignGoal` short-circuit) ✓

**Placeholder scan:** no TBDs; all code blocks contain runnable code; commands are concrete.

**Type consistency:** `setPrimaryActionPageId` (lib helper) vs `setPrimaryActionPage` (server action) are intentionally different names so callers go through the server action; both are referenced consistently. `primaryActionPageId` (TS field) matches `primary_action_page_id` (DB column) throughout.

**Status terminology:** uses `'published'` consistently (matches `action_pages.status` enum).
