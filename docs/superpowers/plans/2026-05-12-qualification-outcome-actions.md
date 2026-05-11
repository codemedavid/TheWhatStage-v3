# Qualification Outcome Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make qualification action pages easy to configure by letting each outcome control stage movement, Messenger messaging, optional next action page attachment, and public thank-you copy.

**Architecture:** Keep the existing action page table shape and store outcome actions in `action_pages.config.outcomes`. Add pure outcome evaluation helpers, then wire the submit route to apply matched outcome actions before falling back to legacy pipeline rules. Refactor the qualification editor so operators configure outcomes directly instead of jumping between scoring, pipeline rules, and global Messenger echo.

**Tech Stack:** Next.js App Router route handlers and Server Components, React 19 client components, TypeScript, Zod 4, Supabase, Vitest.

---

## Docs Read First

The local Next.js 16 docs were checked before planning route/form changes:

- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/02-guides/forms.md`

Relevant constraints:

- Route handlers live inside `app` and use Web `Request` / `Response` plus `NextRequest` / `NextResponse`.
- `POST` route handlers are not cached.
- Server Actions receiving forms must validate authorization inside the action.

## File Structure

Create:

- `src/lib/action-pages/qualification-outcomes.ts` - pure evaluation helpers for qualification outcomes.
- `src/lib/action-pages/qualification-outcomes.test.ts` - outcome evaluation tests.
- `src/lib/action-pages/default-stage.ts` - default stage-kind mapping and resolver.
- `src/lib/action-pages/default-stage.test.ts` - default stage helper tests.

Modify:

- `src/app/a/[slug]/_kinds/qualification/schema.ts` - add outcome action schemas and legacy normalization.
- `src/lib/action-pages/handlers/qualification.ts` - use outcome evaluation and save richer data.
- `src/lib/action-pages/handlers/qualification.score.test.ts` - add handler regression cases for richer metadata.
- `src/app/api/action-pages/submit/route.ts` - apply outcome stage/message/attached-action-page behavior and public message redirect.
- `src/app/api/action-pages/submit/route.test.ts` - cover stage fallback, outcome message override, and attached page button send.
- `src/app/a/[slug]/page.tsx` - render qualification outcome thank-you messages by submission id.
- `src/app/(app)/dashboard/action-pages/_lib/queries.ts` - expose stage kind and action page options for the editor.
- `src/app/(app)/dashboard/action-pages/[id]/page.tsx` - fetch action page options and pass them into the shell.
- `src/app/(app)/dashboard/action-pages/_components/EditActionPageShell.tsx` - pass stages/action pages into `KindEditor`.
- `src/app/(app)/dashboard/action-pages/_components/KindEditor.tsx` - extend kind editor props and pass them to qualification.
- `src/app/(app)/dashboard/action-pages/_kinds/types.ts` - add optional `stages` and `actionPages` props.
- `src/app/(app)/dashboard/action-pages/_kinds/qualification/Editor.tsx` - replace the current scoring UI with outcome cards.
- `src/app/(app)/dashboard/action-pages/_components/PipelineRulesEditor.tsx` - allow custom qualification outcomes in advanced/legacy use.
- `src/app/(app)/dashboard/action-pages/[id]/submissions/page.tsx` - render dynamic qualification outcome stats.

## Task 1: Add Qualification Outcome Schema

**Files:**
- Modify: `src/app/a/[slug]/_kinds/qualification/schema.ts`
- Test: `src/lib/action-pages/qualification-outcomes.test.ts`

- [ ] **Step 1: Write failing schema normalization tests**

Create `src/lib/action-pages/qualification-outcomes.test.ts` with the first describe block:

```ts
import { describe, expect, it } from 'vitest'
import {
  parseQualificationConfig,
  type QualificationConfig,
} from '@/app/a/[slug]/_kinds/qualification/schema'

describe('parseQualificationConfig outcome normalization', () => {
  it('derives default outcome actions from legacy threshold scoring', () => {
    const config = parseQualificationConfig({
      theme: {
        background_color: '#FFFFFF',
        accent_color: '#059669',
        button_text_color: '#FFFFFF',
      },
      progress_bar: true,
      questions: [],
      scoring: {
        mode: 'rule_based',
        threshold: 3,
        qualified_outcome: 'hot_lead',
        disqualified_outcome: 'not_fit',
      },
    })

    expect(config.outcomes.map((o) => o.outcome)).toEqual([
      'hot_lead',
      'not_fit',
      'pending_review',
    ])
    expect(config.outcomes[0]).toMatchObject({
      id: 'qualified',
      label: 'Qualified',
      match: { kind: 'score_at_least', value: 3 },
    })
    expect(config.outcomes[1]).toMatchObject({
      id: 'disqualified',
      label: 'Not qualified',
      match: { kind: 'score_below', value: 3 },
    })
  })

  it('keeps configured outcome actions in order', () => {
    const config = parseQualificationConfig({
      theme: {
        background_color: '#FFFFFF',
        accent_color: '#059669',
        button_text_color: '#FFFFFF',
      },
      progress_bar: true,
      questions: [],
      scoring: { mode: 'rule_based', threshold: 1 },
      outcomes: [
        {
          id: 'finance_needed',
          label: 'Needs financing',
          outcome: 'needs_financing',
          match: { kind: 'answer_equals', question_id: 'budget', value: 'finance' },
          to_stage_id: null,
          messenger_text: 'We can help with financing options.',
          attach_action_page_id: '00000000-0000-0000-0000-000000000001',
          attach_cta_label: 'See options',
          public_message: 'Thanks. We sent financing options in Messenger.',
        },
      ],
    } satisfies Partial<QualificationConfig>)

    expect(config.outcomes).toHaveLength(1)
    expect(config.outcomes[0]?.outcome).toBe('needs_financing')
    expect(config.outcomes[0]?.attach_cta_label).toBe('See options')
  })
})
```

- [ ] **Step 2: Run the failing schema tests**

Run:

```bash
pnpm test src/lib/action-pages/qualification-outcomes.test.ts
```

Expected: FAIL because `QualificationConfig` does not have `outcomes`.

- [ ] **Step 3: Add outcome schemas and defaults**

In `src/app/a/[slug]/_kinds/qualification/schema.ts`, add these schemas after `ScoringSchema`:

```ts
export const OutcomeMatchSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('score_at_least'), value: z.number() }),
  z.object({ kind: z.literal('score_below'), value: z.number() }),
  z.object({ kind: z.literal('manual_review') }),
  z.object({
    kind: z.literal('answer_equals'),
    question_id: z.string().min(1),
    value: z.union([z.string(), z.number(), z.boolean()]),
  }),
  z.object({
    kind: z.literal('answer_includes'),
    question_id: z.string().min(1),
    value: z.string().min(1),
  }),
])
export type QualificationOutcomeMatch = z.infer<typeof OutcomeMatchSchema>

