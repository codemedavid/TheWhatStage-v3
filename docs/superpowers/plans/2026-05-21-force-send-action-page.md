# Force-Send Action Page on Ready Intent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deterministically attach the primary (or fallback) action page button to the LLM reply whenever the lead is qualified AND signals readiness to proceed — bypassing the LLM's tendency to stall.

**Architecture:** A new module `src/lib/action-pages/force-send.ts` runs as a post-process step inside `answerWithClassification` after the LLM returns. It uses an in-memory cache (`src/lib/leads/cache.ts`) for the most expensive qualification check (instruction-based prerequisite detection). Two surgical system-prompt edits (in `primary-goal.ts` and `classify.ts`) make the LLM more often agree with the override on its own.

**Tech Stack:** TypeScript, vitest, Supabase JS client, Next.js (App Router), OpenAI-compatible LLM client (`HfRouterLlm` over `RAG_LLM_API_KEY`).

**Spec:** `docs/superpowers/specs/2026-05-21-force-send-action-page-design.md`

**Test runner:** `pnpm test -- <pattern>` (vitest).

**File inventory:**
- Create: `src/lib/leads/cache.ts`, `src/lib/leads/cache.test.ts`
- Create: `src/lib/action-pages/force-send.ts`, `src/lib/action-pages/force-send.test.ts`
- Modify: `src/lib/chatbot/primary-goal.ts`, `src/lib/chatbot/primary-goal.test.ts`
- Modify: `src/lib/chatbot/classify.ts`, `src/lib/chatbot/classify.test.ts` (or new force-send wiring test)
- Modify: `src/app/api/messenger/process/route.ts`

---

### Task 1: Lead-scoped in-memory cache

**Files:**
- Create: `src/lib/leads/cache.ts`
- Test: `src/lib/leads/cache.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/leads/cache.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import {
  __leadCacheResetForTests,
  leadCacheClear,
  leadCacheGet,
  leadCacheSet,
} from './cache'

describe('leads/cache', () => {
  afterEach(() => __leadCacheResetForTests())

  it('returns undefined when key not set', () => {
    expect(leadCacheGet('ns', 'lead-1', 'k')).toBeUndefined()
  })

  it('round-trips a value under (namespace, leadId, key)', () => {
    leadCacheSet<number>('ns', 'lead-1', 'k', 42)
    expect(leadCacheGet<number>('ns', 'lead-1', 'k')).toBe(42)
  })

  it('does not leak between leads with the same namespace+key', () => {
    leadCacheSet('ns', 'lead-1', 'k', 'A')
    leadCacheSet('ns', 'lead-2', 'k', 'B')
    expect(leadCacheGet('ns', 'lead-1', 'k')).toBe('A')
    expect(leadCacheGet('ns', 'lead-2', 'k')).toBe('B')
  })

  it('does not leak between namespaces with the same leadId+key', () => {
    leadCacheSet('nsA', 'lead-1', 'k', 1)
    leadCacheSet('nsB', 'lead-1', 'k', 2)
    expect(leadCacheGet('nsA', 'lead-1', 'k')).toBe(1)
    expect(leadCacheGet('nsB', 'lead-1', 'k')).toBe(2)
  })

  it('leadCacheClear removes all entries for a single lead', () => {
    leadCacheSet('nsA', 'lead-1', 'k', 1)
    leadCacheSet('nsB', 'lead-1', 'k', 2)
    leadCacheSet('nsA', 'lead-2', 'k', 9)
    leadCacheClear('lead-1')
    expect(leadCacheGet('nsA', 'lead-1', 'k')).toBeUndefined()
    expect(leadCacheGet('nsB', 'lead-1', 'k')).toBeUndefined()
    expect(leadCacheGet('nsA', 'lead-2', 'k')).toBe(9)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/leads/cache.test.ts`
Expected: FAIL with `Cannot find module './cache'`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/leads/cache.ts`:

```ts
const store = new Map<string, unknown>()

function makeKey(namespace: string, leadId: string, key: string): string {
  return `${namespace}:${leadId}:${key}`
}

export function leadCacheGet<T>(namespace: string, leadId: string, key: string): T | undefined {
  return store.get(makeKey(namespace, leadId, key)) as T | undefined
}

export function leadCacheSet<T>(namespace: string, leadId: string, key: string, value: T): void {
  store.set(makeKey(namespace, leadId, key), value)
}

export function leadCacheClear(leadId: string): void {
  const suffix = `:${leadId}:`
  for (const k of store.keys()) {
    if (k.includes(suffix)) store.delete(k)
  }
}

