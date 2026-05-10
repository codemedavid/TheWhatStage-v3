# Auto Stage Progression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI-driven pipeline stage moves smarter (hierarchy reasoning, name-aware), add a deep re-evaluation pass every 10 inbound messages with full lead context, and surface AI move reasons in the kanban card + lead drawer timeline.

**Architecture:** Two layers funneling through `set_lead_stage`. Layer 1 (per-turn) stays inline in `answerWithClassification` with an upgraded prompt that lists stages in `[<position> · <kind>] <name>` order plus an explicit HIERARCHY block. Layer 2 (deep re-eval) is a new fire-and-forget module triggered after the bot reply when `inboundCount % 10 === 0`, requires `high` confidence to apply, and uses a window-keyed idempotency key. UI extends the existing `StageJourney` component and adds a tooltip-bearing badge to the kanban `LeadCard`.

**Tech Stack:** TypeScript, Next.js App Router, Vitest, Supabase (Postgres). Spec: `docs/superpowers/specs/2026-05-11-auto-stage-progression-design.md`.

**Critical pre-existing bug surfaced during planning:** `lead_stage_events.source` has a CHECK constraint of `('ai','user','action_page')` but callers in `classify.ts`, `workflow/executor.ts`, and `action-pages/submit/route.ts` pass `'classifier'`, `'workflow'`, and `'action_page_submission'` respectively. These RPC calls fail the CHECK and are silently caught + logged today — meaning classifier/workflow stage moves never persist. **Task 1 fixes this by extending the constraint** before any other change can take effect.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260525000000_lead_stage_events_source_extend.sql` (new) | Extend `lead_stage_events.source` CHECK to permit all caller values + new `deep_classifier` |
| `supabase/migrations/20260525000100_chatbot_deep_reclassify_flag.sql` (new) | Add `chatbot_configs.deep_reclassify_enabled boolean default false` |
| `src/lib/chatbot/classify.ts` | Extend `StageBrief` + `stageInstruction` with hierarchy block; render stages with `[<position> · <kind>] <name>` |
| `src/lib/chatbot/classify.test.ts` (new) | Unit tests for the upgraded prompt rendering + coercion guards |
| `src/lib/chatbot/deep-reclassify.ts` (new) | Context bundle loader, prompt builder, LLM call, RPC apply |
| `src/lib/chatbot/deep-reclassify.test.ts` (new) | Mocked-LLM unit tests covering all branches |
| `src/app/api/messenger/process/route.ts` | Load stages with `kind`+`position`; fire-and-forget `runDeepReclassify` after bot reply when `inboundCount % 10 === 0` and feature flag is on |
| `src/app/api/messenger/process/route.test.ts` | Add tests for the every-10 trigger; assert no-op when flag off, when count not aligned, and reply path doesn't throw on deep-reclassify failure |
| `src/app/(app)/dashboard/leads/actions/messenger.ts` | Widen `StageJourneyEvent.source` union; map raw DB values to UI labels; expose `from_stage_position` + `to_stage_position` for backward indicator |
| `src/app/(app)/dashboard/leads/_components/StageJourney.tsx` | Render new source pills (Manual / AI · per-turn / AI · audit / Form / Workflow) + backward indicator (↩) |
| `src/app/(app)/dashboard/leads/_components/LeadCard.tsx` | Render auto-move badge with tooltip when latest stage event is from `classifier` or `deep_classifier`; "View history" opens the drawer |
| `src/app/(app)/dashboard/leads/_lib/queries.ts` | Add latest stage rationale per lead to the kanban query |

---

## Task 1: Extend `lead_stage_events.source` CHECK constraint

**Files:**
- Create: `supabase/migrations/20260525000000_lead_stage_events_source_extend.sql`

This unblocks the silent failures in the existing classifier path AND lets Layer 2 use a distinct `deep_classifier` source label. No data migration needed — only constraint values.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260525000000_lead_stage_events_source_extend.sql`:

```sql
-- Extend lead_stage_events.source CHECK constraint.
--
-- Pre-existing bug: callers in classify.ts, workflow/executor.ts, and
-- action-pages/submit/route.ts pass 'classifier', 'workflow', and
-- 'action_page_submission' respectively, but the prior constraint only
-- accepted ('ai','user','action_page'), causing those RPC calls to fail
-- the CHECK and silently no-op (the application catches and logs only).
--
-- This migration accepts all values currently passed by callers and adds
-- 'deep_classifier' for the new background re-evaluation layer.

alter table public.lead_stage_events
  drop constraint if exists lead_stage_events_source_check;

alter table public.lead_stage_events
  add constraint lead_stage_events_source_check
  check (
    source in (
      'ai',
      'user',
      'action_page',
      'action_page_submission',
      'classifier',
      'deep_classifier',
      'workflow'
    )
  );
```

- [ ] **Step 2: Apply the migration**

Run: `supabase migration up` (or the project's normal migration flow — check `package.json` scripts; if there's a `pnpm db:push` or similar, use it).
Expected: PASS — constraint replaced.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260525000000_lead_stage_events_source_extend.sql
git commit -m "fix(stage-events): extend source CHECK to cover all caller values"
```

---

## Task 2: Add feature flag column for deep re-eval

**Files:**
- Create: `supabase/migrations/20260525000100_chatbot_deep_reclassify_flag.sql`

Default-off. Operators flip it on per workspace after we validate behavior.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260525000100_chatbot_deep_reclassify_flag.sql`:

```sql
alter table public.chatbot_configs
  add column if not exists deep_reclassify_enabled boolean not null default false;

comment on column public.chatbot_configs.deep_reclassify_enabled is
  'When true, the messenger worker fires a deeper stage re-evaluation pass every 10 inbound customer messages.';
```

- [ ] **Step 2: Apply and commit**

Run: `supabase migration up`
Expected: PASS.

```bash
git add supabase/migrations/20260525000100_chatbot_deep_reclassify_flag.sql
git commit -m "feat(chatbot): add deep_reclassify_enabled flag to chatbot_configs"
```

---

## Task 3: Widen `StageBrief` to carry `position` + `kind`

The deep re-eval AND the per-turn hierarchy prompt both need stages with `position` and `kind`. The current `StageBrief` is `{ id, name, description }`. We extend it without breaking existing call sites.

**Files:**
- Modify: `src/lib/chatbot/classify.ts`
- Modify: `src/app/api/messenger/process/route.ts`

- [ ] **Step 1: Extend the `StageBrief` type**

In `src/lib/chatbot/classify.ts`, find the existing interface (around line 20):

```ts
export interface StageBrief {
  id: string
  name: string
  description: string | null
}
```

Replace with:

```ts
export interface StageBrief {
  id: string
  name: string
  description: string | null
  /** 0-based ordering within the user's pipeline. Lower = earlier. */
  position: number
  /** Pipeline-stage semantic kind. Drives hierarchy reasoning in the prompt. */
  kind: 'entry' | 'qualifying' | 'nurture' | 'decision' | 'won' | 'lost' | 'dormant'
}
```

- [ ] **Step 2: Update `loadStageContext` to select the new columns**

In `src/app/api/messenger/process/route.ts`, find `loadStageContext` (around line 1219):

```ts
  const { data: stagesData } = await admin
    .from('pipeline_stages')
    .select('id, name, description')
    .eq('user_id', userId)
    .order('position', { ascending: true })
  const stages = (stagesData ?? []) as StageBrief[]
```

Replace with:

```ts
  const { data: stagesData } = await admin
    .from('pipeline_stages')
    .select('id, name, description, position, kind')
    .eq('user_id', userId)
    .order('position', { ascending: true })
  const stages = (stagesData ?? []) as StageBrief[]
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS — `StageBrief` is consumed only in `classify.ts` + `route.ts`, both of which produce/consume the new shape.

- [ ] **Step 4: Commit**

```bash
git add src/lib/chatbot/classify.ts src/app/api/messenger/process/route.ts
git commit -m "feat(chatbot): widen StageBrief with position + kind"
```

---

## Task 4: Upgrade per-turn classifier prompt with HIERARCHY block

**Files:**
- Modify: `src/lib/chatbot/classify.ts` — `stageInstruction()` and `stageList()`

- [ ] **Step 1: Replace `stageList`**

Find the existing function in `src/lib/chatbot/classify.ts` (around line 491):

```ts
function stageList(stages: StageBrief[], currentStageId: string | null): string {
  const lines = stages.map((s) => {
    const cur = s.id === currentStageId ? '  [CURRENT]' : ''
    const desc = (s.description ?? '').trim() || '(no description)'
    return `- id: ${s.id}${cur}\n  name: ${s.name}\n  description: ${desc}`
  })
  return `Pipeline stages:\n${lines.join('\n')}`
}
```

Replace with:

```ts
function stageList(stages: StageBrief[], currentStageId: string | null): string {
  // Render in position order so the hierarchy is visually obvious.
  const ordered = [...stages].sort((a, b) => a.position - b.position)
  const lines = ordered.map((s) => {
    const cur = s.id === currentStageId ? '  [CURRENT]' : ''
    const desc = (s.description ?? '').trim() || '(no description)'
    return (
      `- [${s.position} · ${s.kind}] ${s.name}${cur}\n` +
      `  id: ${s.id}\n` +
      `  description: ${desc}`
    )
  })
  return `Pipeline stages (in order — earlier first):\n${lines.join('\n')}`
}
```

- [ ] **Step 2: Replace the body of `stageInstruction`'s preamble with a HIERARCHY block**

Find the bottom of `stageInstruction` (around line 385–399):

```ts
  return (
    'You are also responsible for classifying the lead\'s pipeline stage' +
    (hasActionPages ? ' and deciding whether to attach an action page button to your reply' : '') +
    (hasRecommend ? ' and deciding whether to recommend a specific product' : '') +
    (hasRecommendProperty ? ' and deciding whether to recommend a specific property listing' : '') +
    '. Output a single JSON object with this exact shape and NOTHING ELSE:\n' +
    schema +
    '\n`reply` is what the customer sees — write it in the same persona/rules above. ' +
    '`stage_change` is null when the lead should stay in the current stage. ' +
    'Only use stage_ids from the list. Pick the stage whose description best matches the customer\'s intent in the latest message + conversation.\n\n' +
    stageList(stages, currentStageId) +
    apSection +
    recommendSection +
    recommendPropertySection
  )
}
```

Replace with:

```ts
  const hierarchyBlock =
    'STAGE HIERARCHY RULES — read carefully:\n' +
    '- Stages are listed in pipeline order. Earlier position = earlier in the customer journey.\n' +
    '- The stage NAME is first-class evidence. A customer message clearly invoking the destination stage\'s name (e.g. "cancel my booking", "I\'m ready to buy") is direct evidence to move there.\n' +
    '- Forward moves (later position, or any move into a `won`/`lost` terminal stage) are allowed when the customer\'s intent matches the destination stage\'s description or name.\n' +
    '- Backward moves (earlier position) require BOTH:\n' +
    '    (a) `confidence` = "high", AND\n' +
    '    (b) `reason` MUST cite an explicit disqualifying signal — e.g. customer cancelled, said "not interested", changed their mind, asked to be removed from the funnel.\n' +
    '- Never move backward on tone alone. A frustrated message is not a backward signal unless the customer explicitly disengages.\n' +
    '- If the lead is on the right stage, return `stage_change: null`.'

  return (
    'You are also responsible for classifying the lead\'s pipeline stage' +
    (hasActionPages ? ' and deciding whether to attach an action page button to your reply' : '') +
    (hasRecommend ? ' and deciding whether to recommend a specific product' : '') +
    (hasRecommendProperty ? ' and deciding whether to recommend a specific property listing' : '') +
    '. Output a single JSON object with this exact shape and NOTHING ELSE:\n' +
    schema +
    '\n`reply` is what the customer sees — write it in the same persona/rules above. ' +
    '`stage_change` is null when the lead should stay in the current stage. ' +
    'Only use stage_ids from the list. Pick the stage whose name AND description best match the customer\'s intent in the latest message + conversation history.\n\n' +
    hierarchyBlock +
    '\n\n' +
    stageList(stages, currentStageId) +
    apSection +
    recommendSection +
    recommendPropertySection
  )
}
```

- [ ] **Step 3: Verify the existing `coerceStageChange` already drops `low` confidence — no change needed**

Read lines 525–542 of `src/lib/chatbot/classify.ts`. Confirm `coerceStageChange` returns `{ to_stage_id, confidence, reason }` and `applyStageChange` drops `low`. No code change.

- [ ] **Step 4: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chatbot/classify.ts
git commit -m "feat(chatbot): hierarchy-aware per-turn classifier prompt"
```

---

## Task 5: Tests for upgraded `stageInstruction`

**Files:**
- Create: `src/lib/chatbot/classify.test.ts`

Create the test file from scratch — the file does not exist today.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/chatbot/classify.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { StageBrief } from './classify'

// We import the pure helper used by stageInstruction. Since it's not exported
// today, we do a behavior-level test through stageInstruction itself by
// re-exporting the helper for tests.
//
// To avoid widening the public surface, this test imports the module and
// asserts on the rendered system prompt by calling the (already-exported)
// answerWithClassification path's prompt builder indirectly. The cleanest
// path is to export `stageList` and `stageInstruction` for tests; do that
// in Step 2.
import { stageInstruction, stageList } from './classify'

const stages: StageBrief[] = [
  { id: 'st_new', name: 'New Lead', description: 'fresh', position: 0, kind: 'entry' },
  { id: 'st_q',   name: 'Qualifying', description: 'asking q', position: 1, kind: 'qualifying' },
  { id: 'st_b',   name: 'Booked Call', description: 'call set', position: 2, kind: 'decision' },
  { id: 'st_won', name: 'Closed Won', description: 'paid',    position: 3, kind: 'won' },
  { id: 'st_lost',name: 'Lost',       description: 'no go',   position: 4, kind: 'lost' },
]