export const OutcomeActionSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  outcome: z.string().min(1).max(40),
  match: OutcomeMatchSchema,
  to_stage_id: z.string().uuid().nullable().default(null),
  messenger_text: z.string().max(640).default(''),
  attach_action_page_id: z.string().uuid().nullable().default(null),
  attach_cta_label: z.string().max(50).default(''),
  public_message: z.string().max(2000).default(''),
})
export type QualificationOutcomeAction = z.infer<typeof OutcomeActionSchema>
```

Extend `QualificationConfigSchema`:

```ts
export const QualificationConfigSchema = z.object({
  theme: ThemeSchema,
  progress_bar: z.boolean().default(true),
  questions: z.array(QuestionSchema).default([]),
  scoring: ScoringSchema,
  outcomes: z.array(OutcomeActionSchema).default([]),
  intro: IntroSchema,
  outro: OutroSchema,
})
```

Update `DEFAULT_QUALIFICATION_CONFIG` so `outcomes` exists:

```ts
outcomes: defaultQualificationOutcomes({
  mode: 'rule_based',
  threshold: 1,
  qualified_outcome: 'qualified',
  disqualified_outcome: 'disqualified',
}),
```

Add this helper before `DEFAULT_QUALIFICATION_CONFIG`:

```ts
export function defaultQualificationOutcomes(
  scoring: QualificationScoring,
): QualificationOutcomeAction[] {
  const threshold = scoring.threshold ?? 1
  const qualified = scoring.qualified_outcome || 'qualified'
  const disqualified = scoring.disqualified_outcome || 'disqualified'
  return [
    {
      id: 'qualified',
      label: 'Qualified',
      outcome: qualified,
      match: { kind: 'score_at_least', value: threshold },
      to_stage_id: null,
      messenger_text: '',
      attach_action_page_id: null,
      attach_cta_label: '',
      public_message: '',
    },
    {
      id: 'disqualified',
      label: 'Not qualified',
      outcome: disqualified,
      match: { kind: 'score_below', value: threshold },
      to_stage_id: null,
      messenger_text: '',
      attach_action_page_id: null,
      attach_cta_label: '',
      public_message: '',
    },
    {
      id: 'pending_review',
      label: 'Needs review',
      outcome: 'pending_review',
      match: { kind: 'manual_review' },
      to_stage_id: null,
      messenger_text: '',
      attach_action_page_id: null,
      attach_cta_label: '',
      public_message: '',
    },
  ]
}
```

Replace `parseQualificationConfig()` with logic that normalizes missing outcomes:

```ts
export function parseQualificationConfig(raw: unknown): QualificationConfig {
  const normalize = (candidate: QualificationConfig): QualificationConfig => ({
    ...candidate,
    outcomes:
      candidate.outcomes.length > 0
        ? candidate.outcomes
        : defaultQualificationOutcomes(candidate.scoring),
  })

  const result = QualificationConfigSchema.safeParse(raw)
  if (result.success) return normalize(result.data)
  if (raw && typeof raw === 'object') {
    const merged = { ...DEFAULT_QUALIFICATION_CONFIG, ...(raw as Record<string, unknown>) }
    const second = QualificationConfigSchema.safeParse(merged)
    if (second.success) return normalize(second.data)
  }
  return DEFAULT_QUALIFICATION_CONFIG
}
```

- [ ] **Step 4: Run schema tests**

Run:

```bash
pnpm test src/lib/action-pages/qualification-outcomes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/a/[slug]/_kinds/qualification/schema.ts src/lib/action-pages/qualification-outcomes.test.ts
git commit -m "feat: add qualification outcome action schema"
```

## Task 2: Add Pure Outcome Evaluation

**Files:**
- Create: `src/lib/action-pages/qualification-outcomes.ts`
- Modify: `src/lib/action-pages/qualification-outcomes.test.ts`

- [ ] **Step 1: Add failing evaluator tests**

Append to `src/lib/action-pages/qualification-outcomes.test.ts`:

```ts
import { evaluateQualificationOutcome } from './qualification-outcomes'

describe('evaluateQualificationOutcome', () => {
  const baseConfig = parseQualificationConfig({
    theme: {
      background_color: '#FFFFFF',
      accent_color: '#059669',
      button_text_color: '#FFFFFF',
    },
    progress_bar: true,
    questions: [
      {
        id: 'budget',
        prompt: 'Budget?',
        kind: 'single_choice',
        required: true,
        weight: 1,
        options: [
          { label: 'Ready', value: 'ready', score: 5 },
          { label: 'Needs financing', value: 'finance', score: 1 },
        ],
      },
    ],
    scoring: { mode: 'rule_based', threshold: 3 },
    outcomes: [
      {
        id: 'finance_needed',
        label: 'Needs financing',
        outcome: 'needs_financing',
        match: { kind: 'answer_equals', question_id: 'budget', value: 'finance' },
        to_stage_id: null,
        messenger_text: '',
        attach_action_page_id: null,
        attach_cta_label: '',
        public_message: '',
      },
      {
        id: 'qualified',
        label: 'Qualified',
        outcome: 'qualified',
        match: { kind: 'score_at_least', value: 3 },
        to_stage_id: null,
        messenger_text: '',
        attach_action_page_id: null,
        attach_cta_label: '',
        public_message: '',
      },
      {
        id: 'disqualified',
        label: 'Not qualified',
        outcome: 'disqualified',
        match: { kind: 'score_below', value: 3 },
        to_stage_id: null,
        messenger_text: '',
        attach_action_page_id: null,
        attach_cta_label: '',
        public_message: '',
      },
      {
        id: 'pending_review',
        label: 'Needs review',
        outcome: 'pending_review',
        match: { kind: 'manual_review' },
        to_stage_id: null,
        messenger_text: '',
        attach_action_page_id: null,
        attach_cta_label: '',
        public_message: '',
      },
    ],
  })

  it('uses first matching answer condition before score outcomes', () => {
    const result = evaluateQualificationOutcome(baseConfig, { budget: 'finance' })
    expect(result.outcome).toBe('needs_financing')
    expect(result.score).toBe(1)
    expect(result.matchedOutcome.id).toBe('finance_needed')
  })

  it('uses score outcomes when answer conditions do not match', () => {
    const result = evaluateQualificationOutcome(baseConfig, { budget: 'ready' })
    expect(result.outcome).toBe('qualified')
    expect(result.score).toBe(5)
    expect(result.missing_required).toEqual([])
  })

  it('routes missing required answers to pending review', () => {
    const result = evaluateQualificationOutcome(baseConfig, {})
    expect(result.outcome).toBe('pending_review')
    expect(result.missing_required).toEqual(['budget'])
  })

  it('manual review mode always returns the manual-review outcome', () => {
    const config = parseQualificationConfig({
      ...baseConfig,
      scoring: { mode: 'manual_review' },
    })
    const result = evaluateQualificationOutcome(config, { budget: 'ready' })
    expect(result.outcome).toBe('pending_review')
    expect(result.score).toBeNull()
  })
})
```

- [ ] **Step 2: Run failing evaluator tests**

Run:

```bash
pnpm test src/lib/action-pages/qualification-outcomes.test.ts
```

Expected: FAIL because `src/lib/action-pages/qualification-outcomes.ts` does not exist.

- [ ] **Step 3: Implement evaluator helper**

Create `src/lib/action-pages/qualification-outcomes.ts`:

```ts
import {
  type QualificationAnswers,
  type QualificationConfig,
  type QualificationOutcomeAction,
  type QualificationOutcomeMatch,
} from '@/app/a/[slug]/_kinds/qualification/schema'
import { scoreQualification } from './handlers/qualification.score'