export function __leadCacheResetForTests(): void {
  store.clear()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/leads/cache.test.ts`
Expected: PASS (5 cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/leads/cache.ts src/lib/leads/cache.test.ts
git commit -m "feat(leads): in-memory namespaced lead cache"
```

---

### Task 2: Skip-stage and page-resolver helpers

**Files:**
- Create: `src/lib/action-pages/force-send.ts` (initial skeleton with two exports)
- Test: `src/lib/action-pages/force-send.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/action-pages/force-send.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ActionPageBrief, StageBrief } from '@/lib/chatbot/classify'
import { isSendableStage, resolveFallbackFromList } from './force-send'

const stage = (kind: StageBrief['kind']): StageBrief => ({
  id: 's1',
  name: 'Stage',
  description: null,
  position: 1,
  kind,
})

describe('isSendableStage', () => {
  it('returns true when stage is null', () => {
    expect(isSendableStage(null)).toBe(true)
  })

  it.each(['lost', 'dormant', 'won'] as const)('returns false for kind %s', (k) => {
    expect(isSendableStage(stage(k))).toBe(false)
  })

  it.each(['entry', 'qualifying', 'nurture', 'decision'] as const)(
    'returns true for kind %s',
    (k) => {
      expect(isSendableStage(stage(k))).toBe(true)
    },
  )
})

describe('resolveFallbackFromList', () => {
  const pageA: ActionPageBrief = { id: 'a', title: 'A', cta_label: 'a', bot_send_instructions: '' }
  const pageB: ActionPageBrief = { id: 'b', title: 'B', cta_label: 'b', bot_send_instructions: '' }

  it('returns the primary when found in the list', () => {
    const r = resolveFallbackFromList('b', [pageA, pageB])
    expect(r?.id).toBe('b')
  })

  it('returns the first page when primary id is null', () => {
    const r = resolveFallbackFromList(null, [pageA, pageB])
    expect(r?.id).toBe('a')
  })

  it('returns null when primary id is set but not in list and list empty', () => {
    expect(resolveFallbackFromList('x', [])).toBeNull()
  })

  it('returns null when primary id is null and list empty', () => {
    expect(resolveFallbackFromList(null, [])).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/action-pages/force-send.test.ts`
Expected: FAIL with `Cannot find module './force-send'`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/action-pages/force-send.ts`:

```ts
import type { ActionPageBrief, StageBrief } from '@/lib/chatbot/classify'

const SKIP_STAGE_KINDS = new Set(['lost', 'dormant', 'won'])

export function isSendableStage(stage: StageBrief | null): boolean {
  if (!stage) return true
  return !SKIP_STAGE_KINDS.has(stage.kind)
}

/**
 * Pick the page to force-send. Primary id wins when it's in the published
 * `actionPages` list (these are the same pages that were passed to the LLM).
 * When no primary is configured, fall back to the first page in the list —
 * the worker loads pages with `order by updated_at desc`, so "first" == most
 * recently updated published page. Returns null when no candidate exists.
 */
export function resolveFallbackFromList(
  primaryId: string | null,
  pages: ActionPageBrief[],
): ActionPageBrief | null {
  if (primaryId) return pages.find((p) => p.id === primaryId) ?? null
  return pages[0] ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/action-pages/force-send.test.ts`
Expected: PASS (8 cases counting `it.each` expansions).

- [ ] **Step 5: Commit**

```bash
git add src/lib/action-pages/force-send.ts src/lib/action-pages/force-send.test.ts
git commit -m "feat(action-pages): skip-stage + fallback helpers for force-send"
```

---

### Task 3: Stage-forward + verbal-regex helpers

**Files:**
- Modify: `src/lib/action-pages/force-send.ts` (add two exports)
- Modify: `src/lib/action-pages/force-send.test.ts` (add a `describe` block per helper)

- [ ] **Step 1: Write the failing test**

Append to `src/lib/action-pages/force-send.test.ts`:

```ts
import { detectProceedRegex, detectStageForward } from './force-send'
import type { StageChange } from '@/lib/chatbot/classify'

describe('detectProceedRegex', () => {
  it.each([
    'sige po, kunin ko na',
    'Sige na',
    'magkano po yung small?',
    'paano mag-avail',
    'paano magbayad',
    "let's go",
    "I'm in",
    'book na ako',
    'tara na po',
    'sign me up',
    'game na ako',
    'okay na po ako',
    'ready na ako',
    'gusto ko na po',
    'interested po',
    'paano sumali',
    'how do I sign up',
    'how much po',
  ])('matches proceed signal "%s"', (msg) => {
    expect(detectProceedRegex(msg)).toBe(true)
  })

  it.each([
    'hello po',
    'good morning',
    'what do you sell',
    'magandang umaga po',
    '',
  ])('does not match small talk "%s"', (msg) => {
    expect(detectProceedRegex(msg)).toBe(false)
  })
})

describe('detectStageForward', () => {
  const stages: StageBrief[] = [
    { id: 'entry', name: 'Entry', description: null, position: 0, kind: 'entry' },
    { id: 'nurt', name: 'Nurture', description: null, position: 1, kind: 'nurture' },
    { id: 'qual', name: 'Qualifying', description: null, position: 2, kind: 'qualifying' },
    { id: 'dec', name: 'Decision', description: null, position: 3, kind: 'decision' },
    { id: 'won', name: 'Won', description: null, position: 4, kind: 'won' },
  ]

  it('returns false when stageChange is null', () => {
    expect(detectStageForward(null, 1, stages)).toBe(false)
  })

  it('returns false when target stage is unknown', () => {
    const change: StageChange = { to_stage_id: 'ghost', confidence: 'high', reason: '' }
    expect(detectStageForward(change, 1, stages)).toBe(false)
  })

  it('returns true when target is qualifying-kind regardless of position', () => {
    const change: StageChange = { to_stage_id: 'qual', confidence: 'low', reason: '' }
    expect(detectStageForward(change, 2, stages)).toBe(true)
  })

  it('returns true when target position >= current', () => {
    const change: StageChange = { to_stage_id: 'nurt', confidence: 'low', reason: '' }
    expect(detectStageForward(change, 1, stages)).toBe(true)
  })

  it('returns false when target position < current and kind not qualifying/decision/won', () => {
    const change: StageChange = { to_stage_id: 'entry', confidence: 'high', reason: '' }
    expect(detectStageForward(change, 2, stages)).toBe(false)
  })

  it('returns true when target is decision-kind even backward', () => {
    const change: StageChange = { to_stage_id: 'dec', confidence: 'high', reason: '' }
    expect(detectStageForward(change, 4, stages)).toBe(true)
  })

  it('returns true when currentPosition is null (no current stage)', () => {
    const change: StageChange = { to_stage_id: 'nurt', confidence: 'low', reason: '' }
    expect(detectStageForward(change, null, stages)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/action-pages/force-send.test.ts`
Expected: FAIL — `detectProceedRegex is not a function` and `detectStageForward is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/action-pages/force-send.ts`:

```ts
import type { StageChange } from '@/lib/chatbot/classify'

const PROCEED_RE =
  /\b(sige|kunin ko|let'?s go|i'?m in|game na|okay na|magkano|how (do i|much)|paano (mag|sumali|umorder|magbayad|avail)|sign me up|book na|tara|gusto ko na|ready na|proceed|interested po|payment|bayad)\b/i

export function detectProceedRegex(message: string): boolean {
  if (!message) return false
  return PROCEED_RE.test(message)
}

const FORWARD_KINDS = new Set(['qualifying', 'decision', 'won'])

export function detectStageForward(
  change: StageChange | null,
  currentPosition: number | null,
  stages: StageBrief[],
): boolean {
  if (!change) return false
  const to = stages.find((s) => s.id === change.to_stage_id)
  if (!to) return false
  if (FORWARD_KINDS.has(to.kind)) return true
  if (currentPosition === null) return true
  return to.position >= currentPosition
}
```

Note: `StageChange` and `StageBrief` are already imported at the top of the file from Task 2.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/action-pages/force-send.test.ts`
Expected: PASS (all cases — regex covers TL+EN, stage-forward covers null/unknown/forward/backward/kind-override paths).

- [ ] **Step 5: Commit**

```bash
git add src/lib/action-pages/force-send.ts src/lib/action-pages/force-send.test.ts
git commit -m "feat(action-pages): proceed-intent regex + stage-forward detector"
```

---

### Task 4: Qualification check A & B (stage-kind, quiz submission)

**Files:**
- Modify: `src/lib/action-pages/force-send.ts` (add two exports)
- Modify: `src/lib/action-pages/force-send.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/action-pages/force-send.test.ts`:

```ts
import { hasQualifiedQuizSubmission, isStageQualified } from './force-send'

describe('isStageQualified', () => {
  it('returns false when stage is null', () => {
    expect(isStageQualified(null)).toBe(false)
  })

  it.each(['qualifying', 'decision'] as const)('returns true for kind %s', (k) => {
    expect(isStageQualified(stage(k))).toBe(true)
  })

  it.each(['entry', 'nurture', 'lost', 'dormant', 'won'] as const)(
    'returns false for kind %s',
    (k) => {
      expect(isStageQualified(stage(k))).toBe(false)
    },
  )
})

describe('hasQualifiedQuizSubmission', () => {
  function mockSupabase(rows: Array<{ outcome: string; action_pages: { kind: string } }>) {
    return {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({ data: rows, error: null }),
              }),
            }),
          }),
        }),
      }),
    } as unknown as Parameters<typeof hasQualifiedQuizSubmission>[0]
  }

  it('returns true when a qualified submission on a qualification page exists', async () => {
    const s = mockSupabase([{ outcome: 'qualified', action_pages: { kind: 'qualification' } }])
    expect(await hasQualifiedQuizSubmission(s, 'lead-1')).toBe(true)
  })

  it('ignores non-qualification page submissions', async () => {
    const s = mockSupabase([{ outcome: 'qualified', action_pages: { kind: 'form' } }])
    expect(await hasQualifiedQuizSubmission(s, 'lead-1')).toBe(false)
  })

  it('ignores submissions whose outcome is not "qualified"', async () => {
    const s = mockSupabase([{ outcome: 'pending_review', action_pages: { kind: 'qualification' } }])
    expect(await hasQualifiedQuizSubmission(s, 'lead-1')).toBe(false)
  })

  it('returns false when no submissions found', async () => {
    const s = mockSupabase([])
    expect(await hasQualifiedQuizSubmission(s, 'lead-1')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/action-pages/force-send.test.ts`
Expected: FAIL — `isStageQualified is not a function` and `hasQualifiedQuizSubmission is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/action-pages/force-send.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

const QUALIFIED_STAGE_KINDS = new Set(['qualifying', 'decision'])

export function isStageQualified(stage: StageBrief | null): boolean {
  if (!stage) return false
  return QUALIFIED_STAGE_KINDS.has(stage.kind)
}

interface SubmissionRow {
  outcome: string | null
  action_pages: { kind: string } | { kind: string }[] | null
}

export async function hasQualifiedQuizSubmission(
  supabase: SupabaseClient,
  leadId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('action_page_submissions')
    .select('outcome, action_pages(kind)')
    .eq('lead_id', leadId)
    .eq('outcome', 'qualified')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error || !data) return false

  for (const row of data as unknown as SubmissionRow[]) {
    const ap = Array.isArray(row.action_pages) ? row.action_pages[0] : row.action_pages
    if (ap?.kind === 'qualification') return true
  }
  return false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/action-pages/force-send.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/action-pages/force-send.ts src/lib/action-pages/force-send.test.ts
git commit -m "feat(action-pages): stage-kind + quiz-submission qualification checks"
```

---

### Task 5: Qualification check C — instruction-based via LLM, with cache

**Files:**
- Modify: `src/lib/action-pages/force-send.ts` (add two exports + new dep on `leads/cache`)
- Modify: `src/lib/action-pages/force-send.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/action-pages/force-send.test.ts`:

```ts
import { vi, beforeEach } from 'vitest'
import { __leadCacheResetForTests } from '@/lib/leads/cache'
import {
  hashInstructions,
  prerequisitesAnsweredCached,
  type LlmCheckClient,
} from './force-send'

beforeEach(() => __leadCacheResetForTests())

describe('hashInstructions', () => {
  it('produces a stable hex string', () => {
    expect(hashInstructions('hello')).toBe(hashInstructions('hello'))
  })

  it('differs when text differs', () => {
    expect(hashInstructions('a')).not.toBe(hashInstructions('b'))
  })

  it('returns the same hash for empty / whitespace inputs', () => {
    expect(hashInstructions('')).toBe(hashInstructions(''))
  })
})

describe('prerequisitesAnsweredCached', () => {
  const history = [{ role: 'user' as const, content: 'My budget is 50k and I want delivery next week' }]
  const instructions = 'Ask for budget and delivery timeline before sending'

  it('calls the LLM once and caches the result for a (leadId, pageId, hash) key', async () => {
    const fake: LlmCheckClient = {
      checkPrerequisites: vi.fn(async () => true),
    }

    const first = await prerequisitesAnsweredCached({
      leadId: 'lead-1',
      actionPageId: 'page-1',
      instructionsText: instructions,
      history,
      llm: fake,
    })
    const second = await prerequisitesAnsweredCached({
      leadId: 'lead-1',
      actionPageId: 'page-1',
      instructionsText: instructions,
      history,
      llm: fake,
    })

    expect(first).toBe(true)
    expect(second).toBe(true)
    expect(fake.checkPrerequisites).toHaveBeenCalledTimes(1)
  })

  it('recomputes when instructions text changes (hash differs)', async () => {
    const fake: LlmCheckClient = {
      checkPrerequisites: vi.fn(async () => true),
    }

    await prerequisitesAnsweredCached({
      leadId: 'lead-1',
      actionPageId: 'page-1',
      instructionsText: 'old text',
      history,
      llm: fake,
    })
    await prerequisitesAnsweredCached({
      leadId: 'lead-1',
      actionPageId: 'page-1',
      instructionsText: 'new text',
      history,
      llm: fake,
    })

    expect(fake.checkPrerequisites).toHaveBeenCalledTimes(2)
  })

  it('returns true without calling the LLM when instructionsText is empty', async () => {
    const fake: LlmCheckClient = { checkPrerequisites: vi.fn(async () => false) }
    const r = await prerequisitesAnsweredCached({
      leadId: 'lead-1',
      actionPageId: 'page-1',
      instructionsText: '',
      history,
      llm: fake,
    })
    expect(r).toBe(true)
    expect(fake.checkPrerequisites).not.toHaveBeenCalled()
  })

  it('does not cache when the LLM returns false (so a later turn can succeed)', async () => {
    const fake: LlmCheckClient = {
      checkPrerequisites: vi
        .fn<LlmCheckClient['checkPrerequisites']>()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
    }

    const first = await prerequisitesAnsweredCached({
      leadId: 'lead-1',
      actionPageId: 'page-1',
      instructionsText: instructions,
      history,
      llm: fake,
    })
    const second = await prerequisitesAnsweredCached({
      leadId: 'lead-1',
      actionPageId: 'page-1',
      instructionsText: instructions,
      history,
      llm: fake,
    })

    expect(first).toBe(false)
    expect(second).toBe(true)
    expect(fake.checkPrerequisites).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/action-pages/force-send.test.ts`
Expected: FAIL — `hashInstructions`, `prerequisitesAnsweredCached`, `LlmCheckClient` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/action-pages/force-send.ts`:

```ts
import { createHash } from 'node:crypto'
import { leadCacheGet, leadCacheSet } from '@/lib/leads/cache'
import type { AnswerHistory } from '@/lib/chatbot/answer'

export interface LlmCheckClient {
  checkPrerequisites(args: { instructionsText: string; history: AnswerHistory }): Promise<boolean>
}

export function hashInstructions(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

interface CacheEntry {
  hash: string
  allAnswered: true
}

const CACHE_NS = 'qual_check'

export async function prerequisitesAnsweredCached(args: {
  leadId: string
  actionPageId: string
  instructionsText: string
  history: AnswerHistory
  llm: LlmCheckClient
}): Promise<boolean> {
  const text = args.instructionsText.trim()
  // No instructions = nothing to qualify against = trivially answered.
  if (!text) return true

  const hash = hashInstructions(text)
  const cached = leadCacheGet<CacheEntry>(CACHE_NS, args.leadId, args.actionPageId)
  if (cached && cached.hash === hash) return true

  const ok = await args.llm.checkPrerequisites({ instructionsText: text, history: args.history })
  if (ok) {
    leadCacheSet<CacheEntry>(CACHE_NS, args.leadId, args.actionPageId, {
      hash,
      allAnswered: true,
    })
  }
  return ok
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/action-pages/force-send.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/action-pages/force-send.ts src/lib/action-pages/force-send.test.ts
git commit -m "feat(action-pages): cached prerequisite-answered check via LLM"
```

---

### Task 6: Concrete LLM client for prerequisite + proceed checks

**Files:**
- Modify: `src/lib/action-pages/force-send.ts` (add default LLM client)
- Modify: `src/lib/action-pages/force-send.test.ts` (no test for the prod LLM client — it's a thin wrapper; integration tests in later tasks cover it)

- [ ] **Step 1: Write the failing test**

Append to `src/lib/action-pages/force-send.test.ts`:

```ts
import { parseLlmJsonResponse } from './force-send'

describe('parseLlmJsonResponse', () => {
  it('parses {"ok": true}', () => {
    expect(parseLlmJsonResponse('{"ok": true}')).toEqual({ ok: true })
  })

  it('parses {"ok": false}', () => {
    expect(parseLlmJsonResponse('{"ok": false}')).toEqual({ ok: false })
  })

  it('strips ```json fences', () => {
    expect(parseLlmJsonResponse('```json\n{"ok": true}\n```')).toEqual({ ok: true })
  })

  it('extracts the first {...} block when text contains prose', () => {
    expect(parseLlmJsonResponse('sure: {"ok": true} done')).toEqual({ ok: true })
  })

  it('returns { ok: false } on garbage input', () => {
    expect(parseLlmJsonResponse('lol no')).toEqual({ ok: false })
  })

  it('returns { ok: false } when ok is not a boolean', () => {
    expect(parseLlmJsonResponse('{"ok": "yes"}')).toEqual({ ok: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/action-pages/force-send.test.ts`
Expected: FAIL — `parseLlmJsonResponse is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/action-pages/force-send.ts`:

```ts
import { HfRouterLlm } from '@/lib/rag'
import { ragConfig } from '@/lib/rag/config'

export function parseLlmJsonResponse(raw: string): { ok: boolean } {
  if (!raw) return { ok: false }
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(stripped)
  } catch {
    const m = stripped.match(/\{[\s\S]*?\}/)
    if (!m) return { ok: false }
    try {
      parsed = JSON.parse(m[0])
    } catch {
      return { ok: false }
    }
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false }
  const ok = (parsed as { ok?: unknown }).ok
  return { ok: ok === true }
}

function formatRecentHistory(history: AnswerHistory, maxTurns = 6): string {
  if (history.length === 0) return '(no prior messages)'
  return history
    .slice(-maxTurns)
    .map((m) => `${m.role === 'assistant' ? 'Bot' : 'Customer'}: ${m.content}`)
    .join('\n')
}

/**
 * Production LLM client used by force-send. Two distinct prompts, both via
 * the cheap classifier model. Returns `{ok: bool}` from both calls.
 */
export const defaultLlmCheckClient: LlmCheckClient & {
  detectProceed(args: { history: AnswerHistory }): Promise<boolean>
} = {
  async checkPrerequisites({ instructionsText, history }) {
    const llm = new HfRouterLlm({ model: ragConfig.classifierModel })
    const system =
      'You decide whether every prerequisite question listed in the operator\'s "send when" guidance has already been answered in the conversation. ' +
      'Return JSON only: {"ok": true} when EVERY prerequisite is visibly answered (in any language), otherwise {"ok": false}. ' +
      'A prerequisite is anything the guidance says to collect/ask/confirm first (e.g. "ask budget first", "only after they share location", "kapag nasagot na ang …").'
    const user =
      `OPERATOR "SEND WHEN" GUIDANCE:\n${instructionsText}\n\n` +
      `CONVERSATION (most recent last):\n${formatRecentHistory(history)}\n\n` +
      'Return JSON only.'
    const raw = await llm.complete(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0, maxTokens: 60, responseFormat: 'json_object' },
    )
    return parseLlmJsonResponse(raw).ok
  },

  async detectProceed({ history }) {
    const llm = new HfRouterLlm({ model: ragConfig.classifierModel })
    const system =
      'You decide whether the customer\'s latest message signals they want to PROCEED, BUY, BOOK, SIGN UP, AVAIL, or otherwise take the next step. ' +
      'Return JSON only: {"ok": true} when there\'s any forward-intent signal (in any language, including Tagalog/Taglish), otherwise {"ok": false}. ' +
      'Examples that are TRUE: "sige", "kunin ko na", "magkano", "paano mag-avail", "I\'m in", "book na", "tara". ' +
      'Examples that are FALSE: greetings, generic questions, "thinking about it", "maybe later".'
    const user = `CONVERSATION (most recent last):\n${formatRecentHistory(history)}\n\nReturn JSON only.`
    const raw = await llm.complete(
      [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      { temperature: 0, maxTokens: 30, responseFormat: 'json_object' },
    )
    return parseLlmJsonResponse(raw).ok
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/action-pages/force-send.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/action-pages/force-send.ts src/lib/action-pages/force-send.test.ts
git commit -m "feat(action-pages): LLM client for prerequisite + proceed-intent checks"
```

---

### Task 7: `decideForceSend` orchestrator

**Files:**
- Modify: `src/lib/action-pages/force-send.ts` (add main orchestrator)
- Modify: `src/lib/action-pages/force-send.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/action-pages/force-send.test.ts`:

```ts
import { decideForceSend, type ForceSendContext } from './force-send'
import type { ActionPageBrief, ActionPageChoice, StageBrief, StageChange } from '@/lib/chatbot/classify'

function ctx(over: Partial<ForceSendContext> = {}): ForceSendContext {
  const pages: ActionPageBrief[] = [
    { id: 'primary', title: 'Primary', cta_label: 'Go', bot_send_instructions: '' },
  ]
  const baseStage: StageBrief = {
    id: 'qual',
    name: 'Qualifying',
    description: null,
    position: 2,
    kind: 'qualifying',
  }
  const stages: StageBrief[] = [
    { id: 'entry', name: 'Entry', description: null, position: 0, kind: 'entry' },
    baseStage,
    { id: 'won', name: 'Won', description: null, position: 3, kind: 'won' },
  ]
  return {
    userId: 'u1',
    leadId: 'lead-1',
    threadId: 't1',
    history: [{ role: 'user', content: 'previous msg' }],
    latestCustomerMessage: 'sige po',
    currentStage: baseStage,
    stages,
    stageChangeThisTurn: null,
    llmActionPage: null,
    actionPages: pages,
    primaryActionPageId: 'primary',
    supabase: {} as ForceSendContext['supabase'],
    llm: { checkPrerequisites: vi.fn(async () => true), detectProceed: vi.fn(async () => false) },
    ...over,
  }
}

describe('decideForceSend', () => {
  beforeEach(() => __leadCacheResetForTests())

  it('overrides null LLM choice when all conditions are met', async () => {
    const c = ctx()
    const r = await decideForceSend(c)
    expect(r.overrideFired).toBe(true)
    expect(r.actionPage?.action_page_id).toBe('primary')
  })

  it('does not override when LLM already picked the resolved page', async () => {
    const llmChoice: ActionPageChoice = {
      action_page_id: 'primary',
      reason: 'LLM said so',
      button_text: 'Tap below 👇',
    }
    const r = await decideForceSend(ctx({ llmActionPage: llmChoice }))
    expect(r.overrideFired).toBe(false)
    expect(r.actionPage).toBe(llmChoice)
  })

  it.each(['lost', 'dormant', 'won'] as const)('skips when stage kind is %s', async (k) => {
    const r = await decideForceSend(
      ctx({
        currentStage: {
          id: 'x',
          name: 'X',
          description: null,
          position: 5,
          kind: k,
        },
      }),
    )
    expect(r.overrideFired).toBe(false)
    expect(r.actionPage).toBeNull()
  })

  it('falls back to first page when no primary configured', async () => {
    const r = await decideForceSend(ctx({ primaryActionPageId: null }))
    expect(r.overrideFired).toBe(true)
    expect(r.actionPage?.action_page_id).toBe('primary')
  })

  it('does nothing when no primary AND no published pages', async () => {
    const r = await decideForceSend(ctx({ primaryActionPageId: null, actionPages: [] }))
    expect(r.overrideFired).toBe(false)
    expect(r.actionPage).toBeNull()
  })

  it('does nothing on a cold first inbound (no prior customer messages)', async () => {
    const r = await decideForceSend(ctx({ history: [] }))
    expect(r.overrideFired).toBe(false)
  })

  it('does nothing when leadId is null', async () => {
    const r = await decideForceSend(ctx({ leadId: null }))
    expect(r.overrideFired).toBe(false)
  })

  it('does not call the proceed LLM when regex hits', async () => {
    const llm = { checkPrerequisites: vi.fn(async () => true), detectProceed: vi.fn(async () => false) }
    await decideForceSend(ctx({ latestCustomerMessage: 'sige po', llm }))
    expect(llm.detectProceed).not.toHaveBeenCalled()
  })

  it('does not call the proceed LLM when regex misses but stage moved forward', async () => {
    const change: StageChange = { to_stage_id: 'qual', confidence: 'medium', reason: 'asked price' }
    const llm = { checkPrerequisites: vi.fn(async () => true), detectProceed: vi.fn(async () => false) }
    await decideForceSend(
      ctx({
        latestCustomerMessage: 'hmm interesting',
        stageChangeThisTurn: change,
        llm,
      }),
    )
    expect(llm.detectProceed).not.toHaveBeenCalled()
  })

  it('calls the proceed LLM once when both regex and stage-forward miss', async () => {
    const llm = { checkPrerequisites: vi.fn(async () => true), detectProceed: vi.fn(async () => true) }
    const r = await decideForceSend(
      ctx({
        latestCustomerMessage: 'hmm interesting',
        stageChangeThisTurn: null,
        llm,
      }),
    )
    expect(llm.detectProceed).toHaveBeenCalledTimes(1)
    expect(r.overrideFired).toBe(true)
  })

  it('does NOT override when proceed signal is missing', async () => {
    const llm = { checkPrerequisites: vi.fn(async () => true), detectProceed: vi.fn(async () => false) }
    const r = await decideForceSend(
      ctx({ latestCustomerMessage: 'hmm interesting', stageChangeThisTurn: null, llm }),
    )
    expect(r.overrideFired).toBe(false)
    expect(r.actionPage).toBeNull()
  })

  it('skips prerequisite LLM call when stage is already qualified (path A)', async () => {
    const llm = { checkPrerequisites: vi.fn(async () => false), detectProceed: vi.fn(async () => false) }
    const r = await decideForceSend(
      ctx({
        latestCustomerMessage: 'sige po',
        actionPages: [
          { id: 'primary', title: 'Primary', cta_label: 'Go', bot_send_instructions: 'Ask budget first.' },
        ],
        llm,
      }),
    )
    expect(llm.checkPrerequisites).not.toHaveBeenCalled()
    expect(r.overrideFired).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/action-pages/force-send.test.ts`
Expected: FAIL — `decideForceSend is not a function`, `ForceSendContext not exported`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/action-pages/force-send.ts`:

```ts
import type { ActionPageChoice } from '@/lib/chatbot/classify'

export interface ForceSendContext {
  userId: string
  leadId: string | null
  threadId: string | null
  history: AnswerHistory
  latestCustomerMessage: string
  currentStage: StageBrief | null
  stages: StageBrief[]
  stageChangeThisTurn: StageChange | null
  llmActionPage: ActionPageChoice | null
  actionPages: ActionPageBrief[]
  primaryActionPageId: string | null
  supabase: SupabaseClient
  llm?: LlmCheckClient & { detectProceed(args: { history: AnswerHistory }): Promise<boolean> }
}

export interface ForceSendDecision {
  actionPage: ActionPageChoice | null
  overrideFired: boolean
  reason: string
}

export async function decideForceSend(ctx: ForceSendContext): Promise<ForceSendDecision> {
  const llm = ctx.llm ?? defaultLlmCheckClient

  // Guard 1: sendable stage
  if (!isSendableStage(ctx.currentStage)) {
    return { actionPage: ctx.llmActionPage, overrideFired: false, reason: 'skip:stage' }
  }

  // Guard 2: page resolvable
  const page = resolveFallbackFromList(ctx.primaryActionPageId, ctx.actionPages)
  if (!page) {
    return { actionPage: ctx.llmActionPage, overrideFired: false, reason: 'skip:no-page' }
  }

  // Guard 3: at least one prior customer message
  const hadPriorCustomerTurn = ctx.history.some((m) => m.role === 'user')
  if (!hadPriorCustomerTurn) {
    return { actionPage: ctx.llmActionPage, overrideFired: false, reason: 'skip:cold-inbound' }
  }

  // Guard 4: leadId required (cache + qualification lookups need it)
  if (!ctx.leadId) {
    return { actionPage: ctx.llmActionPage, overrideFired: false, reason: 'skip:no-lead' }
  }

  // No-op when LLM already picked the resolved page.
  if (ctx.llmActionPage && ctx.llmActionPage.action_page_id === page.id) {
    return { actionPage: ctx.llmActionPage, overrideFired: false, reason: 'noop:llm-already-picked' }
  }

  // Qualified? (A) stage-kind → (B) quiz submission → (C) instructions LLM
  let qualified = isStageQualified(ctx.currentStage)
  if (!qualified) qualified = await hasQualifiedQuizSubmission(ctx.supabase, ctx.leadId)
  if (!qualified) {
    qualified = await prerequisitesAnsweredCached({
      leadId: ctx.leadId,
      actionPageId: page.id,
      instructionsText: page.bot_send_instructions ?? '',
      history: ctx.history,
      llm,
    })
  }
  if (!qualified) {
    return { actionPage: ctx.llmActionPage, overrideFired: false, reason: 'skip:not-qualified' }
  }

  // Proceed intent: regex → stage-forward → LLM
  let ready = detectProceedRegex(ctx.latestCustomerMessage)
  if (!ready) {
    ready = detectStageForward(
      ctx.stageChangeThisTurn,
      ctx.currentStage?.position ?? null,
      ctx.stages,
    )
  }
  if (!ready) ready = await llm.detectProceed({ history: ctx.history })
  if (!ready) {
    return { actionPage: ctx.llmActionPage, overrideFired: false, reason: 'skip:not-ready' }
  }

  // Fire the override.
  return {
    actionPage: {
      action_page_id: page.id,
      reason: 'force-send: qualified + ready',
      button_text: '',
    },
    overrideFired: true,
    reason: 'override',
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/action-pages/force-send.test.ts`
Expected: PASS (all 25+ cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/action-pages/force-send.ts src/lib/action-pages/force-send.test.ts
git commit -m "feat(action-pages): decideForceSend orchestrator with cost-disciplined ordering"
```

---

### Task 8: Strengthen `primary-goal.ts` with "ONCE QUALIFIED" instruction

**Files:**
- Modify: `src/lib/chatbot/primary-goal.ts`
- Modify: `src/lib/chatbot/primary-goal.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/lib/chatbot/primary-goal.test.ts` inside the existing `describe` block:

```ts
it('includes the ONCE QUALIFIED instruction when bot_send_instructions is set', async () => {
  const c = mockClient(
    { primary_action_page_id: 'page-1' },
    {
      title: 'Booking',
      slug: 'book',
      bot_send_instructions: 'Ask budget first.',
      status: 'published',
    },
  )
  const out = await loadPrimaryGoalInstruction(c, 'user-1')
  expect(out).toContain('Once every prerequisite above has been answered')
  expect(out).toContain('you MUST set `action_page.action_page_id`')
  expect(out).toContain('Do not stall')
})

it('does NOT include the ONCE QUALIFIED instruction when bot_send_instructions is empty', async () => {
  const c = mockClient(
    { primary_action_page_id: 'page-1' },
    { title: 'Booking', slug: 'book', bot_send_instructions: '', status: 'published' },
  )
  const out = await loadPrimaryGoalInstruction(c, 'user-1')
  expect(out).not.toContain('Once every prerequisite above has been answered')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/chatbot/primary-goal.test.ts`
Expected: FAIL — first assertion fails because the new sentence is absent.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/chatbot/primary-goal.ts`, replace the `if (trigger) { lines.push(...) }` block (currently around lines 47–54) with:

```ts
if (trigger) {
  lines.push(
    '',
    'Send when the customer\'s latest message matches this trigger AND every qualifying prerequisite below has been answered:',
    trigger,
    '',
    'QUALIFY FIRST: Read the trigger above literally. If it names prerequisites — e.g. "ask the customer\'s X first", "only after they share Y", "make sure Z is collected", "kapag nasagot na ang … bago", or any similar wording in any language — those are required questions you MUST ask BEFORE sending. Until every one of them is answered in the conversation history, leave `action_page` null and ask the next missing qualifying question in `reply` (one at a time, in the customer\'s language). Do not re-ask anything they already answered.',
    '',
    'ONCE QUALIFIED: Once every prerequisite above has been answered AND the customer\'s latest message shows any signal of wanting to proceed (asking how, agreeing, saying "sige"/"okay"/"magkano"/"sign me up"/"book na"/equivalents in any language, or any forward intent), you MUST set `action_page.action_page_id` to this page on this turn. Do not stall with another qualifying question. Do not wait for a more explicit ask. The button arrives as a separate message — your `reply` stays conversational.',
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/chatbot/primary-goal.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chatbot/primary-goal.ts src/lib/chatbot/primary-goal.test.ts
git commit -m "feat(chatbot): ONCE QUALIFIED instruction in primary-goal prompt"
```

---

### Task 9: Strengthen `classify.ts` with "SEND NOW" sub-rule

**Files:**
- Modify: `src/lib/chatbot/classify.ts`

This task has no separate failing test up front because `stageInstruction` is composed string. We assert presence via a small inline test added to `classify.test.ts` in Step 1.

- [ ] **Step 1: Write the failing test**

Locate `src/lib/chatbot/classify.test.ts`. If it does not exist, create it. Add this test:

```ts
import { describe, expect, it } from 'vitest'
import { stageInstruction } from './classify'
import type { ActionPageBrief, StageBrief } from './classify'

describe('stageInstruction SEND NOW rule', () => {
  const stage: StageBrief = {
    id: 's',
    name: 'Qualifying',
    description: null,
    position: 1,
    kind: 'qualifying',
  }
  const page: ActionPageBrief = {
    id: 'p1',
    title: 'Form',
    cta_label: 'Open',
    bot_send_instructions: 'Send when customer asks to sign up.',
  }

  it('includes SEND NOW instruction when action pages are present', () => {
    const out = stageInstruction([stage], stage.id, [page], null, null)
    expect(out).toContain('SEND NOW')
    expect(out).toContain('any forward intent')
  })

  it('does not include SEND NOW when no action pages', () => {
    const out = stageInstruction([stage], stage.id, [], null, null)
    expect(out).not.toContain('SEND NOW')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/chatbot/classify.test.ts`
Expected: FAIL — the string "SEND NOW" is not present in the current prompt.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/chatbot/classify.ts`, locate the `apPreamble` definition inside `stageInstruction` (currently around line 478 — the `const apPreamble = hasActionPages ? '\n\n' + ... : ''` expression). Just BEFORE the final closing `: ''` ternary branch, append a new clause to the concatenated string. The cleanest place is right before the closing single-quote of the existing very-long string. Add a final paragraph:

```ts
// ... at the end of the long apPreamble string, BEFORE the trailing `: ''` :
'\n\n' +
'SEND NOW — when all prerequisites are met:\n' +
'- Once the conversation shows that every prerequisite in the page\'s "send when" guidance has been answered, AND the customer\'s latest message shows any forward intent (agreement, "sige"/"okay"/"magkano"/"how do I"/"sign me up"/"book na"/equivalents in any language), you MUST set `action_page.action_page_id` to that page on this turn.\n' +
'- Do not stall with one more qualifying question once everything is answered. Do not wait for a more explicit ask. The button arrives as a separate message — your `reply` stays conversational and references nothing about a link/button/form.\n' +
'- This rule applies to every action page in the list below, not only the primary goal.'
```

Concretely, replace the closing of the `apPreamble` string. The current code ends with the `BUTTON_TEXT RULES` paragraph and `: ''`. Insert the SEND NOW block as a final concatenated string before `: ''`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/chatbot/classify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chatbot/classify.ts src/lib/chatbot/classify.test.ts
git commit -m "feat(chatbot): SEND NOW sub-rule for non-primary action pages"
```

---

### Task 10: Wire `decideForceSend` into `answerWithClassification`

**Files:**
- Modify: `src/lib/chatbot/classify.ts`
- Modify: `src/lib/chatbot/classify.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/chatbot/classify.test.ts`:

```ts
import { vi } from 'vitest'

// Mock the LLM so we control the JSON shape returned.
vi.mock('@/lib/rag', async (orig) => {
  const real = (await orig()) as Record<string, unknown>
  return {
    ...real,
    HfRouterLlm: class {
      async completeWithUsage() {
        return {
          text: JSON.stringify({
            reply: 'Sounds good!',
            stage_change: null,
            action_page: null,
          }),
          model: 'fake',
          finishReason: 'stop',
          usage: { promptTokens: 0, completionTokens: 0 },
        }
      }
      async complete() {
        return ''
      }
      async rewriteQuery(q: string) {
        return q
      }
    },
    retrieve: async () => ({ buckets: { useful: [], ambiguous: [], reject: [] } }),
    buildPrompt: () => ({
      system: '',
      user: '',
      contextChunks: [],
      contextChunkIds: [],
    }),
    createEmbedder: () => ({ embed: async () => [] }),
  }
})

vi.mock('@/lib/media/selector', () => ({ selectMediaForReply: async () => [] }))
vi.mock('@/lib/action-pages/force-send', () => ({
  decideForceSend: vi.fn(async () => ({
    actionPage: { action_page_id: 'forced', reason: 'forced', button_text: '' },
    overrideFired: true,
    reason: 'override',
  })),
}))

import { answerWithClassification } from './classify'
import { decideForceSend } from '@/lib/action-pages/force-send'

describe('answerWithClassification force-send wiring', () => {
  it('replaces actionPage with the force-send decision when override fires', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      }),
    } as unknown as Parameters<typeof answerWithClassification>[0]

    const r = await answerWithClassification(
      supabase,
      'u1',
      'sige po',
      [{ role: 'user', content: 'earlier' }],
      [],
      null,
      {
        actionPages: [
          { id: 'forced', title: 'P', cta_label: 'go', bot_send_instructions: '' },
        ],
        leadId: 'lead-1',
        threadId: 't1',
      },
    )

    expect(decideForceSend).toHaveBeenCalledTimes(1)
    expect(r.actionPage?.action_page_id).toBe('forced')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- src/lib/chatbot/classify.test.ts`
Expected: FAIL — `leadId` is not a known option on `answerWithClassification`, and `decideForceSend` is not yet called.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/chatbot/classify.ts`:

1. Add to the options object type (the inline type at the existing `answerWithClassification` signature, currently around lines 88–95). Find:

```ts
options: AnswerOptions & {
  actionPages?: ActionPageBrief[]
  activeCatalogPageId?: string | null
  activeRealestatePageId?: string | null
} = {},
```

Extend to:

```ts
options: AnswerOptions & {
  actionPages?: ActionPageBrief[]
  activeCatalogPageId?: string | null
  activeRealestatePageId?: string | null
  /** Lead id for the current thread. Required for force-send override. */
  leadId?: string | null
  /** Thread id for the current message. Used in force-send logging. */
  threadId?: string | null
} = {},
```

2. At the top of the file, add the import:

```ts
import { decideForceSend } from '@/lib/action-pages/force-send'
```

3. After `coerceActionPage` produces `actionPage` (currently around line 215, inside the JSON-parsed branch), and the recommendation coercion below it, but BEFORE the final `return { text, sourceTitles, media, stageChange, actionPage, productRecommendation, propertyRecommendation }` line (around line 280), insert:

```ts
try {
  const forced = await decideForceSend({
    userId,
    leadId: options.leadId ?? null,
    threadId: options.threadId ?? null,
    history,
    latestCustomerMessage: message,
    currentStage: stages.find((s) => s.id === currentStageId) ?? null,
    stages,
    stageChangeThisTurn: stageChange,
    llmActionPage: actionPage,
    actionPages,
    primaryActionPageId: config.primaryActionPageId ?? null,
    supabase,
  })
  if (forced.overrideFired) {
    console.info('[force-send] override fired', {
      userId,
      leadId: options.leadId ?? null,
      threadId: options.threadId ?? null,
      reason: forced.reason,
      pageId: forced.actionPage?.action_page_id ?? null,
    })
  }
  actionPage = forced.actionPage
} catch (e) {
  console.error('[force-send] decideForceSend threw — keeping LLM choice', e)
}
```

Note: `actionPage` is currently declared `const` via destructure-or-let at line 200 (`let actionPage: ActionPageChoice | null = null`). It's already a `let` — no change needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- src/lib/chatbot/classify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chatbot/classify.ts src/lib/chatbot/classify.test.ts
git commit -m "feat(chatbot): wire force-send override into answerWithClassification"
```

---

### Task 11: Pass `leadId` + `threadId` from the Messenger worker

**Files:**
- Modify: `src/app/api/messenger/process/route.ts`

This task does not introduce a new unit test — the messenger worker already has integration test coverage in `route.test.ts`. We rely on those to keep passing.

- [ ] **Step 1: Read the call site**

Open `src/app/api/messenger/process/route.ts` around line 559 — the `answerWithClassification(...)` call. Confirm that `thread.lead_id` is available in scope (it is — used throughout the file, e.g. line 340).

- [ ] **Step 2: Modify the call site**

Find the options object passed to `answerWithClassification` (around line 566-576):

```ts
{
  rpcName: 'match_knowledge_hybrid_service',
  actionPages,
  campaignPersona: effectivePersona,
  conversationSummary,
  activeCatalogPageId,
  activeRealestatePageId,
  leadContextBlock,
  leadName: thread.full_name ?? undefined,
  preloadedConfig: config,
},
```

Add two fields:

```ts
{
  rpcName: 'match_knowledge_hybrid_service',
  actionPages,
  campaignPersona: effectivePersona,
  conversationSummary,
  activeCatalogPageId,
  activeRealestatePageId,
  leadContextBlock,
  leadName: thread.full_name ?? undefined,
  preloadedConfig: config,
  leadId: thread.lead_id ?? null,
  threadId: thread.id,
},
```

- [ ] **Step 3: Run the existing worker tests to make sure nothing regressed**

Run: `pnpm test -- src/app/api/messenger/process/route.test.ts`
Expected: PASS (the existing assertions don't inspect leadId/threadId, so they keep passing).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/messenger/process/route.ts
git commit -m "feat(messenger): thread leadId+threadId through to answerWithClassification"
```

---

### Task 12: Full-suite sanity check

**Files:** none changed.

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: every previously-passing test continues to pass; new tests in `cache.test.ts`, `force-send.test.ts`, `primary-goal.test.ts`, and `classify.test.ts` pass.

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: clean (no new ESLint errors).

- [ ] **Step 3: Manual smoke note (no code change)**

Append a one-line manual-verification note to the spec's "Open Questions" section in `docs/superpowers/specs/2026-05-21-force-send-action-page-design.md`:

```markdown
## Verification

- 2026-05-21: Implementation complete. Vitest suite green, lint clean. Manual Messenger smoke test pending operator validation in production traffic.
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-05-21-force-send-action-page-design.md
git commit -m "docs(specs): mark force-send implementation complete"
```

---

## Self-Review Notes

- **Spec coverage:**
  - Skip-stage rule → Task 2.
  - Page resolver (primary + fallback) → Task 2.
  - Stage-forward + verbal regex → Task 3.
  - Qualified A/B → Task 4.
  - Qualified C with cache → Tasks 5–6.
  - Orchestrator with cost ordering → Task 7.
  - Prompt edits → Tasks 8–9.
  - Wiring → Tasks 10–11.

- **No placeholders:** every step has either runnable code, exact commands, or both. No TBDs.

- **Type consistency:**
  - `ForceSendContext` uses `currentStage: StageBrief | null` + `stages: StageBrief[]` consistently (Task 7 test ctx helper passes both; orchestrator uses both).
  - `LlmCheckClient` introduced in Task 5 is reused in Tasks 6–7 — the orchestrator's `llm` field extends it with `detectProceed` (matches `defaultLlmCheckClient`'s shape from Task 6).
  - `decideForceSend` returns `ForceSendDecision` consistently; `actionPage` field on it is `ActionPageChoice | null` matching the existing field on `AnswerWithClassificationResult`.
  - `primaryActionPageId` is read from `config.primaryActionPageId` (already on `ChatbotConfig` — confirmed via `src/lib/chatbot/config.ts:137`).
