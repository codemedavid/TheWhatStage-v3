# Action Page: Effective Trigger + Default Stage Moves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make property-sourced submissions trigger property-page workflows and pipeline rules, and add deterministic default stage moves for every action page kind.

**Architecture:** Resolve an `effectivePage` inside the action-page submit handler. If a submission has a validated `source_property_action_page_id`, the property page is the effective page; otherwise the submitted page is. Use `effectivePage` for workflow dispatch + `pipeline_rules` lookup. When no rule has `to_stage_id`, fall back to a code-level `defaultStageKind` table keyed by `(kind, outcome)` and resolve to the user's first `pipeline_stages` row of that kind.

**Tech Stack:** TypeScript, Next.js App Router, Vitest, Supabase (Postgres). Spec: `docs/superpowers/specs/2026-05-09-action-page-effective-trigger-and-default-stage-design.md`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/action-pages/kinds.ts` | Add optional `defaultStageKind` to `KindMeta.defaultPipelineRules[]` entries |
| `src/lib/action-pages/default-stage.ts` (new) | Pure helper `getDefaultStageKind(kind, outcome)` + DB helper `resolveDefaultStageId(admin, userId, kind)` + `PipelineStageKind` type |
| `src/lib/action-pages/default-stage.test.ts` (new) | Unit tests for both helpers |
| `src/app/api/action-pages/submit/route.ts` | Build `effectivePage`, swap dispatch `actionPageId`, pull rules from `effectivePage`, apply default fallback |
| `src/app/api/action-pages/submit/route.test.ts` | Add tests for property-source trigger + default stage moves |

---

## Task 1: Add `defaultStageKind` field to KindMeta and populate per spec

**Files:**
- Modify: `src/lib/action-pages/kinds.ts`

- [ ] **Step 1: Update the `KindMeta` interface to include the optional field**

Replace the `defaultPipelineRules` line (currently `defaultPipelineRules: { outcome: string; reason: string }[]`) inside the `KindMeta` interface with:

```ts
  defaultPipelineRules: {
    outcome: string
    reason: string
    /**
     * Default `pipeline_stages.kind` to move the lead into when the user
     * hasn't configured `to_stage_id` for this outcome. Resolved at runtime
     * by `resolveDefaultStageId`. Omit to skip auto-move for this outcome.
     */
    defaultStageKind?:
      | 'entry'
      | 'qualifying'
      | 'nurture'
      | 'decision'
      | 'won'
      | 'lost'
      | 'dormant'
  }[]
```

- [ ] **Step 2: Populate `defaultStageKind` in every entry of `KIND_REGISTRY`**

Per the spec mapping table:

```ts
// form
defaultPipelineRules: [{ outcome: 'submitted', reason: 'Form submitted', defaultStageKind: 'qualifying' }],

// booking
defaultPipelineRules: [{ outcome: 'booked', reason: 'Appointment booked', defaultStageKind: 'decision' }],

// qualification
defaultPipelineRules: [
  { outcome: 'qualified', reason: 'Passed qualification', defaultStageKind: 'qualifying' },
  { outcome: 'disqualified', reason: 'Did not qualify', defaultStageKind: 'lost' },
  { outcome: 'pending_review', reason: 'Awaiting manual qualification review' }, // no default
],

// sales
defaultPipelineRules: [
  { outcome: 'submitted', reason: 'Lead submitted via sales page', defaultStageKind: 'qualifying' },
  { outcome: 'checked_out', reason: 'Sales page checkout', defaultStageKind: 'won' },
],

// catalog
defaultPipelineRules: [{ outcome: 'checked_out', reason: 'Catalog checkout', defaultStageKind: 'won' }],