export interface QualificationOutcomeResult {
  outcome: string
  score: number | null
  matchedOutcome: QualificationOutcomeAction
  missing_required: string[]
}

function isMissingAnswer(answer: unknown): boolean {
  return (
    answer === undefined ||
    answer === null ||
    (typeof answer === 'string' && answer.trim() === '') ||
    (Array.isArray(answer) && answer.length === 0)
  )
}

function fallbackOutcome(config: QualificationConfig): QualificationOutcomeAction {
  return (
    config.outcomes.find((o) => o.outcome === 'pending_review') ??
    config.outcomes.find((o) => /disqual/i.test(o.outcome)) ??
    config.outcomes[0] ?? {
      id: 'pending_review',
      label: 'Needs review',
      outcome: 'pending_review',
      match: { kind: 'manual_review' },
      to_stage_id: null,
      messenger_text: '',
      attach_action_page_id: null,
      attach_cta_label: '',
      public_message: '',
    }
  )
}

function answerMatches(
  match: QualificationOutcomeMatch,
  answers: QualificationAnswers,
  score: number,
): boolean {
  switch (match.kind) {
    case 'score_at_least':
      return score >= match.value
    case 'score_below':
      return score < match.value
    case 'manual_review':
      return false
    case 'answer_equals': {
      const answer = answers[match.question_id]
      if (Array.isArray(answer)) return answer.includes(String(match.value))
      return answer === match.value
    }
    case 'answer_includes': {
      const answer = answers[match.question_id]
      if (Array.isArray(answer)) return answer.includes(match.value)
      return answer === match.value
    }
  }
}

export function evaluateQualificationOutcome(
  config: QualificationConfig,
  answers: QualificationAnswers,
): QualificationOutcomeResult {
  const missing_required = config.questions
    .filter((q) => q.required && isMissingAnswer(answers[q.id]))
    .map((q) => q.id)

  const reviewOutcome =
    config.outcomes.find((o) => o.match.kind === 'manual_review') ??
    fallbackOutcome(config)

  if (config.scoring.mode === 'manual_review' || missing_required.length > 0) {
    return {
      outcome: reviewOutcome.outcome,
      score: config.scoring.mode === 'manual_review' ? null : scoreQualification(config, answers).score,
      matchedOutcome: reviewOutcome,
      missing_required,
    }
  }

  const { score } = scoreQualification(config, answers)
  const matched =
    config.outcomes.find((outcome) => answerMatches(outcome.match, answers, score)) ??
    fallbackOutcome(config)

  return {
    outcome: matched.outcome,
    score,
    matchedOutcome: matched,
    missing_required,
  }
}
```

- [ ] **Step 4: Run evaluator tests**

Run:

```bash
pnpm test src/lib/action-pages/qualification-outcomes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/action-pages/qualification-outcomes.ts src/lib/action-pages/qualification-outcomes.test.ts
git commit -m "feat: evaluate qualification outcome actions"
```

## Task 3: Use Outcome Evaluation In Qualification Handler

**Files:**
- Modify: `src/lib/action-pages/handlers/qualification.ts`
- Modify: `src/lib/action-pages/handlers/qualification.score.test.ts`

- [ ] **Step 1: Add failing handler metadata tests**

Append this test before the closing brace of the qualification handler describe block in `src/lib/action-pages/handlers/qualification.score.test.ts`:

```ts
  it('stores matched outcome action metadata', () => {
    const cfg: QualificationConfig = {
      ...baseConfig,
      scoring: { mode: 'rule_based', threshold: 5 },
      questions: [
        {
          id: 'q1',
          prompt: 'A?',
          kind: 'single_choice',
          required: false,
          weight: 1,
          options: [{ label: 'Yes', value: 'yes', score: 5 }],
        },
      ],
      outcomes: [
        {
          id: 'qualified',
          label: 'Qualified buyer',
          outcome: 'qualified',
          match: { kind: 'score_at_least', value: 5 },
          to_stage_id: null,
          messenger_text: 'Great fit.',
          attach_action_page_id: null,
          attach_cta_label: '',
          public_message: 'You qualify.',
        },
      ],
    }

    const result = parseSubmission(
      'qualification',
      { answers: JSON.stringify({ q1: 'yes' }) },
      cfg as unknown as Record<string, unknown>,
    )

    expect(result.outcome).toBe('qualified')
    expect(result.data.outcome_action_id).toBe('qualified')
    expect(result.data.outcome_label).toBe('Qualified buyer')
    expect(result.data.outcome_action).toMatchObject({
      messenger_text: 'Great fit.',
      public_message: 'You qualify.',
    })
  })