describe('stageList', () => {
  it('renders stages in position order with [position · kind] name prefix', () => {
    const out = stageList(stages, 'st_q')
    const lines = out.split('\n')
    // Header
    expect(lines[0]).toMatch(/Pipeline stages \(in order/)
    // First stage rendered
    expect(out).toContain('[0 · entry] New Lead')
    expect(out).toContain('[1 · qualifying] Qualifying')
    expect(out).toContain('[2 · decision] Booked Call')
    expect(out).toContain('[3 · won] Closed Won')
    expect(out).toContain('[4 · lost] Lost')
  })

  it('flags the current stage', () => {
    const out = stageList(stages, 'st_b')
    expect(out).toMatch(/\[2 · decision\] Booked Call\s*\[CURRENT\]/)
  })

  it('handles missing description gracefully', () => {
    const s: StageBrief[] = [
      { id: 'a', name: 'A', description: null, position: 0, kind: 'entry' },
    ]
    expect(stageList(s, null)).toContain('(no description)')
  })

  it('preserves position order even when input is shuffled', () => {
    const shuffled: StageBrief[] = [stages[3], stages[0], stages[2], stages[4], stages[1]]
    const out = stageList(shuffled, null)
    const idxNew = out.indexOf('New Lead')
    const idxQ = out.indexOf('Qualifying')
    const idxB = out.indexOf('Booked Call')
    const idxWon = out.indexOf('Closed Won')
    const idxLost = out.indexOf('Lost')
    expect(idxNew).toBeLessThan(idxQ)
    expect(idxQ).toBeLessThan(idxB)
    expect(idxB).toBeLessThan(idxWon)
    expect(idxWon).toBeLessThan(idxLost)
  })
})

describe('stageInstruction (hierarchy block)', () => {
  it('includes the HIERARCHY RULES block', () => {
    const out = stageInstruction(stages, null, [], null, null)
    expect(out).toContain('STAGE HIERARCHY RULES')
    expect(out).toContain('Forward moves')
    expect(out).toContain('Backward moves (earlier position)')
    expect(out).toContain('confidence" = "high"')
    expect(out).toContain('disqualifying signal')
  })

  it('renders the position-ordered stage list within the prompt', () => {
    const out = stageInstruction(stages, 'st_q', [], null, null)
    expect(out).toContain('[0 · entry] New Lead')
    expect(out).toContain('[1 · qualifying] Qualifying  [CURRENT]')
  })
})
```

- [ ] **Step 2: Export `stageList` and `stageInstruction` from `classify.ts` for tests**

Top of those two functions in `src/lib/chatbot/classify.ts`, add the `export` keyword:

Find:
```ts
function stageInstruction(
```
Replace with:
```ts
export function stageInstruction(
```

Find:
```ts
function stageList(stages: StageBrief[], currentStageId: string | null): string {
```
Replace with:
```ts
export function stageList(stages: StageBrief[], currentStageId: string | null): string {
```

- [ ] **Step 3: Run the tests**

Run: `pnpm vitest run src/lib/chatbot/classify.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 4: Commit**

```bash
git add src/lib/chatbot/classify.ts src/lib/chatbot/classify.test.ts
git commit -m "test(chatbot): cover hierarchy-aware stage prompt rendering"
```

---

## Task 6: Build `runDeepReclassify` (TDD)

**Files:**
- Create: `src/lib/chatbot/deep-reclassify.ts`
- Create: `src/lib/chatbot/deep-reclassify.test.ts`

This module is responsible for: loading the rich context bundle, building the prompt, calling the LLM, coercing the response, and applying the move via `set_lead_stage`. Fire-and-forget; never throws.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/chatbot/deep-reclassify.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

// Module under test imports HfRouterLlm — we mock it.
const llmMocks = vi.hoisted(() => ({
  complete: vi.fn(async () => '{}'),
}))

vi.mock('@/lib/rag', async (orig) => {
  const actual = await orig<typeof import('@/lib/rag')>()
  return {
    ...actual,
    HfRouterLlm: vi.fn().mockImplementation(() => ({
      complete: llmMocks.complete,
    })),
  }
})

import { runDeepReclassify } from './deep-reclassify'

type AdminMockState = {
  lead: { id: string; user_id: string; name: string; stage_id: string; entered_stage_at: string; score: number | null }
  stages: Array<{ id: string; name: string; description: string | null; position: number; kind: string }>
  events: Array<{ id: string; from_stage_id: string | null; to_stage_id: string; source: string; reason: string | null; confidence: string | null; created_at: string }>
  submissions: Array<{ id: string; outcome: string; created_at: string; action_page_id: string }>
  pages: Array<{ id: string; title: string; kind: string }>
  messages: Array<{ direction: 'inbound' | 'outbound'; body: string; created_at: string }>
  rpcCalls: Array<{ name: string; args: Record<string, unknown> }>
  rpcResult: { data: unknown; error: unknown } | null
}

function makeAdmin(state: AdminMockState) {
  const from = (table: string) => {
    const fluent = {
      select: () => fluent,
      eq: () => fluent,
      neq: () => fluent,
      in: () => fluent,
      order: () => fluent,
      limit: () => fluent,
      maybeSingle: async () => {
        if (table === 'leads') return { data: state.lead, error: null }
        return { data: null, error: null }
      },
      // Default thenable for `await query`
      then: (resolve: (v: { data: unknown; error: null }) => unknown) => {
        if (table === 'pipeline_stages') return resolve({ data: state.stages, error: null })
        if (table === 'lead_stage_events') return resolve({ data: state.events, error: null })
        if (table === 'action_page_submissions') return resolve({ data: state.submissions, error: null })
        if (table === 'action_pages') return resolve({ data: state.pages, error: null })
        if (table === 'messenger_messages') return resolve({ data: state.messages, error: null })
        return resolve({ data: [], error: null })
      },
    }
    return fluent
  }
  return {
    from,
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ name, args })
      return state.rpcResult ?? { data: true, error: null }
    }),
  } as unknown as Parameters<typeof runDeepReclassify>[0]['adminClient']
}

function makeState(): AdminMockState {
  return {
    lead: {
      id: 'lead_1',
      user_id: 'user_1',
      name: 'Buyer Bob',
      stage_id: 'st_q',
      entered_stage_at: '2026-05-01T00:00:00Z',
      score: 60,
    },
    stages: [
      { id: 'st_new', name: 'New Lead',   description: 'fresh',  position: 0, kind: 'entry' },
      { id: 'st_q',   name: 'Qualifying', description: 'q&a',    position: 1, kind: 'qualifying' },
      { id: 'st_b',   name: 'Booked',     description: 'booked', position: 2, kind: 'decision' },
      { id: 'st_won', name: 'Won',        description: 'won',    position: 3, kind: 'won' },
    ],
    events: [],
    submissions: [],
    pages: [],
    messages: [
      { direction: 'inbound',  body: 'I want to book a call', created_at: '2026-05-10T00:00:00Z' },
      { direction: 'outbound', body: 'Sure!',                 created_at: '2026-05-10T00:00:01Z' },
    ],
    rpcCalls: [],
    rpcResult: null,
  }
}

beforeEach(() => {
  llmMocks.complete.mockReset()
})

describe('runDeepReclassify', () => {
  it('no-ops when LLM returns null stage_change', async () => {
    const state = makeState()
    llmMocks.complete.mockResolvedValueOnce(JSON.stringify({ stage_change: null }))
    await runDeepReclassify({
      adminClient: makeAdmin(state),
      leadId: 'lead_1',
      threadId: 'th_1',
      userId: 'user_1',
      windowIndex: 1,
    })
    expect(state.rpcCalls).toHaveLength(0)
  })

  it('drops medium confidence (deep pass requires high)', async () => {
    const state = makeState()
    llmMocks.complete.mockResolvedValueOnce(
      JSON.stringify({ stage_change: { to_stage_id: 'st_b', confidence: 'medium', reason: 'maybe' } }),
    )
    await runDeepReclassify({
      adminClient: makeAdmin(state),
      leadId: 'lead_1',
      threadId: 'th_1',
      userId: 'user_1',
      windowIndex: 1,
    })
    expect(state.rpcCalls).toHaveLength(0)
  })

  it('applies high-confidence move via set_lead_stage with deep_classifier source and window-keyed idempotency', async () => {
    const state = makeState()
    llmMocks.complete.mockResolvedValueOnce(
      JSON.stringify({
        stage_change: {
          to_stage_id: 'st_b',
          confidence: 'high',
          reason: 'Customer explicitly asked to book a call.',
        },
      }),
    )
    await runDeepReclassify({
      adminClient: makeAdmin(state),
      leadId: 'lead_1',
      threadId: 'th_1',
      userId: 'user_1',
      windowIndex: 1,
    })
    expect(state.rpcCalls).toHaveLength(1)
    expect(state.rpcCalls[0].name).toBe('set_lead_stage')
    expect(state.rpcCalls[0].args).toMatchObject({
      p_lead_id: 'lead_1',
      p_to_stage_id: 'st_b',
      p_source: 'deep_classifier',
      p_confidence: 'high',
      p_idempotency_key: 'deep:th_1:lead_1:1',
      p_thread_id: 'th_1',
    })
    expect((state.rpcCalls[0].args.p_reason as string)).toContain('explicitly asked')
  })

  it('skips when target stage equals current stage', async () => {
    const state = makeState()
    llmMocks.complete.mockResolvedValueOnce(
      JSON.stringify({
        stage_change: { to_stage_id: 'st_q', confidence: 'high', reason: 'still qualifying' },
      }),
    )
    await runDeepReclassify({
      adminClient: makeAdmin(state),
      leadId: 'lead_1',
      threadId: 'th_1',
      userId: 'user_1',
      windowIndex: 1,
    })
    expect(state.rpcCalls).toHaveLength(0)
  })

  it('skips when target stage_id is unknown', async () => {
    const state = makeState()
    llmMocks.complete.mockResolvedValueOnce(
      JSON.stringify({
        stage_change: { to_stage_id: 'st_DOES_NOT_EXIST', confidence: 'high', reason: 'x' },
      }),
    )
    await runDeepReclassify({
      adminClient: makeAdmin(state),
      leadId: 'lead_1',
      threadId: 'th_1',
      userId: 'user_1',
      windowIndex: 1,
    })
    expect(state.rpcCalls).toHaveLength(0)
  })

  it('does not throw when LLM throws', async () => {
    const state = makeState()
    llmMocks.complete.mockRejectedValueOnce(new Error('llm down'))
    await expect(
      runDeepReclassify({
        adminClient: makeAdmin(state),
        leadId: 'lead_1',
        threadId: 'th_1',
        userId: 'user_1',
        windowIndex: 1,
      }),
    ).resolves.toBeUndefined()
    expect(state.rpcCalls).toHaveLength(0)
  })

  it('does not throw when LLM returns malformed JSON', async () => {
    const state = makeState()
    llmMocks.complete.mockResolvedValueOnce('not json at all')
    await expect(
      runDeepReclassify({
        adminClient: makeAdmin(state),
        leadId: 'lead_1',
        threadId: 'th_1',
        userId: 'user_1',
        windowIndex: 1,
      }),
    ).resolves.toBeUndefined()
    expect(state.rpcCalls).toHaveLength(0)
  })

  it('caps reason at 500 chars when applying', async () => {
    const state = makeState()
    const longReason = 'x'.repeat(1000)
    llmMocks.complete.mockResolvedValueOnce(
      JSON.stringify({
        stage_change: { to_stage_id: 'st_b', confidence: 'high', reason: longReason },
      }),
    )
    await runDeepReclassify({
      adminClient: makeAdmin(state),
      leadId: 'lead_1',
      threadId: 'th_1',
      userId: 'user_1',
      windowIndex: 2,
    })
    expect(state.rpcCalls).toHaveLength(1)
    expect((state.rpcCalls[0].args.p_reason as string).length).toBeLessThanOrEqual(500)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/chatbot/deep-reclassify.test.ts`
Expected: FAIL — module `./deep-reclassify` not found.

- [ ] **Step 3: Implement `deep-reclassify.ts`**

Create `src/lib/chatbot/deep-reclassify.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { HfRouterLlm } from '@/lib/rag'

interface RunArgs {
  adminClient: SupabaseClient
  leadId: string
  threadId: string
  userId: string
  /** floor(inboundCount / 10). Drives the idempotency key so a window can
   *  apply at most one deep move regardless of retries. */
  windowIndex: number
}

interface StageRow {
  id: string
  name: string
  description: string | null
  position: number
  kind: string
}

interface EventRow {
  id: string
  from_stage_id: string | null
  to_stage_id: string
  source: string
  reason: string | null
  confidence: string | null
  created_at: string
}

interface SubmissionRow {
  id: string
  outcome: string
  created_at: string
  action_page_id: string
}

interface PageRow {
  id: string
  title: string
  kind: string
}

interface MessageRow {
  direction: 'inbound' | 'outbound'
  body: string
  created_at: string
}

interface LeadRow {
  id: string
  user_id: string
  name: string | null
  stage_id: string | null
  entered_stage_at: string | null
  score: number | null
}

interface DeepDecision {
  to_stage_id: string
  confidence: 'high'
  reason: string
}

const HISTORY_LIMIT = 30
const EVENT_LIMIT = 10
const SUBMISSION_LIMIT = 20

/**
 * Background, fire-and-forget deep stage re-evaluation. Triggered every 10
 * inbound customer messages. Loads a rich context bundle, asks an LLM to
 * audit the current stage, and only applies a move when confidence is `high`.
 *
 * Never throws. Logs failures and returns. Idempotent within a window via
 * `deep:<threadId>:<leadId>:<windowIndex>`.
 */
export async function runDeepReclassify(args: RunArgs): Promise<void> {
  const { adminClient: admin, leadId, threadId, userId, windowIndex } = args
  try {
    const ctx = await loadContext(admin, leadId)
    if (!ctx) {
      console.warn('[deep-reclassify] context load failed', { leadId })
      return
    }
    const decision = await callLlm(ctx)
    if (!decision) return
    if (decision.to_stage_id === ctx.lead.stage_id) return
    if (!ctx.stages.some((s) => s.id === decision.to_stage_id)) return

    const idempotencyKey = `deep:${threadId}:${leadId}:${windowIndex}`
    const { error } = await admin.rpc('set_lead_stage', {
      p_lead_id: leadId,
      p_to_stage_id: decision.to_stage_id,
      p_source: 'deep_classifier',
      p_reason: decision.reason.slice(0, 500),
      p_idempotency_key: idempotencyKey,
      p_expected_version: null,
      p_confidence: 'high',
      p_thread_id: threadId,
    })
    if (error) {
      console.error('[deep-reclassify] set_lead_stage error', error.message ?? error)
      return
    }
    console.log('[deep-reclassify] applied', {
      leadId,
      windowIndex,
      from: ctx.lead.stage_id,
      to: decision.to_stage_id,
      reasonPreview: decision.reason.slice(0, 200),
    })
    void userId
  } catch (e) {
    console.error('[deep-reclassify] threw', e)
  }
}

interface ContextBundle {
  lead: LeadRow
  stages: StageRow[]
  events: EventRow[]
  submissions: Array<SubmissionRow & { page_title: string | null; page_kind: string | null }>
  history: MessageRow[]
}

async function loadContext(admin: SupabaseClient, leadId: string): Promise<ContextBundle | null> {
  const { data: lead } = await admin
    .from('leads')
    .select('id, user_id, name, stage_id, entered_stage_at, score')
    .eq('id', leadId)
    .maybeSingle<LeadRow>()
  if (!lead) return null

  const [{ data: stages }, { data: events }, { data: submissions }, { data: pages }, { data: messages }] = await Promise.all([
    admin
      .from('pipeline_stages')
      .select('id, name, description, position, kind')
      .eq('user_id', lead.user_id)
      .order('position', { ascending: true }),
    admin
      .from('lead_stage_events')
      .select('id, from_stage_id, to_stage_id, source, reason, confidence, created_at')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(EVENT_LIMIT),
    admin
      .from('action_page_submissions')
      .select('id, outcome, created_at, action_page_id')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(SUBMISSION_LIMIT),
    admin
      .from('action_pages')
      .select('id, title, kind')
      .eq('user_id', lead.user_id),
    admin
      .from('messenger_messages')
      .select('direction, body, created_at')
      .eq('user_id', lead.user_id)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT),
  ])

  const pageById = new Map(((pages ?? []) as PageRow[]).map((p) => [p.id, p]))
  const enrichedSubs = ((submissions ?? []) as SubmissionRow[]).map((s) => ({
    ...s,
    page_title: pageById.get(s.action_page_id)?.title ?? null,
    page_kind: pageById.get(s.action_page_id)?.kind ?? null,
  }))

  return {
    lead,
    stages: (stages ?? []) as StageRow[],
    events: (events ?? []) as EventRow[],
    submissions: enrichedSubs,
    history: ((messages ?? []) as MessageRow[]).reverse(),
  }
}

async function callLlm(ctx: ContextBundle): Promise<DeepDecision | null> {
  const llm = new HfRouterLlm()
  const system = buildSystemPrompt(ctx)
  const user = buildUserBlock(ctx)
  const raw = await llm.complete(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { temperature: 0, maxTokens: 400, responseFormat: 'json_object' },
  )
  return coerceDecision(raw)
}

function buildSystemPrompt(ctx: ContextBundle): string {
  const stageList = [...ctx.stages]
    .sort((a, b) => a.position - b.position)
    .map((s) => {
      const cur = s.id === ctx.lead.stage_id ? '  [CURRENT]' : ''
      const desc = (s.description ?? '').trim() || '(no description)'
      return `- [${s.position} · ${s.kind}] ${s.name}${cur}\n  id: ${s.id}\n  description: ${desc}`
    })
    .join('\n')
  return [
    'You are auditing a sales lead\'s pipeline stage with full conversation + history context.',
    'Decide whether the lead is in the correct stage RIGHT NOW based on everything below.',
    '',
    'Output JSON only, matching this schema exactly:',
    '{"stage_change": {"to_stage_id": string, "confidence": "low"|"medium"|"high", "reason": string} | null}',
    '',
    'Return null when the current stage is correct.',
    '',
    'STAGE HIERARCHY RULES:',
    '- Stages are listed in pipeline order. Earlier position = earlier in the customer journey.',
    '- The stage NAME is first-class evidence — match the customer\'s expressed intent against names AND descriptions.',
    '- Forward moves (later position, or a move into a `won`/`lost` terminal stage) are allowed when the customer\'s intent in the conversation matches the destination stage.',
    '- Backward moves (earlier position) require BOTH:',
    '    (a) confidence = "high", AND',
    '    (b) reason MUST cite an explicit disqualifying signal (cancellation, change of mind, "not interested", lost lead).',
    '- If the previous stage was set MANUALLY (source = "user"), you may still move the lead, but reason MUST explain why the prior placement no longer fits.',
    '- Use only stage_ids from the list below.',
    '',
    'Pipeline stages (in order — earlier first):',
    stageList,
  ].join('\n')
}

function buildUserBlock(ctx: ContextBundle): string {
  const dwellHours = ctx.lead.entered_stage_at
    ? Math.round((Date.now() - new Date(ctx.lead.entered_stage_at).getTime()) / 3600_000)
    : null
  const profileLines = [
    `Lead: ${ctx.lead.name ?? '(unknown name)'}`,
    `Score: ${ctx.lead.score ?? '—'}`,
    `Dwell in current stage: ${dwellHours === null ? 'unknown' : `${dwellHours}h`}`,
  ].join('\n')

  const eventLines =
    ctx.events.length === 0
      ? '(no prior stage moves)'
      : [...ctx.events]
          .reverse() // chronological
          .map(
            (e) =>
              `- ${e.created_at} | ${e.source} | ${e.from_stage_id ?? '∅'} → ${e.to_stage_id} | confidence=${e.confidence ?? '—'} | ${e.reason ?? ''}`,
          )
          .join('\n')

  const subLines =
    ctx.submissions.length === 0
      ? '(no submissions)'
      : ctx.submissions
          .map(
            (s) =>
              `- ${s.created_at} | ${s.page_kind ?? '?'}:${s.page_title ?? '?'} | outcome=${s.outcome}`,
          )
          .join('\n')

  const convo =
    ctx.history.length === 0
      ? '(no messages)'
      : ctx.history
          .map((m) => `${m.direction === 'outbound' ? 'Bot' : 'Customer'}: ${m.body}`)
          .join('\n')

  return [
    '# Lead profile',
    profileLines,
    '',
    '# Stage history (oldest first)',
    eventLines,
    '',
    '# Recent action-page submissions',
    subLines,
    '',
    '# Recent conversation (oldest first)',
    convo,
    '',
    'Audit the current stage and respond with JSON only.',
  ].join('\n')
}

function coerceDecision(raw: string): DeepDecision | null {
  if (!raw) return null
  let parsed: unknown
  try {
    const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')
    parsed = JSON.parse(stripped)
  } catch {
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return null
    try {
      parsed = JSON.parse(m[0])
    } catch {
      return null
    }
  }
  if (!parsed || typeof parsed !== 'object') return null
  const sc = (parsed as { stage_change?: unknown }).stage_change
  if (!sc || typeof sc !== 'object') return null
  const r = sc as { to_stage_id?: unknown; confidence?: unknown; reason?: unknown }
  const id = typeof r.to_stage_id === 'string' ? r.to_stage_id : null
  const conf = r.confidence === 'high' ? ('high' as const) : null
  const reason = typeof r.reason === 'string' ? r.reason : ''
  if (!id || !conf) return null
  return { to_stage_id: id, confidence: conf, reason }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/chatbot/deep-reclassify.test.ts`
Expected: PASS — all 8 tests green.

If a test fails because the mock's `from()` doesn't satisfy a particular query (e.g. `eq().eq()` chains), the issue is the fluent-builder mock — extend `fluent` so each chained method returns `fluent` and `then` resolves with the right table data.

- [ ] **Step 5: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/chatbot/deep-reclassify.ts src/lib/chatbot/deep-reclassify.test.ts
git commit -m "feat(chatbot): add background deep stage re-evaluation module"
```

---

## Task 7: Wire deep re-eval trigger into messenger worker

**Files:**
- Modify: `src/app/api/messenger/process/route.ts`

The trigger fires after the bot reply has been sent and persisted. Fire-and-forget; counts inbound messenger messages on the thread; runs only when `count > 0 && count % 10 === 0` AND the workspace has the feature flag enabled.

- [ ] **Step 1: Add the import**

In `src/app/api/messenger/process/route.ts`, near the existing chatbot imports (around lines 27–37), add:

```ts
import { runDeepReclassify } from '@/lib/chatbot/deep-reclassify'
```

- [ ] **Step 2: Add a helper to count inbound messages**

After `loadStageContext` (around line 1240), add:

```ts
async function countInboundMessages(
  admin: AdminClient,
  threadId: string,
): Promise<number> {
  const { count, error } = await admin
    .from('messenger_messages')
    .select('id', { head: true, count: 'exact' })
    .eq('thread_id', threadId)
    .eq('direction', 'inbound')
  if (error) {
    console.warn('[messenger.worker] countInboundMessages failed', error.message)
    return 0
  }
  return count ?? 0
}

async function isDeepReclassifyEnabled(
  admin: AdminClient,
  userId: string,
): Promise<boolean> {
  try {
    const { data } = await admin
      .from('chatbot_configs')
      .select('deep_reclassify_enabled')
      .eq('user_id', userId)
      .maybeSingle<{ deep_reclassify_enabled: boolean }>()
    return !!data?.deep_reclassify_enabled
  } catch {
    return false
  }
}
```

- [ ] **Step 3: Fire the deep re-eval after `applyStageChange`**

Find the block that calls `applyStageChange` (around lines 992–1002):

```ts
      // Apply stage change after the reply is safely sent. Never throws.
      if (stageChange && thread.lead_id) {
        await applyStageChange(admin, {
          leadId: thread.lead_id,
          userId: thread.user_id,
          threadId: thread.id,
          fromStageId: currentStageId,
          change: stageChange,
          stages,
        })
      }
    } else if (classifyEnabled && thread.lead_id && stages.length > 0) {
```

Replace with:

```ts
      // Apply stage change after the reply is safely sent. Never throws.
      if (stageChange && thread.lead_id) {
        await applyStageChange(admin, {
          leadId: thread.lead_id,
          userId: thread.user_id,
          threadId: thread.id,
          fromStageId: currentStageId,
          change: stageChange,
          stages,
        })
      }

      // Layer 2: deep re-evaluation every 10 inbound messages. Fire-and-forget
      // so the customer reply path is never blocked. Gated on the workspace
      // feature flag — default off until validated.
      if (thread.lead_id && stages.length > 0) {
        const leadId = thread.lead_id
        void (async () => {
          try {
            const enabled = await isDeepReclassifyEnabled(admin, thread.user_id)
            if (!enabled) return
            const inboundCount = await countInboundMessages(admin, thread.id)
            if (inboundCount === 0 || inboundCount % 10 !== 0) return
            const windowIndex = Math.floor(inboundCount / 10)
            await runDeepReclassify({
              adminClient: admin,
              leadId,
              threadId: thread.id,
              userId: thread.user_id,
              windowIndex,
            })
          } catch (e) {
            console.error('[messenger.worker] deep-reclassify trigger threw', e)
          }
        })()
      }
    } else if (classifyEnabled && thread.lead_id && stages.length > 0) {
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/messenger/process/route.ts
git commit -m "feat(messenger): trigger deep stage re-eval every 10 inbound messages"
```

---

## Task 8: Tests for the deep re-eval trigger

**Files:**
- Modify: `src/app/api/messenger/process/route.test.ts`

Goal: confirm that `runDeepReclassify` is invoked when the inbound count hits a multiple of 10 AND the flag is on, and never invoked otherwise. Also confirm that throws inside the trigger don't break the reply.

- [ ] **Step 1: Add a module mock for `runDeepReclassify`**

Near the existing `vi.mock(...)` calls in `src/app/api/messenger/process/route.test.ts`, add:

```ts
const deepMocks = vi.hoisted(() => ({
  runDeepReclassify: vi.fn(async () => undefined),
}))
vi.mock('@/lib/chatbot/deep-reclassify', () => ({
  runDeepReclassify: deepMocks.runDeepReclassify,
}))
```

Add a `beforeEach(() => { deepMocks.runDeepReclassify.mockClear() })` at the top of the existing describe block (or alongside other resets if a top-level reset already exists).

- [ ] **Step 2: Extend the existing admin mock to satisfy the new queries**

Find `makeAdminMock` (or its equivalent helper). Ensure the mock supports:

- `from('messenger_messages').select('id', { head: true, count: 'exact' }).eq('thread_id', ...).eq('direction', 'inbound')` returning `{ count: <N>, error: null }`. The current mock likely returns rows; extend the messenger_messages branch so when `select` is called with the head/count signature, the chain returns `{ count: pendingInboundCount ?? 0, error: null }` from a module-scoped variable `pendingInboundCount`.
- `from('chatbot_configs').select('deep_reclassify_enabled').eq('user_id', ...).maybeSingle()` returning `{ data: { deep_reclassify_enabled: pendingDeepFlag ?? false }, error: null }` from a module-scoped `pendingDeepFlag`.

If the existing mock pattern is fluent-builder-with-then, terminate the inbound-count chain with a thenable that resolves `{ count, error: null }`. Pattern (in the messenger_messages arm):

```ts
if (table === 'messenger_messages') {
  return {
    select: (cols: string, opts?: { head?: boolean; count?: 'exact' }) => {
      if (opts?.head && opts?.count === 'exact') {
        return {
          eq: () => ({
            eq: () => Promise.resolve({ count: pendingInboundCount ?? 0, data: null, error: null }),
          }),
        }
      }
      // ...existing branch for the history query
      return /* existing fluent shape */
    },
  }
}
```

(`pendingInboundCount` and `pendingDeepFlag` are declared at module scope and reset in `beforeEach`.)

- [ ] **Step 3: Add the four new tests**

Inside the existing `describe('messenger/process', ...)` block:

```ts
describe('deep re-evaluation trigger', () => {
  beforeEach(() => {
    deepMocks.runDeepReclassify.mockClear()
    pendingInboundCount = 0
    pendingDeepFlag = false
  })

  it('invokes runDeepReclassify when inbound count is 10 and flag is on', async () => {
    pendingInboundCount = 10
    pendingDeepFlag = true
    // Drive the worker through one inbound message that produces a reply.
    // Reuse the existing happy-path fixture used by current tests.
    await runWorkerWithInbound({ /* existing helper args */ })
    expect(deepMocks.runDeepReclassify).toHaveBeenCalledTimes(1)
    const arg = deepMocks.runDeepReclassify.mock.calls[0][0]
    expect(arg.windowIndex).toBe(1)
    expect(arg.threadId).toBeTruthy()
    expect(arg.leadId).toBeTruthy()
  })

  it('does not invoke when inbound count is 5', async () => {
    pendingInboundCount = 5
    pendingDeepFlag = true
    await runWorkerWithInbound({ /* existing helper args */ })
    expect(deepMocks.runDeepReclassify).not.toHaveBeenCalled()
  })

  it('does not invoke when flag is off, even at multiples of 10', async () => {
    pendingInboundCount = 20
    pendingDeepFlag = false
    await runWorkerWithInbound({ /* existing helper args */ })
    expect(deepMocks.runDeepReclassify).not.toHaveBeenCalled()
  })

  it('reply path completes even when runDeepReclassify throws', async () => {
    pendingInboundCount = 10
    pendingDeepFlag = true
    deepMocks.runDeepReclassify.mockRejectedValueOnce(new Error('boom'))
    const { status } = await runWorkerWithInbound({ /* existing helper args */ })
    expect(status).toBe('done')
  })
})
```

(The helper name `runWorkerWithInbound` and its arguments are placeholders for the existing test scaffold in the file — locate the helper used by the current happy-path tests and reuse it verbatim. If the file currently invokes `POST(req)` directly, do that the same way; the mocked admin + the new module-scoped state variables are what drive the new behavior.)

- [ ] **Step 4: Run the test suite**

Run: `pnpm vitest run src/app/api/messenger/process/route.test.ts`
Expected: PASS — existing + 4 new tests green.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/messenger/process/route.test.ts
git commit -m "test(messenger): cover deep stage re-eval trigger gating"
```

---

## Task 9: Surface source/confidence/reason in the StageJourney timeline

**Files:**
- Modify: `src/app/(app)/dashboard/leads/actions/messenger.ts`
- Modify: `src/app/(app)/dashboard/leads/_components/StageJourney.tsx`

Today `StageJourneyEvent.source` is typed as `'ai' | 'user'`. The DB column now carries `'classifier' | 'deep_classifier' | 'action_page' | 'action_page_submission' | 'workflow' | 'ai' | 'user'`. We widen the type and map raw values to UI-friendly source labels with distinct pill colors. We also include `from_position` / `to_position` so the renderer can show a backward indicator (↩).

- [ ] **Step 1: Widen the `StageJourneyEvent` type**

In `src/app/(app)/dashboard/leads/actions/messenger.ts`, find the existing interface (around line 211):

```ts
export interface StageJourneyEvent {
  id: string
  from_stage_name: string | null
  to_stage_name: string | null
  source: 'ai' | 'user'
  reason: string | null
  confidence: 'low' | 'medium' | 'high' | null
  created_at: string
}
```

Replace with:

```ts
export type StageEventSource =
  | 'manual'
  | 'classifier'
  | 'deep_classifier'
  | 'action_page'
  | 'workflow'
  | 'unknown'

export interface StageJourneyEvent {
  id: string
  from_stage_name: string | null
  to_stage_name: string | null
  from_position: number | null
  to_position: number | null
  source: StageEventSource
  reason: string | null
  confidence: 'low' | 'medium' | 'high' | null
  created_at: string
}

function mapEventSource(raw: string): StageEventSource {
  switch (raw) {
    case 'user':                   return 'manual'
    case 'classifier':
    case 'ai':                     return 'classifier'  // legacy 'ai' rows render as per-turn AI
    case 'deep_classifier':        return 'deep_classifier'
    case 'action_page':
    case 'action_page_submission': return 'action_page'
    case 'workflow':               return 'workflow'
    default:                       return 'unknown'
  }
}
```

- [ ] **Step 2: Update `loadStageJourney` to select `position` and use the mapper**

Find `loadStageJourney` (around line 231). Replace its body (the current `Promise.all` block + the `journey` mapping) with:

```ts
export async function loadStageJourney(leadId: string): Promise<StageJourney> {
  const { supabase } = await requireUser()

  const [{ data: events }, { data: stages }, { data: lead }] = await Promise.all([
    supabase
      .from('lead_stage_events')
      .select('id, from_stage_id, to_stage_id, source, reason, confidence, created_at')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: true })
      .limit(500),
    supabase.from('pipeline_stages').select('id, name, position'),
    supabase
      .from('leads')
      .select('stage_id, created_at')
      .eq('id', leadId)
      .maybeSingle<{ stage_id: string; created_at: string }>(),
  ])

  const stageById = new Map(
    ((stages ?? []) as Array<{ id: string; name: string; position: number }>).map((s) => [
      s.id,
      s,
    ]),
  )
  const journey: StageJourneyEvent[] = (events ?? []).map((e) => {
    const fromId = e.from_stage_id as string | null
    const toId = e.to_stage_id as string | null
    const fromStage = fromId ? stageById.get(fromId) ?? null : null
    const toStage = toId ? stageById.get(toId) ?? null : null
    return {
      id: e.id as string,
      from_stage_name: fromStage?.name ?? null,
      to_stage_name: toStage?.name ?? null,
      from_position: fromStage?.position ?? null,
      to_position: toStage?.position ?? null,
      source: mapEventSource(e.source as string),
      reason: (e.reason as string | null) ?? null,
      confidence: (e.confidence as StageJourneyEvent['confidence']) ?? null,
      created_at: e.created_at as string,
    }
  })

  return {
    events: journey,
    current_stage_name: lead?.stage_id ? (stageById.get(lead.stage_id)?.name ?? null) : null,
    created_at: lead?.created_at ?? null,
  }
}
```

- [ ] **Step 3: Update `loadLatestStageRationale` source typing**

Same file, around line 176–209. Find:

```ts
    .maybeSingle<{
      to_stage_id: string | null
      source: 'ai' | 'user'
      reason: string | null
      confidence: 'low' | 'medium' | 'high' | null
      created_at: string
    }>()
```

Replace with:

```ts
    .maybeSingle<{
      to_stage_id: string | null
      source: string
      reason: string | null
      confidence: 'low' | 'medium' | 'high' | null
      created_at: string
    }>()
```

And update the `LatestStageRationale` interface at its declaration in the same file (search `interface LatestStageRationale` or `type LatestStageRationale`) so its `source` field is `StageEventSource`. If the interface declares `source: 'ai' | 'user'`, change it to `source: StageEventSource`. Map the raw value via `mapEventSource(event.source)` before returning.

Replace the return statement:

```ts
  return {
    stage_name: stage?.name ?? null,
    source: event.source,
    reason: event.reason,
    confidence: event.confidence,
    created_at: event.created_at,
  }
```

with:

```ts
  return {
    stage_name: stage?.name ?? null,
    source: mapEventSource(event.source),
    reason: event.reason,
    confidence: event.confidence,
    created_at: event.created_at,
  }
```

- [ ] **Step 4: Update `StageJourney.tsx` to render distinct source pills + backward indicator**

In `src/app/(app)/dashboard/leads/_components/StageJourney.tsx`, replace the `JourneyDot` props + body and the `events.map(...)` block.

Replace `events.map(...)` (around line 89):

```tsx
      {events.map((e) => (
        <JourneyDot
          key={e.id}
          when={e.created_at}
          source={e.source}
          title={
            e.from_stage_name && e.to_stage_name
              ? `${e.from_stage_name} → ${e.to_stage_name}`
              : e.to_stage_name
                ? `Moved to ${e.to_stage_name}`
                : 'Stage change'
          }
          subtitle={e.reason?.trim() || null}
          confidence={e.confidence}
          backward={
            e.from_position != null &&
            e.to_position != null &&
            e.to_position < e.from_position
          }
        />
      ))}
```

Replace the `JourneyDot` definition (bottom of file, line 109+):

```tsx
function JourneyDot({
  when,
  source,
  title,
  subtitle,
  confidence,
  backward,
}: {
  when: string
  source: import('../actions/messenger').StageEventSource
  title: string
  subtitle: string | null
  confidence?: 'low' | 'medium' | 'high' | null
  backward?: boolean
}) {
  const sourceMeta = SOURCE_PILL[source] ?? SOURCE_PILL.unknown
  const stamp = new Date(when).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  return (
    <li className="relative pl-5 pb-3 last:pb-0">
      <span
        aria-hidden
        className="absolute left-0 top-[5px] h-[11px] w-[11px] rounded-full"
        style={{
          background: sourceMeta.dotFill,
          border: `1.5px solid ${sourceMeta.dotBorder}`,
        }}
      />
      <div className="flex items-baseline gap-2">
        <span
          className="text-[12.5px] font-medium"
          style={{ color: 'var(--lead-ink)' }}
        >
          {title}
          {backward && (
            <span
              className="ml-1.5 text-[11px]"
              style={{ color: 'var(--lead-faint)' }}
              title="Backward move"
            >
              ↩
            </span>
          )}
        </span>
        <span
          className="rounded-full px-1.5 py-0.5 text-[9.5px] uppercase tracking-wider"
          style={{
            background: sourceMeta.pillBg,
            border: `1px solid ${sourceMeta.pillBorder}`,
            color: sourceMeta.pillFg,
          }}
        >
          {sourceMeta.label}
        </span>
        {confidence && (
          <span
            className="rounded-full px-1.5 py-0.5 text-[9.5px]"
            style={{
              background: 'var(--lead-surface)',
              border: '1px solid var(--lead-line)',
              color: 'var(--lead-body)',
            }}
          >
            {confidence}
          </span>
        )}
        <span
          className="ml-auto text-[11px]"
          style={{ color: 'var(--lead-faint)' }}
        >
          {stamp}
        </span>
      </div>
      {subtitle && (
        <div
          className="mt-0.5 text-[12px] leading-relaxed"
          style={{ color: 'var(--lead-body)' }}
        >
          {subtitle}
        </div>
      )}
    </li>
  )
}

const SOURCE_PILL: Record<
  import('../actions/messenger').StageEventSource,
  {
    label: string
    dotFill: string
    dotBorder: string
    pillBg: string
    pillBorder: string
    pillFg: string
  }
> = {
  manual: {
    label: 'Manual',
    dotFill: 'var(--lead-surface)',
    dotBorder: 'var(--lead-muted)',
    pillBg: 'var(--lead-surface-2)',
    pillBorder: 'var(--lead-line)',
    pillFg: 'var(--lead-body)',
  },
  classifier: {
    label: 'AI · per-turn',
    dotFill: 'var(--lead-accent)',
    dotBorder: 'var(--lead-accent)',
    pillBg: 'var(--lead-surface-2)',
    pillBorder: 'var(--lead-line)',
    pillFg: 'var(--lead-body)',
  },
  deep_classifier: {
    label: 'AI · audit',
    dotFill: '#7c3aed',
    dotBorder: '#7c3aed',
    pillBg: 'var(--lead-surface-2)',
    pillBorder: 'var(--lead-line)',
    pillFg: 'var(--lead-body)',
  },
  action_page: {
    label: 'Form',
    dotFill: '#16a34a',
    dotBorder: '#16a34a',
    pillBg: 'var(--lead-surface-2)',
    pillBorder: 'var(--lead-line)',
    pillFg: 'var(--lead-body)',
  },
  workflow: {
    label: 'Workflow',
    dotFill: '#0891b2',
    dotBorder: '#0891b2',
    pillBg: 'var(--lead-surface-2)',
    pillBorder: 'var(--lead-line)',
    pillFg: 'var(--lead-body)',
  },
  unknown: {
    label: 'Auto',
    dotFill: 'var(--lead-surface)',
    dotBorder: 'var(--lead-muted)',
    pillBg: 'var(--lead-surface-2)',
    pillBorder: 'var(--lead-line)',
    pillFg: 'var(--lead-body)',
  },
}
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS.

If the typecheck fails because `LatestStageRationale` is referenced from another component with the old `source: 'ai' | 'user'` shape, update the consumer to import `StageEventSource` and adjust its label rendering accordingly (search for `LatestStageRationale` usage with `grep -rn LatestStageRationale src/`).

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/dashboard/leads/actions/messenger.ts \
        src/app/\(app\)/dashboard/leads/_components/StageJourney.tsx
git commit -m "feat(leads): surface stage-event source/reason with distinct pills"
```

---

## Task 10: Auto-move badge on the kanban LeadCard

**Files:**
- Modify: `src/app/(app)/dashboard/leads/_lib/queries.ts`
- Modify: `src/app/(app)/dashboard/leads/_components/LeadCard.tsx`

The badge appears on cards whose latest `lead_stage_events` row has a `classifier` or `deep_classifier` source. Hover/tap surfaces a tooltip with the reason; clicking opens the existing drawer (already wired via the card's `onClick`).

- [ ] **Step 1: Read the existing queries module to find the kanban list query**

Read `src/app/(app)/dashboard/leads/_lib/queries.ts` and locate the function that returns the `LeadRow` shape used by `LeadCard`. (It is referenced as `import type { LeadRow } from '../_lib/queries'` at the top of `LeadCard.tsx`.)

- [ ] **Step 2: Extend `LeadRow` with optional auto-move metadata**

Add to the `LeadRow` interface (in `queries.ts`):

```ts
  /** Set when the most recent stage event for this lead came from the AI
   *  classifier (per-turn or deep audit). null otherwise. Used to render the
   *  auto-move badge on the kanban card. */
  latest_auto_move: {
    source: 'classifier' | 'deep_classifier'
    confidence: 'low' | 'medium' | 'high' | null
    reason: string | null
    to_stage_name: string | null
    created_at: string
  } | null
```

- [ ] **Step 3: Populate `latest_auto_move` in the kanban query**

In the same file, after the existing leads-fetch returns its rows, add a follow-up batch query that loads, for each lead's id, the most recent `lead_stage_events` row where `source IN ('classifier','deep_classifier')`:

```ts
// After the existing leads array is built and before returning:
const leadIds = leads.map((l) => l.id)
let autoMoveByLead = new Map<
  string,
  { source: 'classifier' | 'deep_classifier'; confidence: 'low' | 'medium' | 'high' | null; reason: string | null; to_stage_id: string | null; created_at: string }
>()
if (leadIds.length > 0) {
  // Fetch all candidate events for these leads, then keep only the latest per lead.
  const { data: events } = await supabase
    .from('lead_stage_events')
    .select('lead_id, source, confidence, reason, to_stage_id, created_at')
    .in('lead_id', leadIds)
    .in('source', ['classifier', 'deep_classifier'])
    .order('created_at', { ascending: false })
    .limit(500)
  for (const e of (events ?? []) as Array<{
    lead_id: string
    source: 'classifier' | 'deep_classifier'
    confidence: 'low' | 'medium' | 'high' | null
    reason: string | null
    to_stage_id: string | null
    created_at: string
  }>) {
    if (!autoMoveByLead.has(e.lead_id)) {
      autoMoveByLead.set(e.lead_id, {
        source: e.source,
        confidence: e.confidence,
        reason: e.reason,
        to_stage_id: e.to_stage_id,
        created_at: e.created_at,
      })
    }
  }
}

// Resolve to_stage_name once via the existing stages map (already loaded by
// the kanban query for the columns). If the kanban query doesn't already
// load stages, add a `supabase.from('pipeline_stages').select('id, name')`
// call alongside the leads fetch.
const stageNameById: Map<string, string> = /* the existing stage map, or build it here */ new Map()

for (const l of leads) {
  const m = autoMoveByLead.get(l.id)
  l.latest_auto_move = m
    ? {
        source: m.source,
        confidence: m.confidence,
        reason: m.reason,
        to_stage_name: m.to_stage_id ? (stageNameById.get(m.to_stage_id) ?? null) : null,
        created_at: m.created_at,
      }
    : null
}
```

(If the kanban query already returns leads from a single Postgres view, the simplest patch is the above N+1-avoiding follow-up: one extra query on `lead_stage_events` per page render. Don't denormalize into the leads table.)

- [ ] **Step 4: Render the badge in `LeadCard.tsx`**

In `src/app/(app)/dashboard/leads/_components/LeadCard.tsx`, after the existing avatar/name block (locate the JSX that renders the lead's name + value), add a corner badge. The exact insertion point depends on the current JSX, but the badge wraps in a relatively positioned container:

```tsx
{lead.latest_auto_move && (
  <div
    className="absolute right-2 top-2 group/badge"
    aria-label={`Auto-moved to ${lead.latest_auto_move.to_stage_name ?? 'stage'} by AI`}
  >
    <span
      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold"
      style={{
        background: lead.latest_auto_move.source === 'deep_classifier' ? '#ede9fe' : '#dbeafe',
        color:      lead.latest_auto_move.source === 'deep_classifier' ? '#6d28d9' : '#1d4ed8',
        border: '1px solid var(--lead-line)',
      }}
    >
      AI
    </span>
    <div
      className="pointer-events-none absolute right-0 top-6 z-10 hidden w-56 rounded-lg p-2 text-[11px] shadow-md group-hover/badge:block"
      style={{
        background: 'var(--lead-surface)',
        border: '1px solid var(--lead-line)',
        color: 'var(--lead-body)',
      }}
    >
      <div className="font-medium" style={{ color: 'var(--lead-ink)' }}>
        {lead.latest_auto_move.source === 'deep_classifier' ? 'AI audit' : 'AI per-turn'} →{' '}
        {lead.latest_auto_move.to_stage_name ?? 'stage'}
      </div>
      <div className="mt-1" style={{ color: 'var(--lead-faint)' }}>
        {new Date(lead.latest_auto_move.created_at).toLocaleString(undefined, {
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        })}
        {lead.latest_auto_move.confidence ? ` · ${lead.latest_auto_move.confidence}` : ''}
      </div>
      {lead.latest_auto_move.reason && (
        <div className="mt-1 line-clamp-3" style={{ color: 'var(--lead-body)' }}>
          {lead.latest_auto_move.reason.slice(0, 200)}
        </div>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 5: Run typecheck and any UI tests that exist**

Run: `pnpm tsc --noEmit`
Expected: PASS.

Run: `pnpm vitest run src/app/\(app\)/dashboard/leads`
Expected: PASS — existing tests still green. (No new test required for the badge; the timeline tests cover the data path.)

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/dashboard/leads/_lib/queries.ts \
        src/app/\(app\)/dashboard/leads/_components/LeadCard.tsx
git commit -m "feat(leads): kanban auto-move badge with hover tooltip"
```

---

## Task 11: Final integration check

**Files:** none — verification only.

- [ ] **Step 1: Run the full test suite**

Run: `pnpm vitest run && pnpm tsc --noEmit`
Expected: PASS — every suite green, no type errors.

- [ ] **Step 2: Manual smoke test**

Bring up local dev, send a Messenger inbound that crosses the 10-message boundary on a thread whose workspace has `chatbot_configs.deep_reclassify_enabled = true`. Confirm:

1. Bot replies normally (no extra latency on the 10th message — the deep call runs after reply send).
2. Within a few seconds, a `lead_stage_events` row with `source = 'deep_classifier'` appears (only if the deep call decided a move).
3. The lead drawer's StageJourney renders the new event with the "AI · audit" pill.
4. The kanban card shows the small AI badge in the corner; hovering surfaces the tooltip.

If step 2 yields nothing on the smoke run, that's expected when the AI agrees with the current stage. Force a divergence by manually moving the lead to a stage the conversation contradicts and resending an inbound to push the count past the next multiple of 10.

- [ ] **Step 3: Final commit (if anything was tweaked during smoke testing)**

If you made any small tweaks (copy adjustments, color tweaks), commit them as a follow-up:

```bash
git add -p
git commit -m "polish(stage-progression): smoke-test adjustments"
```

---

## Self-Review Notes

**Spec coverage:**
- Architecture Layer 1 (per-turn hierarchy) → Tasks 3, 4, 5
- Architecture Layer 2 (deep re-eval) → Tasks 6, 7, 8
- Manual override semantics (option C from brainstorm — high-confidence override allowed) → Task 6 system prompt explicitly instructs "you may still move the lead, but reason MUST explain why the prior placement no longer fits"; the deep classifier writes via `set_lead_stage` with `deep_classifier` source so operators can audit
- Reason-note UI surfaces (option C from brainstorm — both card badge + drawer timeline) → Tasks 9, 10
- Feature flag rollout → Task 2 + Task 7's gating
- Schema delta — none beyond CHECK extension + flag column → Tasks 1, 2

**Pre-existing bug fix:** Task 1 surfaced during planning — silent CHECK violations on classifier/workflow/action_page_submission moves. Fixing this is a prerequisite for any classifier improvement to actually persist; without it, the rest of the plan is invisible.

**Type consistency:** `StageBrief` extension (Task 3) is consumed by both `stageInstruction` (Task 4) and `runDeepReclassify` (Task 6). `StageEventSource` (Task 9) is consumed by `StageJourney.tsx` (Task 9) and `LatestStageRationale` (Task 9). `LeadRow.latest_auto_move` (Task 10) is consumed only by `LeadCard.tsx` (Task 10). All cross-references named correctly.

**Test scaffolding placeholder note:** Task 8 step 3 marks `runWorkerWithInbound` as a placeholder for the file's existing test scaffold. This is deliberate — the existing test file's helper API is not enumerated in the plan because reading the file at implementation time is faster and more accurate than transcribing it here. The implementer must locate and reuse the helper used by current happy-path tests in the same file.

**Deferred:** per-workspace cadence configuration (currently fixed at 10) is explicitly out of scope per spec's Non-Goals.