// realestate
defaultPipelineRules: [
  { outcome: 'inquiry_submitted', reason: 'Property inquiry submitted', defaultStageKind: 'qualifying' },
  { outcome: 'viewing_booked', reason: 'Viewing booked', defaultStageKind: 'decision' },
],
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS, no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/action-pages/kinds.ts
git commit -m "feat(action-pages): add defaultStageKind to KindMeta entries"
```

---

## Task 2: Create `default-stage.ts` module with helpers + tests (TDD)

**Files:**
- Create: `src/lib/action-pages/default-stage.ts`
- Create: `src/lib/action-pages/default-stage.test.ts`

- [ ] **Step 1: Write the failing tests for `getDefaultStageKind`**

Create `src/lib/action-pages/default-stage.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { getDefaultStageKind, resolveDefaultStageId } from './default-stage'

describe('getDefaultStageKind', () => {
  it('returns decision for booking/booked', () => {
    expect(getDefaultStageKind('booking', 'booked')).toBe('decision')
  })
  it('returns won for catalog/checked_out', () => {
    expect(getDefaultStageKind('catalog', 'checked_out')).toBe('won')
  })
  it('returns won for sales/checked_out', () => {
    expect(getDefaultStageKind('sales', 'checked_out')).toBe('won')
  })
  it('returns qualifying for sales/submitted', () => {
    expect(getDefaultStageKind('sales', 'submitted')).toBe('qualifying')
  })
  it('returns qualifying for realestate/inquiry_submitted', () => {
    expect(getDefaultStageKind('realestate', 'inquiry_submitted')).toBe('qualifying')
  })
  it('returns decision for realestate/viewing_booked', () => {
    expect(getDefaultStageKind('realestate', 'viewing_booked')).toBe('decision')
  })
  it('returns lost for qualification/disqualified', () => {
    expect(getDefaultStageKind('qualification', 'disqualified')).toBe('lost')
  })
  it('returns null for qualification/pending_review (no default)', () => {
    expect(getDefaultStageKind('qualification', 'pending_review')).toBeNull()
  })
  it('returns null for unknown outcome', () => {
    expect(getDefaultStageKind('form', 'no_such_outcome')).toBeNull()
  })
})