```

- [ ] **Step 2: Run failing handler test**

Run:

```bash
pnpm test src/lib/action-pages/handlers/qualification.score.test.ts
```

Expected: FAIL because handler data does not include `outcome_action_id`.

- [ ] **Step 3: Update handler to call evaluator**

In `src/lib/action-pages/handlers/qualification.ts`, import the evaluator:

```ts
import { evaluateQualificationOutcome } from '@/lib/action-pages/qualification-outcomes'
```

Replace the body after `displayAnswers` is built with:

```ts
  const evaluated = evaluateQualificationOutcome(config, answers)
  const data: Record<string, unknown> = {
    answers: displayAnswers,
    score: evaluated.score,
    outcome_action_id: evaluated.matchedOutcome.id,
    outcome_label: evaluated.matchedOutcome.label,
    outcome_action: {
      to_stage_id: evaluated.matchedOutcome.to_stage_id,
      messenger_text: evaluated.matchedOutcome.messenger_text,
      attach_action_page_id: evaluated.matchedOutcome.attach_action_page_id,
      attach_cta_label: evaluated.matchedOutcome.attach_cta_label,
      public_message: evaluated.matchedOutcome.public_message,
    },
  }
  if (evaluated.missing_required.length > 0) {
    data.meta = { validation_errors: { missing_required: evaluated.missing_required } }
  }

  return { outcome: evaluated.outcome, data }
```

Remove the old manual-review short-circuit and threshold comparison from this handler.

- [ ] **Step 4: Run handler tests**

Run:

```bash
pnpm test src/lib/action-pages/handlers/qualification.score.test.ts src/lib/action-pages/qualification-outcomes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/action-pages/handlers/qualification.ts src/lib/action-pages/handlers/qualification.score.test.ts
git commit -m "feat: persist matched qualification outcome metadata"
```

## Task 4: Add Default Stage Fallback Helper

**Files:**
- Create: `src/lib/action-pages/default-stage.ts`
- Create: `src/lib/action-pages/default-stage.test.ts`

- [ ] **Step 1: Write failing default-stage tests**

Create `src/lib/action-pages/default-stage.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { getDefaultStageKind, resolveDefaultStageId } from './default-stage'

describe('getDefaultStageKind', () => {
  it('maps qualification outcomes to default stage kinds', () => {
    expect(getDefaultStageKind('qualification', 'qualified')).toBe('qualifying')
    expect(getDefaultStageKind('qualification', 'disqualified')).toBe('lost')
    expect(getDefaultStageKind('qualification', 'pending_review')).toBeNull()
  })

  it('maps non-qualification action page outcomes used by existing pages', () => {
    expect(getDefaultStageKind('booking', 'booked')).toBe('decision')
    expect(getDefaultStageKind('catalog', 'checked_out')).toBe('won')
  })
})

describe('resolveDefaultStageId', () => {
  it('returns the first stage id for the requested kind', async () => {
    const maybeSingle = vi.fn(async () => ({ data: { id: 'stage_1' }, error: null }))
    const limit = vi.fn(() => ({ maybeSingle }))
    const order = vi.fn(() => ({ limit }))
    const eqKind = vi.fn(() => ({ order }))
    const eqUser = vi.fn(() => ({ eq: eqKind }))
    const select = vi.fn(() => ({ eq: eqUser }))
    const admin = { from: vi.fn(() => ({ select })) }

    await expect(resolveDefaultStageId(admin as never, 'user_1', 'qualifying')).resolves.toBe('stage_1')
    expect(admin.from).toHaveBeenCalledWith('pipeline_stages')
    expect(select).toHaveBeenCalledWith('id')
    expect(eqKind).toHaveBeenCalledWith('kind', 'qualifying')
  })
})
```

- [ ] **Step 2: Run failing default-stage tests**

Run:

```bash
pnpm test src/lib/action-pages/default-stage.test.ts
```

Expected: FAIL because `default-stage.ts` does not exist.

- [ ] **Step 3: Implement default-stage helper**

Create `src/lib/action-pages/default-stage.ts`:

```ts
import type { createAdminClient } from '@/lib/supabase/admin'
import type { ActionPageKind } from './kinds'

export type PipelineStageKind =
  | 'entry'
  | 'qualifying'
  | 'nurture'
  | 'decision'
  | 'won'
  | 'lost'
  | 'dormant'

const DEFAULT_STAGE_BY_KIND_AND_OUTCOME: Partial<
  Record<ActionPageKind, Record<string, PipelineStageKind>>
> = {
  form: { submitted: 'qualifying' },
  booking: { booked: 'decision' },
  qualification: {
    qualified: 'qualifying',
    disqualified: 'lost',
  },
  sales: {
    submitted: 'qualifying',
    checked_out: 'won',
  },
  catalog: { checked_out: 'won' },
  realestate: {
    inquiry_submitted: 'qualifying',
    viewing_booked: 'decision',
  },
}

export function getDefaultStageKind(
  pageKind: ActionPageKind,
  outcome: string,
): PipelineStageKind | null {
  return DEFAULT_STAGE_BY_KIND_AND_OUTCOME[pageKind]?.[outcome] ?? null
}

export async function resolveDefaultStageId(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  kind: PipelineStageKind,
): Promise<string | null> {
  const { data, error } = await admin
    .from('pipeline_stages')
    .select('id')
    .eq('user_id', userId)
    .eq('kind', kind)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>()

  if (error) {
    console.warn('[action-pages.default-stage] lookup failed', {
      userId,
      kind,
      err: error.message,
    })
    return null
  }

  return data?.id ?? null
}
```

- [ ] **Step 4: Run default-stage tests**

Run:

```bash
pnpm test src/lib/action-pages/default-stage.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/action-pages/default-stage.ts src/lib/action-pages/default-stage.test.ts
git commit -m "feat: add action page default stage resolver"
```

## Task 5: Apply Outcome Stage Moves, Messages, And Attached Pages

**Files:**
- Modify: `src/app/api/action-pages/submit/route.ts`
- Modify: `src/app/api/action-pages/submit/route.test.ts`

- [ ] **Step 1: Add failing submit-route tests**

Extend the hoisted mocks in `src/app/api/action-pages/submit/route.test.ts`:

```ts
  sendOutbound: vi.fn(async () => ({ sent: true, messageId: 'mid.outbound.1' })),
```

Mock the outbound module:

```ts
vi.mock('@/lib/messenger/outbound', () => ({
  sendOutbound: mocks.sendOutbound,
}))
```

Add a test admin variant that returns a qualification page, a default qualifying stage, and an attached page. Use this helper inside the test file:

```ts
function makeQualificationAdminMock() {
  const inserts: Record<string, unknown[]> = {}
  const rpc = vi.fn(async () => ({ data: true, error: null }))
  const pageRows: Record<string, Record<string, unknown>> = {
    qualify: {
      id: '00000000-0000-0000-0000-000000000010',
      user_id: 'user_1',
      kind: 'qualification',
      slug: 'qualify',
      status: 'published',
      config: {
        theme: {
          background_color: '#FFFFFF',
          accent_color: '#059669',
          button_text_color: '#FFFFFF',
        },
        progress_bar: true,
        questions: [
          {
            id: 'budget',
            prompt: 'Budget?',
            kind: 'single_choice',
            required: true,
            weight: 1,
            options: [{ label: 'Ready', value: 'ready', score: 5 }],
          },
        ],
        scoring: { mode: 'rule_based', threshold: 5 },
        outcomes: [
          {
            id: 'qualified',
            label: 'Qualified',
            outcome: 'qualified',
            match: { kind: 'score_at_least', value: 5 },
            to_stage_id: null,
            messenger_text: 'You qualify. Book the next step.',
            attach_action_page_id: '00000000-0000-0000-0000-000000000020',
            attach_cta_label: 'Book now',
            public_message: 'You qualify. We sent the next step in Messenger.',
          },
        ],
      },
      pipeline_rules: [],
      notification_template: { text: 'Global fallback' },
      signing_secret: 'secret',
    },
    booking: {
      id: '00000000-0000-0000-0000-000000000020',
      user_id: 'user_1',
      kind: 'booking',
      slug: 'book-call',
      title: 'Book a call',
      status: 'published',
      config: {},
      pipeline_rules: [],
      notification_template: null,
      cta_label: 'Book call',
      signing_secret: 'booking-secret',
    },
  }

  const from = vi.fn((table: string) => {
    if (table === 'action_pages') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((col: string, value: string) => ({
            maybeSingle: vi.fn(async () => {
              if (col === 'slug') return { data: pageRows[value], error: null }
              if (col === 'id') return { data: pageRows.booking, error: null }
              return { data: null, error: null }
            }),
          })),
        })),
      }
    }
    if (table === 'messenger_threads') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: { id: 'thread_1', lead_id: 'lead_1', last_inbound_at: new Date().toISOString() },
                error: null,
              })),
            })),
          })),
        })),
        update: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
      }
    }
    if (table === 'action_page_submissions') {
      return {
        insert: vi.fn((payload) => {
          inserts[table] = [...(inserts[table] ?? []), payload]
          return { select: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: 'sub_1' }, error: null })) })) }
        }),
      }
    }
    if (table === 'pipeline_stages') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: { id: '00000000-0000-0000-0000-000000000030' },
                    error: null,
                  })),
                })),
              })),
            })),
          })),
        })),
      }
    }
    if (table === 'facebook_pages') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({ data: { page_access_token: 'encrypted-page-token' }, error: null })),
          })),
        })),
      }
    }
    if (table === 'messenger_messages') {
      return { insert: vi.fn(async (payload) => {
        inserts[table] = [...(inserts[table] ?? []), payload]
        return { error: null }
      }) }
    }
    if (table === 'leads') {
      return {
        select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })) })),
      }
    }
    if (table === 'funnels') {
      return {
        select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })) })) })),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })

  return { admin: { from, rpc }, inserts, rpc }
}
```

Add the test:

```ts
  it('moves by default stage and sends outcome message plus attached action page', async () => {
    const { admin, rpc } = makeQualificationAdminMock()
    mocks.admin = admin

    const params = buildDeeplinkParams('secret', {
      slug: 'qualify',
      psid: 'psid_1',
      pageId: 'fb_page_1',
      exp: Math.floor(Date.now() / 1000) + 60,
    })

    const res = await POST(
      makeJsonRequest({
        slug: 'qualify',
        data: { answers: JSON.stringify({ budget: 'ready' }) },
        p: params.get('p'),
        g: params.get('g'),
        e: params.get('e'),
        t: params.get('t'),
      }) as Parameters<typeof POST>[0],
    )

    expect(res.status).toBe(200)
    expect(rpc).toHaveBeenCalledWith('set_lead_stage', expect.objectContaining({
      p_to_stage_id: '00000000-0000-0000-0000-000000000030',
      p_reason: 'outcome: qualified',
    }))
    expect(mocks.sendOutbound).toHaveBeenCalledWith(expect.objectContaining({
      payload: { kind: 'text', text: 'You qualify. Book the next step.' },
      kind: 'submission_echo',
    }))
    expect(mocks.sendOutbound).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        kind: 'button',
        text: 'Book a call',
        ctaLabel: 'Book now',
      }),
      kind: 'submission_echo',
    }))
  })
```

- [ ] **Step 2: Run failing submit test**

Run:

```bash
pnpm test src/app/api/action-pages/submit/route.test.ts
```

Expected: FAIL because submit route does not inspect outcome action metadata, default stage fallback, or attached action pages.

- [ ] **Step 3: Add submit route helpers**

In `src/app/api/action-pages/submit/route.ts`, import:

```ts
import { deeplinkActionPageUrl } from '@/lib/action-pages/urls'
import { getDefaultStageKind, resolveDefaultStageId } from '@/lib/action-pages/default-stage'
```

Add these interfaces near `ActionPageRecord`:

```ts
interface ParsedOutcomeAction {
  to_stage_id?: string | null
  messenger_text?: string
  attach_action_page_id?: string | null
  attach_cta_label?: string
  public_message?: string
}

interface AttachedActionPageRecord {
  id: string
  user_id: string
  kind: string
  slug: string
  title: string
  status: string
  cta_label: string | null
  signing_secret: string
}
```

Add helper functions above `POST`:

```ts
function parsedOutcomeAction(data: Record<string, unknown>): ParsedOutcomeAction | null {
  const raw = data.outcome_action
  return raw && typeof raw === 'object' ? (raw as ParsedOutcomeAction) : null
}