describe('resolveDefaultStageId', () => {
  function makeAdmin(rows: Array<{ id: string }>) {
    const limit = vi.fn(async () => ({ data: rows, error: null }))
    const order = vi.fn(() => ({ limit }))
    const eqKind = vi.fn(() => ({ order }))
    const eqUser = vi.fn(() => ({ eq: eqKind }))
    const select = vi.fn(() => ({ eq: eqUser }))
    const from = vi.fn(() => ({ select }))
    return { from, _calls: { from, select, eqUser, eqKind, order, limit } }
  }

  it('returns the first stage id for the (user, kind) match', async () => {
    const admin = makeAdmin([{ id: 'stage_decision_1' }])
    const id = await resolveDefaultStageId(admin as never, 'user_1', 'decision')
    expect(id).toBe('stage_decision_1')
    expect(admin._calls.from).toHaveBeenCalledWith('pipeline_stages')
    expect(admin._calls.eqUser).toHaveBeenCalledWith('user_id', 'user_1')
    expect(admin._calls.eqKind).toHaveBeenCalledWith('kind', 'decision')
    expect(admin._calls.order).toHaveBeenCalledWith('position', { ascending: true })
    expect(admin._calls.limit).toHaveBeenCalledWith(1)
  })

  it('returns null when no stage matches', async () => {
    const admin = makeAdmin([])
    const id = await resolveDefaultStageId(admin as never, 'user_1', 'won')
    expect(id).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/lib/action-pages/default-stage.test.ts`
Expected: FAIL — module `./default-stage` not found.

- [ ] **Step 3: Implement `default-stage.ts`**

Create `src/lib/action-pages/default-stage.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { KIND_REGISTRY, type ActionPageKind } from './kinds'

export type PipelineStageKind =
  | 'entry'
  | 'qualifying'
  | 'nurture'
  | 'decision'
  | 'won'
  | 'lost'
  | 'dormant'

/**
 * Returns the default `pipeline_stages.kind` for the given action page kind +
 * submission outcome, or null when there is no default (e.g.
 * `pending_review`) or the outcome is unknown for the kind.
 */
export function getDefaultStageKind(
  pageKind: ActionPageKind,
  outcome: string,
): PipelineStageKind | null {
  const meta = KIND_REGISTRY[pageKind]
  if (!meta) return null
  const rule = meta.defaultPipelineRules.find((r) => r.outcome === outcome)
  return (rule?.defaultStageKind as PipelineStageKind | undefined) ?? null
}

/**
 * Resolves the user's first pipeline stage of the given kind. Returns the
 * stage id, or null when the user has no stage of that kind.
 */
export async function resolveDefaultStageId(
  admin: SupabaseClient,
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
  if (error || !data || data.length === 0) return null
  return (data[0] as { id: string }).id
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/action-pages/default-stage.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 5: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/action-pages/default-stage.ts src/lib/action-pages/default-stage.test.ts
git commit -m "feat(action-pages): add default-stage helpers (kind lookup + DB resolve)"
```

---

## Task 3: Wire `effectivePage` + default stage fallback into submit handler

**Files:**
- Modify: `src/app/api/action-pages/submit/route.ts`

This task modifies three regions of the submit handler. They are interdependent (later steps reference `effectivePage` defined in earlier steps), so do them in order without a commit until step 6.

- [ ] **Step 1: Extend the property validation query to include `kind` + `pipeline_rules`**

Locate the existing block at `src/app/api/action-pages/submit/route.ts:255–279` (the `validatedSourceProperty` declaration). Currently:

```ts
let validatedSourceProperty: { id: string; title: string | null } | null = null
if (sourcePropertyActionPageId) {
  const { data: prop } = await admin
    .from('action_pages')
    .select('id, title, kind, status, user_id')
    .eq('id', sourcePropertyActionPageId)
    .maybeSingle<{
      id: string
      title: string | null
      kind: string
      status: string
      user_id: string
    }>()
  if (
    prop &&
    prop.kind === 'realestate' &&
    prop.status === 'published' &&
    prop.user_id === page.user_id
  ) {
    validatedSourceProperty = {
      id: prop.id,
      title: sourcePropertyTitle || prop.title,
    }
  }
}
```

Replace with:

```ts
let validatedSourceProperty:
  | {
      id: string
      title: string | null
      pipeline_rules: Array<{ outcome: string; to_stage_id: string | null; reason?: string }>
    }
  | null = null
if (sourcePropertyActionPageId) {
  const { data: prop } = await admin
    .from('action_pages')
    .select('id, title, kind, status, user_id, pipeline_rules')
    .eq('id', sourcePropertyActionPageId)
    .maybeSingle<{
      id: string
      title: string | null
      kind: string
      status: string
      user_id: string
      pipeline_rules: Array<{ outcome: string; to_stage_id: string | null; reason?: string }> | null
    }>()
  if (
    prop &&
    prop.kind === 'realestate' &&
    prop.status === 'published' &&
    prop.user_id === page.user_id
  ) {
    validatedSourceProperty = {
      id: prop.id,
      title: sourcePropertyTitle || prop.title,
      pipeline_rules: prop.pipeline_rules ?? [],
    }
  }
}
```

If `submissionMeta.source_property_title` is set from `validatedSourceProperty.title` later in the file (around line 314), that line is unchanged — `validatedSourceProperty.title` still exists.

- [ ] **Step 2: Build `effectivePage` after the property validation block**

Immediately after the `validatedSourceSales` block (the existing block at ~line 281–308 ends around line 308–309), before the `submissionMeta` declaration at ~line 310, insert:

```ts
// effectivePage: when a property is the source of this submission, treat the
// property page as the trigger surface for workflows and pipeline rules.
// Otherwise the submitted page is itself the effective page. The submission
// row, funnel advance, and booking-offset reminders still belong to `page`.
const effectivePage: {
  id: string
  user_id: string
  kind: typeof page.kind
  pipeline_rules: typeof page.pipeline_rules
} = validatedSourceProperty
  ? {
      id: validatedSourceProperty.id,
      user_id: page.user_id,
      kind: 'realestate',
      pipeline_rules: validatedSourceProperty.pipeline_rules,
    }
  : {
      id: page.id,
      user_id: page.user_id,
      kind: page.kind,
      pipeline_rules: page.pipeline_rules,
    }
```

- [ ] **Step 3: Use `effectivePage.id` in the workflow dispatch**

At ~line 392–401, the current dispatch reads:

```ts
if (subInsert?.id) {
  dispatchSubmissionReceived(admin, {
    userId: page.user_id,
    submissionId: subInsert.id,
    actionPageId: page.id,
    outcome: parsed.outcome,
    leadId: leadId ?? null,
    threadId: messengerThreadId ?? null,
  }).catch((e) => console.error('[action-pages.submit] dispatchSubmissionReceived threw', e))
}
```

Change `actionPageId: page.id` to `actionPageId: effectivePage.id`:

```ts
if (subInsert?.id) {
  dispatchSubmissionReceived(admin, {
    userId: page.user_id,
    submissionId: subInsert.id,
    actionPageId: effectivePage.id,
    outcome: parsed.outcome,
    leadId: leadId ?? null,
    threadId: messengerThreadId ?? null,
  }).catch((e) => console.error('[action-pages.submit] dispatchSubmissionReceived threw', e))
}
```

- [ ] **Step 4: Replace the rule-only stage move block with rule + default fallback**

At ~line 446–465, the current block reads:

```ts
if (leadId) {
  const rule = page.pipeline_rules.find((r) => r.outcome === parsed.outcome)
  if (rule?.to_stage_id) {
    try {
      await applyStageMove({
        adminClient: admin,
        userId: page.user_id,
        leadId,
        toStageId: rule.to_stage_id,
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
  try {
    await advanceLeadFunnelForActionPage({
      adminClient: admin,
      leadId,
      userId: page.user_id,
      actionPageId: page.id,
    })
  } catch (e) {
    console.warn('[action-pages.submit] funnel advance failed', {
      leadId,
      err: e instanceof Error ? e.message : String(e),
    })
  }
}
```

Replace with:

```ts
if (leadId) {
  const rule = effectivePage.pipeline_rules.find((r) => r.outcome === parsed.outcome)
  let toStageId: string | null = rule?.to_stage_id ?? null

  if (!toStageId) {
    const defaultKind = getDefaultStageKind(effectivePage.kind, parsed.outcome)
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

  try {
    await advanceLeadFunnelForActionPage({
      adminClient: admin,
      leadId,
      userId: page.user_id,
      actionPageId: page.id,
    })
  } catch (e) {
    console.warn('[action-pages.submit] funnel advance failed', {
      leadId,
      err: e instanceof Error ? e.message : String(e),
    })
  }
}
```

- [ ] **Step 5: Add the new imports at the top of the file**

Find the existing import group near the top of `src/app/api/action-pages/submit/route.ts`. Add:

```ts
import {
  getDefaultStageKind,
  resolveDefaultStageId,
} from '@/lib/action-pages/default-stage'
```

(Place alphabetically among the `@/lib/action-pages/*` imports.)

- [ ] **Step 6: Run typecheck**

Run: `pnpm tsc --noEmit`
Expected: PASS, no new errors.

- [ ] **Step 7: Run the existing submit-route test to make sure nothing regressed**

Run: `pnpm vitest run src/app/api/action-pages/submit/route.test.ts`
Expected: PASS — existing tests still green (they don't exercise the property-source path or default fallback yet; those go in Task 4).

- [ ] **Step 8: Commit**

```bash
git add src/app/api/action-pages/submit/route.ts
git commit -m "fix(action-pages): use property as effective trigger; default stage fallback"
```

---

## Task 4: Add submit-route tests for property-source trigger and default stage moves

**Files:**
- Modify: `src/app/api/action-pages/submit/route.test.ts`

The existing test file mocks `admin.from(...)` per-table. We need to extend the mock so that:
- `from('action_pages')` can return a property row when queried by id (in addition to the default booking/form page).
- `from('pipeline_stages')` returns a stage matching `(user_id, kind)`.
- We can capture calls to `dispatchSubmissionReceived` so we can assert `actionPageId`.

We mock the workflow dispatcher module directly to avoid driving DB-side behavior.

- [ ] **Step 1: Add a module mock for the workflow dispatcher**

Near the top of `src/app/api/action-pages/submit/route.test.ts`, alongside the existing `vi.mock(...)` calls, add:

```ts
const dispatcherMocks = vi.hoisted(() => ({
  dispatchSubmissionReceived: vi.fn(async () => undefined),
  dispatchBookingOffsets: vi.fn(async () => undefined),
  dispatchStageEntered: vi.fn(async () => undefined),
}))

vi.mock('@/lib/workflow/dispatcher', () => ({
  dispatchSubmissionReceived: dispatcherMocks.dispatchSubmissionReceived,
  dispatchBookingOffsets: dispatcherMocks.dispatchBookingOffsets,
  dispatchStageEntered: dispatcherMocks.dispatchStageEntered,
}))
```

Also add `beforeEach(() => { dispatcherMocks.dispatchSubmissionReceived.mockClear() })` inside each `describe` block that uses it (or a top-level one).

- [ ] **Step 2: Extend `makeAdminMock` to support a `realestate` page lookup and `pipeline_stages`**

Locate `makeAdminMock` in the test file. Replace the `from('action_pages')` arm with a version that returns different rows depending on the queried `id`, and add a `from('pipeline_stages')` arm. The pattern below preserves the existing `eq('id', ...).maybeSingle()` shape and adds `.eq().eq().order().limit()` for `pipeline_stages`:

```ts
const from = vi.fn((table: string) => {
  if (table === 'action_pages') {
    return {
      select: vi.fn(() => ({
        eq: vi.fn((_col: string, value: string) => ({
          maybeSingle: vi.fn(async () => {
            if (value === 'prop_1') {
              return {
                data: {
                  id: 'prop_1',
                  user_id: 'user_1',
                  kind: 'realestate',
                  slug: 'sunset-villa',
                  status: 'published',
                  title: 'Sunset Villa',
                  config: makeActionPageConfig(),
                  pipeline_rules: [
                    // optionally overridden in tests via a helper; default empty
                  ],
                  notification_template: { text: 'Thanks' },
                  signing_secret: 'secret',
                },
                error: null,
              }
            }
            // default = the booking/form page used by existing tests
            return {
              data: {
                id: 'ap_1',
                user_id: 'user_1',
                kind: 'form',
                slug: 'welcome-form',
                status: 'published',
                config: makeActionPageConfig(),
                pipeline_rules: [],
                notification_template: { text: 'Thanks, we received it.' },
                signing_secret: 'secret',
              },
              error: null,
            }
          }),
        })),
      })),
    }
  }

  if (table === 'pipeline_stages') {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn((_col: string, kind: string) => ({
            order: vi.fn(() => ({
              limit: vi.fn(async () => ({
                data: pipelineStageRows[kind] ?? [],
                error: null,
              })),
            })),
          })),
        })),
      })),
    }
  }

  // ...existing branches for messenger_threads, leads, action_page_submissions, etc.
})
```

Add a module-scoped `pipelineStageRows: Record<string, Array<{ id: string }>>` that tests populate per case (e.g. `{ decision: [{ id: 'stage_decision' }] }`).

(Keep the rest of `makeAdminMock` — the `messenger_threads`, `leads`, `action_page_submissions`, etc. arms — unchanged. If a particular branch of the mock is not present in the current test file because the existing tests don't exercise stage moves, add minimal stubs that return `{ data: null, error: null }` to keep `set_lead_stage` RPC and stage-event inserts no-ops.)

- [ ] **Step 3: Add a test — property-sourced submission dispatches with the property id**

Add inside the existing `describe('POST /api/action-pages/submit', ...)` block:

```ts
it('uses the source property id as the workflow trigger when present', async () => {
  pipelineStageRows = { decision: [{ id: 'stage_decision' }] }
  mocks.admin = makeAdminMock()

  const res = await POST(makeJsonRequest({
    page_id: 'ap_1',                  // booking page, but with property source
    outcome: 'viewing_booked',
    data: { full_name: 'Buyer', phone: '+639170000000', slot_iso: '2026-06-01T01:00:00Z' },
    source_property_action_page_id: 'prop_1',
  }))

  expect(res.status).toBe(200)
  expect(dispatcherMocks.dispatchSubmissionReceived).toHaveBeenCalledTimes(1)
  const arg = dispatcherMocks.dispatchSubmissionReceived.mock.calls[0][1]
  expect(arg.actionPageId).toBe('prop_1')
  expect(arg.outcome).toBe('viewing_booked')
})
```

- [ ] **Step 4: Add a test — default stage fallback when no rule has `to_stage_id`**

```ts
it('falls back to default stage kind when no pipeline rule has to_stage_id', async () => {
  // Booking page with no configured to_stage_id, lead present, user has a `decision` stage.
  pipelineStageRows = { decision: [{ id: 'stage_decision' }] }
  const admin = makeAdminMock()
  // capture set_lead_stage RPC calls
  const rpcCalls: Array<{ name: string; args: unknown }> = []
  admin.rpc = vi.fn((name: string, args: unknown) => {
    rpcCalls.push({ name, args })
    return { data: { stage_id: 'stage_decision' }, error: null }
  })
  mocks.admin = admin

  const res = await POST(makeJsonRequest({
    page_id: 'ap_1',
    outcome: 'submitted',  // form/submitted -> default qualifying; this test uses booking instead
    data: { full_name: 'Lead', phone: '+639170000001' },
    // attach a leadId-bearing deeplink token so leadId resolves; reuse helper from existing tests
    deeplink: buildDeeplinkParams({ leadId: 'lead_1', /* ... per existing helper */ }),
  }))

  expect(res.status).toBe(200)
  const stageCall = rpcCalls.find((c) => c.name === 'set_lead_stage')
  expect(stageCall).toBeTruthy()
  expect((stageCall!.args as { p_to_stage_id: string }).p_to_stage_id).toBe('stage_decision')
})
```

If the existing test file already has a fixture/helper that produces a leadId-bearing deeplink, reuse it verbatim; check `route.test.ts` for the pattern (the file uses `buildDeeplinkParams` imported at the top).

- [ ] **Step 5: Add a test — explicit `to_stage_id` on the property page wins**

```ts
it('property-sourced submission honors property pipeline_rules.to_stage_id', async () => {
  // override the property mock to have a rule with to_stage_id
  pipelineStageRows = { decision: [{ id: 'stage_decision' }] }  // would resolve here if no rule
  const admin = makeAdminMock()
  // patch the action_pages branch so prop_1 returns a configured rule
  const origFrom = admin.from
  admin.from = vi.fn((table: string) => {
    if (table === 'action_pages') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((_col: string, value: string) => ({
            maybeSingle: vi.fn(async () => {
              if (value === 'prop_1') {
                return {
                  data: {
                    id: 'prop_1',
                    user_id: 'user_1',
                    kind: 'realestate',
                    status: 'published',
                    title: 'Sunset Villa',
                    pipeline_rules: [
                      { outcome: 'viewing_booked', to_stage_id: 'stage_proposal_explicit', reason: 'x' },
                    ],
                    config: makeActionPageConfig(),
                    notification_template: { text: 'Thanks' },
                    signing_secret: 'secret',
                  },
                  error: null,
                }
              }
              return origFrom(table).select().eq(_col, value).maybeSingle()
            }),
          })),
        })),
      }
    }
    return origFrom(table)
  })

  const rpcCalls: Array<{ name: string; args: unknown }> = []
  admin.rpc = vi.fn((name: string, args: unknown) => {
    rpcCalls.push({ name, args })
    return { data: { stage_id: 'stage_proposal_explicit' }, error: null }
  })
  mocks.admin = admin

  const res = await POST(makeJsonRequest({
    page_id: 'ap_1',
    outcome: 'viewing_booked',
    data: { full_name: 'Buyer', phone: '+639170000002', slot_iso: '2026-06-01T01:00:00Z' },
    source_property_action_page_id: 'prop_1',
    deeplink: buildDeeplinkParams({ leadId: 'lead_1' /* ... */ }),
  }))

  expect(res.status).toBe(200)
  const stageCall = rpcCalls.find((c) => c.name === 'set_lead_stage')
  expect(stageCall).toBeTruthy()
  expect((stageCall!.args as { p_to_stage_id: string }).p_to_stage_id).toBe('stage_proposal_explicit')
})
```

- [ ] **Step 6: Add a test — no matching default stage = no move, no error**

```ts
it('skips silently when user has no pipeline_stage of the default kind', async () => {
  pipelineStageRows = {}  // no stages at all
  const admin = makeAdminMock()
  const rpcCalls: Array<{ name: string; args: unknown }> = []
  admin.rpc = vi.fn((name: string, args: unknown) => {
    rpcCalls.push({ name, args })
    return { data: null, error: null }
  })
  mocks.admin = admin

  const res = await POST(makeJsonRequest({
    page_id: 'ap_1',
    outcome: 'submitted',
    data: { full_name: 'Lead', phone: '+639170000003' },
    deeplink: buildDeeplinkParams({ leadId: 'lead_1' /* ... */ }),
  }))

  expect(res.status).toBe(200)
  expect(rpcCalls.find((c) => c.name === 'set_lead_stage')).toBeUndefined()
})
```

- [ ] **Step 7: Run the full submit-route test suite**

Run: `pnpm vitest run src/app/api/action-pages/submit/route.test.ts`
Expected: PASS — all existing + 4 new tests green.

If a test fails because the existing `makeAdminMock` lacks a stub for some table touched along the new path (e.g. `lead_stage_events`, `action_page_submissions`), add a minimal `{ data: null, error: null }` stub for that table in the mock — do not change production behavior to accommodate the test.

- [ ] **Step 8: Run the full test + typecheck once more**

Run: `pnpm vitest run && pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/api/action-pages/submit/route.test.ts
git commit -m "test(action-pages): cover property-source trigger and default stage fallback"
```

---

## Self-Review Notes

- Spec coverage: section 1 (effective page) → Task 3; section 2 (default stage) → Tasks 1–2; section 3 (application order) → Task 3 step 4; section 4 (workflow dispatch) → Task 3 step 3; tests 1–6 from spec → Task 4 + Task 2 unit tests (test #6 "disqualified" is covered by `getDefaultStageKind` unit test).
- Type consistency: `effectivePage.kind` is typed as `typeof page.kind`, which is `ActionPageKind` — matches `getDefaultStageKind`'s first param. `resolveDefaultStageId` returns `string | null`, assigned to `toStageId: string | null`. `applyStageMove` requires `toStageId: string`, guarded by `if (toStageId)`.
- No placeholders. The deeplink helper call shape is the only thing the implementer must look up in the existing test file — that's a deliberate "follow established pattern" reference, not a TODO.