async function resolveAttachedActionPage(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  id: string,
): Promise<AttachedActionPageRecord | null> {
  const { data } = await admin
    .from('action_pages')
    .select('id, user_id, kind, slug, title, status, cta_label, signing_secret')
    .eq('id', id)
    .maybeSingle<AttachedActionPageRecord>()

  if (!data || data.user_id !== userId || data.status !== 'published') return null
  return data
}
```

- [ ] **Step 4: Apply outcome stage move and fallback**

Replace the `const rule = page.pipeline_rules.find(...)` block in the `if (leadId)` section with:

```ts
    const outcomeAction = parsedOutcomeAction(parsed.data)
    const rule = page.pipeline_rules.find((r) => r.outcome === parsed.outcome)
    let toStageId = outcomeAction?.to_stage_id || rule?.to_stage_id || null
    if (!toStageId) {
      const defaultKind = getDefaultStageKind(page.kind as ActionPageKind, parsed.outcome)
      if (defaultKind) {
        toStageId = await resolveDefaultStageId(admin, page.user_id, defaultKind)
      }
    }
    if (toStageId) {
      try {
        await applyStageMove({
          adminClient: admin,
          userId: page.user_id,
          leadId,
          toStageId,
          outcome: parsed.outcome,
          submissionId: subInsert?.id ?? null,
          threadId: messengerThreadId,
        })
      } catch (e) {
        console.warn('[action-pages.submit] stage move failed', {
          leadId,
          err: e instanceof Error ? e.message : String(e),
        })
      }
    }
```

- [ ] **Step 5: Apply outcome Messenger text and attached action page**

In the echo section, compute `outcomeAction` once before `matchedRule` and change `notifyText`:

```ts
  const outcomeAction = parsedOutcomeAction(parsed.data)
  const matchedRule = page.pipeline_rules.find((r) => r.outcome === parsed.outcome)
  const notifyText =
    (outcomeAction?.messenger_text && outcomeAction.messenger_text.trim()) ||
    (matchedRule?.notify_text && matchedRule.notify_text.trim()) ||
    page.notification_template?.text
```

After the existing echo send block, add:

```ts
  if (
    outcomeAction?.attach_action_page_id &&
    psid &&
    fbPageId &&
    messengerThreadId
  ) {
    try {
      const attached = await resolveAttachedActionPage(
        admin,
        page.user_id,
        outcomeAction.attach_action_page_id,
      )
      if (attached) {
        const { data: pageData } = await admin
          .from('facebook_pages')
          .select('page_access_token')
          .eq('id', fbPageId)
          .maybeSingle<{ page_access_token: string }>()
        const { data: threadData } = await admin
          .from('messenger_threads')
          .select('last_inbound_at')
          .eq('id', messengerThreadId)
          .maybeSingle<{ last_inbound_at: string | null }>()
        if (pageData?.page_access_token) {
          const token = decryptToken(pageData.page_access_token)
          const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
          const url = deeplinkActionPageUrl(attached.signing_secret, {
            slug: attached.slug,
            psid,
            pageId: fbPageId,
            exp,
          })
          const result = await sendOutbound({
            admin,
            thread: {
              id: messengerThreadId,
              psid,
              last_inbound_at: threadData?.last_inbound_at ?? null,
            },
            pageToken: token,
            payload: {
              kind: 'button',
              text: attached.title,
              url,
              ctaLabel:
                outcomeAction.attach_cta_label ||
                attached.cta_label ||
                'Open',
            },
            kind: 'submission_echo',
          })
          if (result.sent) {
            await admin.from('messenger_messages').insert({
              thread_id: messengerThreadId,
              user_id: page.user_id,
              direction: 'outbound',
              sender: 'bot',
              fb_message_id: result.messageId,
              body: `${attached.title}\n${outcomeAction.attach_cta_label || attached.cta_label || 'Open'} → ${url}`,
            })
          }
        }
      }
    } catch (e) {
      console.warn('[action-pages.submit] attached action page send failed', {
        psid,
        err: e instanceof Error ? e.message : String(e),
      })
    }
  }
```

- [ ] **Step 6: Run submit tests**

Run:

```bash
pnpm test src/app/api/action-pages/submit/route.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/action-pages/submit/route.ts src/app/api/action-pages/submit/route.test.ts
git commit -m "feat: apply qualification outcome actions on submit"
```

## Task 6: Render Outcome Public Thank-You Messages

**Files:**
- Modify: `src/app/api/action-pages/submit/route.ts`
- Modify: `src/app/a/[slug]/page.tsx`

- [ ] **Step 1: Change form redirect to include submission id**

In `src/app/api/action-pages/submit/route.ts`, replace the final form redirect with:

```ts
  const redirectUrl = new URL(`${base}/a/${slug}`)
  redirectUrl.searchParams.set('submitted', '1')
  if (subInsert?.id) redirectUrl.searchParams.set('submission', subInsert.id)
  return NextResponse.redirect(redirectUrl.toString(), { status: 303 })
```

- [ ] **Step 2: Add server lookup helper to public page**

In `src/app/a/[slug]/page.tsx`, import `createAdminClient`:

```ts
import { createAdminClient } from '@/lib/supabase/admin'
```

Add helper above the page component:

```ts
async function loadSubmissionPublicMessage(args: {
  pageId: string
  submissionId: string | null
}): Promise<string | null> {
  if (!args.submissionId) return null
  const admin = createAdminClient()
  const { data } = await admin
    .from('action_page_submissions')
    .select('data')
    .eq('id', args.submissionId)
    .eq('action_page_id', args.pageId)
    .maybeSingle<{ data: Record<string, unknown> | null }>()
  const outcomeAction = data?.data?.outcome_action
  if (!outcomeAction || typeof outcomeAction !== 'object') return null
  const msg = (outcomeAction as { public_message?: unknown }).public_message
  return typeof msg === 'string' && msg.trim() ? msg.trim() : null
}
```

Inside `PublicActionPage`, compute:

```ts
  const submissionId = typeof sp.submission === 'string' ? sp.submission : null
  const publicMessage = submitted
    ? await loadSubmissionPublicMessage({ pageId: result.page.id, submissionId })
    : null
```

Replace the generic submitted paragraph with:

```tsx
              {publicMessage ??
                'Your submission has been received. You can close this tab and head back to Messenger.'}
```

- [ ] **Step 3: Run focused route and type checks**

Run:

```bash
pnpm test src/app/api/action-pages/submit/route.test.ts
pnpm lint
```

Expected: tests PASS; lint PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/action-pages/submit/route.ts 'src/app/a/[slug]/page.tsx'
git commit -m "feat: show qualification outcome thank you message"
```

## Task 7: Plumb Stages And Action Pages Into Qualification Editor

**Files:**
- Modify: `src/app/(app)/dashboard/action-pages/_lib/queries.ts`
- Modify: `src/app/(app)/dashboard/action-pages/[id]/page.tsx`
- Modify: `src/app/(app)/dashboard/action-pages/_components/EditActionPageShell.tsx`
- Modify: `src/app/(app)/dashboard/action-pages/_components/KindEditor.tsx`
- Modify: `src/app/(app)/dashboard/action-pages/_kinds/types.ts`

- [ ] **Step 1: Extend query types**

In `queries.ts`, update `fetchPipelineStages()` to include kind:

```ts
export interface PipelineStageOption {
  id: string
  name: string
  kind: string | null
}

export async function fetchPipelineStages(
  supabase: SupabaseClient,
  userId: string,
): Promise<PipelineStageOption[]> {
  const { data, error } = await supabase
    .from('pipeline_stages')
    .select('id, name, kind, position')
    .eq('user_id', userId)
    .order('position', { ascending: true })
  if (error) throw new Error(`fetchPipelineStages: ${error.message}`)
  return (data ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
    kind: (s.kind as string | null) ?? null,
  }))
}
```

Add action page option support:

```ts
export interface ActionPageOption {
  id: string
  kind: ActionPageKind
  title: string
  status: ActionPageRow['status']
}

export async function fetchActionPageOptions(
  supabase: SupabaseClient,
  userId: string,
): Promise<ActionPageOption[]> {
  const { data, error } = await supabase
    .from('action_pages')
    .select('id, kind, title, status, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  if (error) throw new Error(`fetchActionPageOptions: ${error.message}`)
  return (data ?? []).map((p) => ({
    id: p.id as string,
    kind: p.kind as ActionPageKind,
    title: p.title as string,
    status: p.status as ActionPageRow['status'],
  }))
}
```

- [ ] **Step 2: Fetch and pass options**

In `[id]/page.tsx`, import `fetchActionPageOptions` and update the `Promise.all`:

```ts
  const [page, stages, actionPages] = await Promise.all([
    fetchActionPage(supabase, user.id, id),
    fetchPipelineStages(supabase, user.id),
    fetchActionPageOptions(supabase, user.id),
  ])
```

Pass `actionPages={actionPages}` to `EditActionPageShell`.

- [ ] **Step 3: Extend editor props**

In `_kinds/types.ts`:

```ts
import type { ActionPageOption, ActionPageRow, PipelineStageOption } from '../_lib/queries'

export interface KindEditorProps {
  page: ActionPageRow
  stages?: PipelineStageOption[]
  actionPages?: ActionPageOption[]
}
```

In `EditActionPageShell.tsx`, import the option types and add `actionPages` to the top-level component props and to `EditActionPageShellInner`. Do not pass `actionPages` to `CatalogShell` or `RealestateShell`; those shells do not render the qualification editor. For the default shell, update the kind editor call:

```tsx
<KindEditor page={page} stages={stages} actionPages={actionPages} />
```

In `KindEditor.tsx`:

```ts
import type { ActionPageOption, ActionPageRow, PipelineStageOption } from '../_lib/queries'

export function KindEditor({
  page,
  stages = [],
  actionPages = [],
}: {
  page: ActionPageRow
  stages?: PipelineStageOption[]
  actionPages?: ActionPageOption[]
}) {
```

Pass extras only to qualification:

```tsx
case 'qualification':
  return <QualificationEditor page={page} stages={stages} actionPages={actionPages} />
```

- [ ] **Step 4: Run lint**

Run:

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(app)/dashboard/action-pages/_lib/queries.ts' 'src/app/(app)/dashboard/action-pages/[id]/page.tsx' 'src/app/(app)/dashboard/action-pages/_components/EditActionPageShell.tsx' 'src/app/(app)/dashboard/action-pages/_components/KindEditor.tsx' 'src/app/(app)/dashboard/action-pages/_kinds/types.ts'
git commit -m "feat: pass outcome editor options to qualification pages"
```

## Task 8: Replace Qualification Scoring UI With Outcome Cards

**Files:**
- Modify: `src/app/(app)/dashboard/action-pages/_kinds/qualification/Editor.tsx`

- [ ] **Step 1: Add local editor helpers**

In `Editor.tsx`, import `QualificationOutcomeAction`:

```ts
  type QualificationOutcomeAction,
```

Update the component signature:

```ts
export default function QualificationEditor({
  page,
  stages = [],
  actionPages = [],
}: KindEditorProps) {
```

Add helper functions inside the component:

```ts
  const setOutcome = (idx: number, patch: Partial<QualificationOutcomeAction>) =>
    setConfig((c) => {
      const next = [...c.outcomes]
      next[idx] = { ...next[idx], ...patch }
      return { ...c, outcomes: next }
    })

  const addOutcome = () =>
    setConfig((c) => ({
      ...c,
      outcomes: [
        ...c.outcomes,
        {
          id: `outcome_${Date.now()}`,
          label: 'Custom outcome',
          outcome: 'custom_outcome',
          match: { kind: 'score_at_least', value: c.scoring.threshold ?? 1 },
          to_stage_id: null,
          messenger_text: '',
          attach_action_page_id: null,
          attach_cta_label: '',
          public_message: '',
        },
      ],
    }))

  const removeOutcome = (idx: number) =>
    setConfig((c) => ({ ...c, outcomes: c.outcomes.filter((_, i) => i !== idx) }))
```

- [ ] **Step 2: Remove unused rating pass field**

Delete the `Pass at (optional)` field for rating questions because `min_rating_to_pass` is not used by scoring. Keep only `Max value`.

- [ ] **Step 3: Replace Scoring subsection with Outcomes subsection**

Replace the current `Scoring` subsection and `Outro messages` subsection with:

```tsx
      <Subsection
        title="Outcomes"
        right={
          <button
            type="button"
            onClick={addOutcome}
            className="rounded-md border border-[#D1D5DB] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
          >
            + Add outcome
          </button>
        }
      >
        <div className="space-y-3">
          {config.outcomes.map((outcome, idx) => (
            <OutcomeCard
              key={outcome.id}
              outcome={outcome}
              questions={config.questions}
              stages={stages}
              actionPages={actionPages.filter((p) => p.id !== page.id && p.status === 'published')}
              onChange={(patch) => setOutcome(idx, patch)}
              onRemove={() => removeOutcome(idx)}
            />
          ))}
        </div>
      </Subsection>
```

Add an `OutcomeCard` component below `OptionsEditor`. The component must render:

- label input,
- outcome key input,
- match kind select,
- numeric value input for score matches,
- question select and value input for answer matches,
- stage select,
- Messenger reply textarea,
- attach action page select,
- CTA label input,
- public message textarea,
- remove button.

Use these prop types:

```ts
function OutcomeCard({
  outcome,
  questions,
  stages,
  actionPages,
  onChange,
  onRemove,
}: {
  outcome: QualificationOutcomeAction
  questions: QualificationQuestion[]
  stages: NonNullable<KindEditorProps['stages']>
  actionPages: NonNullable<KindEditorProps['actionPages']>
  onChange: (patch: Partial<QualificationOutcomeAction>) => void
  onRemove: () => void
}) {
```

Inside `OutcomeCard`, use this match update helper:

```ts
  const setMatchKind = (kind: QualificationOutcomeAction['match']['kind']) => {
    if (kind === 'score_at_least') onChange({ match: { kind, value: 1 } })
    else if (kind === 'score_below') onChange({ match: { kind, value: 1 } })
    else if (kind === 'manual_review') onChange({ match: { kind } })
    else if (kind === 'answer_equals') {
      onChange({ match: { kind, question_id: questions[0]?.id ?? '', value: '' } })
    } else {
      onChange({ match: { kind, question_id: questions[0]?.id ?? '', value: '' } })
    }
  }
```

- [ ] **Step 4: Run lint**

Run:

```bash
pnpm lint
```

Expected: PASS. If line length or JSX nesting is hard to read, split `OutcomeCard` into `src/app/(app)/dashboard/action-pages/_kinds/qualification/OutcomeCard.tsx` and import it.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(app)/dashboard/action-pages/_kinds/qualification/Editor.tsx'
git commit -m "feat: configure qualification outcomes in editor"
```

## Task 9: Make Generic Pipeline Rules Compatible With Custom Qualification Outcomes

**Files:**
- Modify: `src/app/(app)/dashboard/action-pages/_components/PipelineRulesEditor.tsx`

- [ ] **Step 1: Allow custom qualification outcome entry**

Change the qualification branch in `OUTCOMES_BY_KIND` usage so qualification can still select preset outcomes but also type a custom outcome. Add local state:

```ts
  const allowCustomOutcome = kind === 'qualification'
```

In the outcome field render, for `allowCustomOutcome`, render both a select and an input:

```tsx
                {allowCustomOutcome ? (
                  <div className="space-y-1">
                    <select
                      value={outcomes.some((o) => o.value === rule.outcome) ? rule.outcome : ''}
                      onChange={(e) => update(i, { outcome: e.target.value })}
                      className="w-full rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
                    >
                      <option value="">Custom outcome</option>
                      {outcomes.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <input
                      value={rule.outcome}
                      onChange={(e) => update(i, { outcome: e.target.value })}
                      placeholder="custom_outcome"
                      className="w-full rounded border border-[#E5E7EB] px-2 py-1 font-mono text-[12px]"
                    />
                  </div>
                ) : outcomes.length > 0 ? (
```

Keep the existing select and generic input branches for other kinds.

- [ ] **Step 2: Run lint**

Run:

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/(app)/dashboard/action-pages/_components/PipelineRulesEditor.tsx'
git commit -m "feat: allow custom qualification pipeline outcomes"
```

## Task 10: Render Dynamic Qualification Submission Stats

**Files:**
- Modify: `src/app/(app)/dashboard/action-pages/[id]/submissions/page.tsx`

- [ ] **Step 1: Replace fixed qualification stat counts**

In `QualificationView`, replace fixed `qualified`, `disqualified`, and `pending` arrays with dynamic counts:

```ts
  const outcomeCounts = Array.from(
    submissions.reduce((map, s) => {
      const key = s.outcome || 'unknown'
      map.set(key, (map.get(key) ?? 0) + 1)
      return map
    }, new Map<string, number>()),
  ).sort((a, b) => b[1] - a[1])
```

Replace the stat grid with:

```tsx
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {outcomeCounts.slice(0, 3).map(([outcome, count]) => (
          <StatCard
            key={outcome}
            value={count}
            label={formatOutcomeLabel(outcome)}
            color={qualificationStatColor(outcome)}
          />
        ))}
        <StatCard value={thisWeek.length} label="This week" color="blue" />
      </div>
```

Add helpers near `OUTCOME_META`:

```ts
function formatOutcomeLabel(outcome: string): string {
  return OUTCOME_META[outcome]?.label ?? outcome.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function qualificationStatColor(outcome: string): 'green' | 'red' | 'amber' | 'blue' | 'violet' | 'indigo' {
  if (/disqual|lost|not_fit/i.test(outcome)) return 'red'
  if (/review|pending/i.test(outcome)) return 'amber'
  if (/qual|won|hot/i.test(outcome)) return 'green'
  return 'indigo'
}
```

- [ ] **Step 2: Run lint**

Run:

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/(app)/dashboard/action-pages/[id]/submissions/page.tsx'
git commit -m "feat: show dynamic qualification outcome stats"
```

## Task 11: Final Verification

**Files:**
- All changed files

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm test src/lib/action-pages/qualification-outcomes.test.ts src/lib/action-pages/default-stage.test.ts src/lib/action-pages/handlers/qualification.score.test.ts src/app/api/action-pages/submit/route.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
pnpm lint
```

Expected: PASS.

- [ ] **Step 4: Manual browser check**

Run:

```bash
pnpm dev
```

Expected: dev server starts. Open a qualification action page editor and verify:

- Questions still edit and save.
- Outcomes show preset cards.
- Each outcome can select a stage.
- Each outcome can select a published action page.
- Saving persists `config.outcomes`.
- Submitting a Messenger-attributed qualification records the matched outcome.
- The lead moves by outcome stage or default qualifying/lost fallback.
- Messenger receives the outcome message.
- Messenger receives a second button when the outcome has an attached action page.
- Public submitted page shows the outcome public message.

- [ ] **Step 5: Commit verification fixes**

If verification required small fixes, commit them:

```bash
git add src docs
git commit -m "fix: polish qualification outcome actions"
```

Skip this commit when no verification fixes were needed.
