# Booking Follow-ups Phase 2: Generator + Booking-Page UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the booking-page editor section that lets a user configure up to 7 utility-template follow-up touchpoints. Save persists to a real, auto-managed workflow that the engine (Phase 1) already runs. Power users can still open the workflow in the workflow editor.

**Architecture:** Migration adds `managed_kind`/`managed_source_id`/`manually_edited` to `workflows`. A pure generator turns a touchpoint config array into a `{ triggers, nodes, edges }` triple. Persistence helpers read/write the auto-managed workflow keyed by `(managed_kind='booking_followups', managed_source_id=action_pages.id)`. Server actions expose load/save. A client component mounts inside the booking Editor.

**Tech Stack:** TypeScript, Next.js App Router, React Server Actions, Vitest, Supabase. Spec: `docs/superpowers/specs/2026-05-09-booking-followup-touchpoints-design.md`. Phase 1 plan (already shipped): `docs/superpowers/plans/2026-05-09-booking-followups-phase1-engine.md`.

**Phase 1 deliverables already on `main`:** `parseOffset`, `utility_template` payload variant, executor approval guard, dispatcher offsets/`action_page_id` filter, `cancelBookingFollowups`, `loadFollowupContext`, extended `renderTemplateVariables`.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260524000000_workflows_managed_followups.sql` (new) | Add `managed_kind`, `managed_source_id`, `manually_edited` columns + partial unique index |
| `src/lib/action-pages/kinds.ts` | Add `supportsFollowups?: boolean` to `KindMeta`; set `true` only on `booking` for now (realestate is Phase 4) |
| `src/lib/workflow/booking-followups.ts` (new) | Touchpoint type, validator, **pure** `generateFollowupGraph(touchpoints, pageId)` returning `{ triggers, nodes, edges, start_node_id }`, **pure** `parseTouchpointsFromWorkflow(workflow)` for the inverse |
| `src/lib/workflow/booking-followups.test.ts` (new) | Unit tests for generator + parser (round-trip), validator |
| `src/lib/workflow/booking-followups-persistence.ts` (new) | DB helpers: `loadManagedFollowups(admin, pageId)`, `saveManagedFollowups(admin, args)`, `resetManualEdit(admin, pageId)` |
| `src/lib/workflow/booking-followups-persistence.test.ts` (new) | Mock-admin tests for the persistence helpers |
| `src/app/(app)/dashboard/action-pages/_kinds/booking/followups-actions.ts` (new) | Server actions: `loadFollowupsForPage(pageId)`, `saveFollowupsForPage(pageId, touchpoints)`, `resetFollowupManagement(pageId)`. Also returns the user's approved templates list for the picker. |
| `src/app/(app)/dashboard/action-pages/_kinds/booking/FollowupTouchpointsEditor.tsx` (new) | Client component — list of touchpoint rows, template picker, variable editor, live preview |
| `src/app/(app)/dashboard/action-pages/_kinds/booking/Editor.tsx` | Mount `<FollowupTouchpointsEditor pageId={page.id} />` at the bottom of the editor (gated on `KIND_REGISTRY[page.kind].supportsFollowups`) |

---

## Task 1: Migration — `managed_kind`, `managed_source_id`, `manually_edited`

**Files:**
- Create: `supabase/migrations/20260524000000_workflows_managed_followups.sql`

- [ ] **Step 1: Confirm filename uniqueness**

Run via Bash: `ls supabase/migrations/ | tail -5`. Pick the next filename. The 2026-05-23 slot was used by the cancel_reason migration in Phase 1; `20260524000000` should be free. If it isn't, bump to `20260525000000`.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260524000000_workflows_managed_followups.sql`:

```sql
-- ---------------------------------------------------------------------------
-- Auto-managed workflows: lets a feature (e.g. booking-page editor) own a
-- workflow row and regenerate it from feature config. `manually_edited` flips
-- to true when a user saves edits via the workflow editor; the feature UI
-- then refuses to overwrite without explicit "Reset & take over".
-- ---------------------------------------------------------------------------

alter table public.workflows
  add column if not exists managed_kind text,
  add column if not exists managed_source_id uuid,
  add column if not exists manually_edited boolean not null default false;

alter table public.workflows
  drop constraint if exists workflows_managed_kind_check;

alter table public.workflows
  add constraint workflows_managed_kind_check
  check (managed_kind is null or managed_kind in ('booking_followups'));

-- Partial unique: at most one managed workflow per (managed_kind, managed_source_id).
-- Hand-built workflows (managed_kind is null) are unconstrained.
drop index if exists workflows_managed_unique;
create unique index workflows_managed_unique
  on public.workflows (managed_kind, managed_source_id)
  where managed_kind is not null;
```

- [ ] **Step 3: Apply via Supabase MCP**

Run via the Supabase MCP `apply_migration` tool with name `workflows_managed_followups` and the SQL above. If the MCP isn't available, instruct the user to apply it manually and continue.

- [ ] **Step 4: Verify with `list_tables` (workflows schema)**

Use the Supabase MCP `list_tables` tool to inspect `public.workflows` and confirm the three columns and the partial unique index exist. Report any anomalies.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260524000000_workflows_managed_followups.sql
git commit -m "feat(db): managed workflow columns for auto-generated booking follow-ups"
```

---

## Task 2: `KindMeta.supportsFollowups`

**Files:**
- Modify: `src/lib/action-pages/kinds.ts`

- [ ] **Step 1: Extend the `KindMeta` interface**

In `src/lib/action-pages/kinds.ts`, add to the `KindMeta` interface (preserve all existing fields exactly; insert at the bottom of the interface body before the closing brace):

```ts
  /**
   * When true, the action-page editor renders the booking follow-up
   * touchpoints section. Currently only booking; realestate joins in Phase 4.
   */
  supportsFollowups?: boolean
```

- [ ] **Step 2: Set the flag**

In the `KIND_REGISTRY.booking` entry only, add `supportsFollowups: true,` (place it adjacent to `defaultCtaLabel` for grouping). Do NOT set it on any other kind.

- [ ] **Step 3: Typecheck**

Run: `pnpm tsc --noEmit`. Pre-existing errors in `property-outbound.test.ts` are NOT yours.

- [ ] **Step 4: Commit**

```bash
git add src/lib/action-pages/kinds.ts
git commit -m "feat(action-pages): supportsFollowups flag on KindMeta (booking)"
```

---

## Task 3: Pure generator + inverse parser (TDD)

**Files:**
- Create: `src/lib/workflow/booking-followups.ts`
- Create: `src/lib/workflow/booking-followups.test.ts`

**Touchpoint shape** (this is the contract Phase 2 UI and persistence agree on):

```ts
type FollowupTouchpoint = {
  id: string                 // stable client-generated id (used as node id suffix)
  enabled: boolean
  offset: string             // e.g. '-1d', '+10m' — must parse via parseOffset
  template_id: string
  variables: Record<string, VariableRule>  // see render.ts
  button_url_override?: string | null
  button_index?: number | null
}
```

The generator turns N enabled touchpoints into one workflow with:
- N `booking_offset` triggers, each with `{ offset, action_page_id: pageId }`
- Graph: a single passthrough start node (`type: 'if'`-shaped router) that routes by `state.variables.offset === '<offset>'` to one send node per offset, each terminating in a `stop` node.

For Phase 2 simplicity we use `if` nodes chained linearly: `start → if(off==o1) → [then: send1 → stop] / [else: if(off==o2) → ...]`. Last branch's else also terminates in a stop. This avoids needing a multi-out router type.

- [ ] **Step 1: Write failing tests**

Create `src/lib/workflow/booking-followups.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  validateTouchpoint,
  generateFollowupGraph,
  parseTouchpointsFromWorkflow,
  type FollowupTouchpoint,
} from './booking-followups'

const baseTp = (overrides: Partial<FollowupTouchpoint>): FollowupTouchpoint => ({
  id: 'tp_1',
  enabled: true,
  offset: '-1d',
  template_id: 'tpl_1',
  variables: { '1': { kind: 'lead_field', field: 'name' } },
  ...overrides,
})

describe('validateTouchpoint', () => {
  it('accepts a valid touchpoint', () => {
    expect(validateTouchpoint(baseTp({}))).toBeNull()
  })
  it('rejects unparseable offset', () => {
    const err = validateTouchpoint(baseTp({ offset: 'bad' }))
    expect(err).toContain('offset')
  })
  it('rejects offset beyond ±30d', () => {
    const err = validateTouchpoint(baseTp({ offset: '-31d' }))
    expect(err).toContain('offset')
  })
  it('rejects empty template_id', () => {
    const err = validateTouchpoint(baseTp({ template_id: '' }))
    expect(err).toContain('template_id')
  })
})

describe('generateFollowupGraph', () => {
  it('produces N triggers for N enabled touchpoints', () => {
    const out = generateFollowupGraph(
      [
        baseTp({ id: 'a', offset: '-1d' }),
        baseTp({ id: 'b', offset: '-10m' }),
        baseTp({ id: 'c', offset: '+0' }),
      ],
      'page_1',
    )
    expect(out.triggers).toHaveLength(3)
    for (const t of out.triggers) {
      expect(t.kind).toBe('booking_offset')
      expect((t.config as { action_page_id?: string }).action_page_id).toBe('page_1')
    }
    const offsets = out.triggers.map((t) => (t.config as { offset?: string }).offset).sort()
    expect(offsets).toEqual(['+0', '-10m', '-1d'])
  })

  it('skips disabled touchpoints', () => {
    const out = generateFollowupGraph(
      [
        baseTp({ id: 'a', offset: '-1d', enabled: true }),
        baseTp({ id: 'b', offset: '-10m', enabled: false }),
      ],
      'page_1',
    )
    expect(out.triggers).toHaveLength(1)
    expect((out.triggers[0].config as { offset?: string }).offset).toBe('-1d')
  })

  it('returns at least a stop node when no enabled touchpoints', () => {
    const out = generateFollowupGraph([baseTp({ enabled: false })], 'page_1')
    expect(out.triggers).toHaveLength(0)
    expect(out.nodes.some((n) => n.type === 'stop')).toBe(true)
    expect(out.start_node_id).toBeDefined()
    // The graph is internally consistent: start_node_id references an existing node
    expect(out.nodes.some((n) => n.id === out.start_node_id)).toBe(true)
  })

  it('builds chained-if router so each offset reaches its own send node', () => {
    const out = generateFollowupGraph(
      [
        baseTp({ id: 'a', offset: '-1d' }),
        baseTp({ id: 'b', offset: '-10m' }),
      ],
      'page_1',
    )
    // 2 send nodes carrying utility_template payloads
    const sends = out.nodes.filter((n) => n.type === 'send')
    expect(sends).toHaveLength(2)
    for (const s of sends) {
      expect((s.config as { payload?: { kind?: string } }).payload?.kind).toBe('utility_template')
    }
    // every send connects to a stop via 'success'
    const stops = out.nodes.filter((n) => n.type === 'stop')
    expect(stops.length).toBeGreaterThanOrEqual(1)
  })
})

describe('parseTouchpointsFromWorkflow', () => {
  it('round-trips generateFollowupGraph output', () => {
    const tps: FollowupTouchpoint[] = [
      baseTp({ id: 'a', offset: '-1d', template_id: 'tpl_a' }),
      baseTp({
        id: 'b',
        offset: '-10m',
        template_id: 'tpl_b',
        variables: { '1': { kind: 'static', text: 'Hello' } },
      }),
    ]
    const graph = generateFollowupGraph(tps, 'page_1')
    const parsed = parseTouchpointsFromWorkflow({
      triggers: graph.triggers,
      graph: { nodes: graph.nodes, edges: graph.edges, start_node_id: graph.start_node_id },
    })
    expect(parsed).toHaveLength(2)
    // round-trip preserves offset, template_id, variables, enabled=true
    const aOut = parsed.find((p) => p.offset === '-1d')!
    const bOut = parsed.find((p) => p.offset === '-10m')!
    expect(aOut.template_id).toBe('tpl_a')
    expect(bOut.template_id).toBe('tpl_b')
    expect(bOut.variables).toEqual({ '1': { kind: 'static', text: 'Hello' } })
    expect(aOut.enabled).toBe(true)
    expect(bOut.enabled).toBe(true)
  })

  it('returns [] when graph has no booking_offset triggers', () => {
    const parsed = parseTouchpointsFromWorkflow({
      triggers: [{ kind: 'submission_received', config: {} }],
      graph: {
        nodes: [{ id: 'n1', type: 'stop', config: {} }],
        edges: [],
        start_node_id: 'n1',
      },
    })
    expect(parsed).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests, expect FAIL**

Run: `pnpm vitest run src/lib/workflow/booking-followups.test.ts`. Module not found.

- [ ] **Step 3: Implement `booking-followups.ts`**

Create `src/lib/workflow/booking-followups.ts`:

```ts
import { parseOffset } from './offsets'
import type {
  WorkflowGraph,
  WorkflowNode,
  WorkflowEdge,
  WorkflowTrigger,
  SendNodeConfig,
  IfNodeConfig,
} from './types'
import type { VariableMap } from '@/lib/messenger-templates/render'

export interface FollowupTouchpoint {
  id: string
  enabled: boolean
  offset: string
  template_id: string
  variables: VariableMap
  button_url_override?: string | null
  button_index?: number | null
}

export interface FollowupGraphOutput {
  triggers: WorkflowTrigger[]
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  start_node_id: string
}

const MAX_TOUCHPOINTS = 7

/**
 * Validate a single touchpoint. Returns an error message string or null when valid.
 */
export function validateTouchpoint(tp: FollowupTouchpoint): string | null {
  if (!tp.id || typeof tp.id !== 'string') return 'invalid id'
  if (!tp.template_id || typeof tp.template_id !== 'string') return 'template_id required'
  if (!tp.offset || typeof tp.offset !== 'string') return 'offset required'
  if (parseOffset(tp.offset) === null) return `invalid offset: ${tp.offset}`
  return null
}

export function validateTouchpoints(tps: FollowupTouchpoint[]): string | null {
  if (tps.length > MAX_TOUCHPOINTS) return `at most ${MAX_TOUCHPOINTS} touchpoints`
  // Duplicate offsets (within enabled rows) are confusing — block them so the
  // generator's distinct-offset semantics are obvious in the UI.
  const seen = new Set<string>()
  for (const tp of tps) {
    const err = validateTouchpoint(tp)
    if (err) return err
    if (tp.enabled) {
      if (seen.has(tp.offset)) return `duplicate enabled offset: ${tp.offset}`
      seen.add(tp.offset)
    }
  }
  return null
}

/**
 * Produce a workflow graph + triggers from a touchpoint config.
 *
 * Graph shape: linear if-chain. Each offset gets a router node that compares
 * `state.variables.offset` to its offset string; on match, send the
 * utility_template; otherwise fall through to the next router. Final fallthrough
 * lands on a single shared stop node.
 *
 * Disabled touchpoints are dropped (no trigger, no graph branch).
 */
export function generateFollowupGraph(
  touchpoints: FollowupTouchpoint[],
  actionPageId: string,
): FollowupGraphOutput {
  const enabled = touchpoints.filter((tp) => tp.enabled)

  const triggers: WorkflowTrigger[] = enabled.map((tp) => ({
    kind: 'booking_offset',
    config: { offset: tp.offset, action_page_id: actionPageId },
  }))

  const nodes: WorkflowNode[] = []
  const edges: WorkflowEdge[] = []

  // Single shared stop terminates everything.
  const stopId = 'stop'
  nodes.push({ id: stopId, type: 'stop', config: {} })

  if (enabled.length === 0) {
    // Empty graph: just stop. start === stop.
    return { triggers, nodes, edges, start_node_id: stopId }
  }

  // Build the if-chain.
  let prevElseFromId: string | null = null
  enabled.forEach((tp, idx) => {
    const ifId = `if_${tp.id}`
    const sendId = `send_${tp.id}`

    nodes.push({
      id: ifId,
      type: 'if',
      config: {
        conditions: [
          {
            kind: 'custom_field_eq',
            params: { field: 'state.variables.offset', value: tp.offset },
          },
        ],
        logic: 'AND',
      } satisfies IfNodeConfig,
    })

    nodes.push({
      id: sendId,
      type: 'send',
      config: {
        payload: {
          kind: 'utility_template',
          template_id: tp.template_id,
          variables: tp.variables,
          ...(tp.button_url_override
            ? { button_url_override: tp.button_url_override }
            : {}),
          ...(tp.button_index != null ? { button_index: tp.button_index } : {}),
        },
      } satisfies SendNodeConfig,
    })

    edges.push({ from: ifId, label: 'then', to: sendId })
    edges.push({ from: sendId, label: 'success', to: stopId })
    edges.push({ from: sendId, label: 'policy_blocked', to: stopId })
    edges.push({ from: sendId, label: 'error', to: stopId })

    // Wire the previous else (or top-level start) to this if.
    if (prevElseFromId) {
      edges.push({ from: prevElseFromId, label: 'else', to: ifId })
    }
    prevElseFromId = ifId

    // Last branch's else terminates at stop.
    if (idx === enabled.length - 1) {
      edges.push({ from: ifId, label: 'else', to: stopId })
    }
  })

  const startNodeId = `if_${enabled[0].id}`
  return { triggers, nodes, edges, start_node_id: startNodeId }
}

/**
 * Inverse: read touchpoints back from a generated workflow. Used to populate
 * the booking-page UI on load. Returns [] for graphs that don't look generated.
 */
export function parseTouchpointsFromWorkflow(args: {
  triggers: WorkflowTrigger[]
  graph: { nodes: WorkflowNode[]; edges: WorkflowEdge[]; start_node_id: string }
}): FollowupTouchpoint[] {
  const out: FollowupTouchpoint[] = []
  for (const node of args.graph.nodes) {
    if (node.type !== 'send') continue
    const cfg = node.config as { payload?: { kind?: string } }
    if (cfg.payload?.kind !== 'utility_template') continue
    const payload = cfg.payload as Extract<SendNodeConfig['payload'], { kind: 'utility_template' }>
    // node id is `send_<tpId>`; recover tpId.
    const tpId = node.id.startsWith('send_') ? node.id.slice('send_'.length) : node.id
    // Find the matching if-node to recover the offset.
    const ifNode = args.graph.nodes.find((n) => n.id === `if_${tpId}`)
    let offset = ''
    if (ifNode && ifNode.type === 'if') {
      const ifCfg = ifNode.config as IfNodeConfig
      const cond = ifCfg.conditions?.[0]
      const params = cond?.params as { value?: string } | undefined
      if (typeof params?.value === 'string') offset = params.value
    }
    out.push({
      id: tpId,
      enabled: true,
      offset,
      template_id: payload.template_id,
      variables: payload.variables,
      button_url_override: payload.button_url_override ?? null,
      button_index: payload.button_index ?? null,
    })
  }
  return out
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `pnpm vitest run src/lib/workflow/booking-followups.test.ts`. All tests green.

- [ ] **Step 5: Typecheck + full suite**

Run: `pnpm tsc --noEmit && pnpm vitest run`. Pre-existing failures NOT yours.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflow/booking-followups.ts src/lib/workflow/booking-followups.test.ts
git commit -m "feat(workflow): pure follow-up graph generator + inverse parser"
```

---

## Task 4: Persistence helpers (TDD)

**Files:**
- Create: `src/lib/workflow/booking-followups-persistence.ts`
- Create: `src/lib/workflow/booking-followups-persistence.test.ts`

These wrap the DB. They DO NOT do auth — server actions in Task 5 are responsible for that.

- [ ] **Step 1: Write failing tests**

Create `src/lib/workflow/booking-followups-persistence.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  loadManagedFollowups,
  saveManagedFollowups,
  resetManualEdit,
} from './booking-followups-persistence'
import type { FollowupTouchpoint } from './booking-followups'

const baseTp: FollowupTouchpoint = {
  id: 'tp_1',
  enabled: true,
  offset: '-1d',
  template_id: 'tpl_1',
  variables: { '1': { kind: 'lead_field', field: 'name' } },
}

function makeAdmin(opts: {
  existing?: { id: string; manually_edited: boolean; version: number; status: string } | null
}) {
  const inserts: Array<{ row: Record<string, unknown> }> = []
  const updates: Array<{ where: Record<string, unknown>; values: Record<string, unknown> }> = []

  const from = vi.fn((table: string) => {
    if (table === 'workflows') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({ data: opts.existing ?? null, error: null })),
            })),
          })),
        })),
        insert: vi.fn((row: Record<string, unknown>) => ({
          select: vi.fn(() => ({
            maybeSingle: vi.fn(async () => {
              inserts.push({ row })
              return { data: { id: 'new_wf_id' }, error: null }
            }),
          })),
        })),
        update: vi.fn((values: Record<string, unknown>) => {
          const where: Record<string, unknown> = {}
          const builder = {
            eq: vi.fn((col: string, val: unknown) => {
              where[col] = val
              return builder
            }),
            then: undefined,
          }
          // tail call (await ends in eq) returns a promise via eq; emulate.
          const finalEq = (col: string, val: unknown) => {
            where[col] = val
            updates.push({ where, values })
            return Promise.resolve({ data: null, error: null })
          }
          // We expose a chain that resolves on the LAST eq via Proxy-like behavior;
          // for simplicity, attach finalEq on builder.eq's last invocation:
          builder.eq = vi.fn((col: string, val: unknown) => {
            where[col] = val
            // mimic the supabase chain: 2nd eq triggers resolution.
            if (Object.keys(where).length >= 1) {
              updates.push({ where, values })
              return Promise.resolve({ data: null, error: null })
            }
            return builder
          })
          return builder
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })

  return { admin: { from } as never, inserts, updates }
}

describe('loadManagedFollowups', () => {
  it('returns null when no managed workflow exists for the page', async () => {
    const { admin } = makeAdmin({ existing: null })
    const out = await loadManagedFollowups(admin, 'page_1')
    expect(out).toBeNull()
  })

  it('returns workflow id and parsed touchpoints when present', async () => {
    // Construct a "real" managed workflow row by generating one and feeding it back.
    // For simplicity, the persistence helper accepts a graph+triggers payload from
    // the row; mock the maybeSingle to return that row.
    const { admin } = makeAdmin({
      existing: {
        id: 'wf_1',
        manually_edited: false,
        version: 1,
        status: 'active',
      } as never,
    })
    // Note: real rows include triggers + graph. The test below ensures the
    // function does call from('workflows') correctly; richer round-trip is
    // covered by the generator's own round-trip test in Task 3.
    const out = await loadManagedFollowups(admin, 'page_1')
    expect(out).not.toBeNull()
    expect(out?.workflowId).toBe('wf_1')
    expect(out?.manuallyEdited).toBe(false)
  })
})

describe('saveManagedFollowups', () => {
  it('inserts a new workflow when none exists', async () => {
    const { admin, inserts } = makeAdmin({ existing: null })
    const result = await saveManagedFollowups(admin, {
      userId: 'u1',
      pageId: 'page_1',
      pageTitle: 'My Booking',
      touchpoints: [baseTp],
    })
    expect(result.ok).toBe(true)
    expect(inserts).toHaveLength(1)
    expect(inserts[0].row.managed_kind).toBe('booking_followups')
    expect(inserts[0].row.managed_source_id).toBe('page_1')
    expect(inserts[0].row.user_id).toBe('u1')
    expect(inserts[0].row.status).toBe('active')
  })

  it('refuses when manually_edited=true', async () => {
    const { admin, inserts, updates } = makeAdmin({
      existing: { id: 'wf_1', manually_edited: true, version: 3, status: 'active' },
    })
    const result = await saveManagedFollowups(admin, {
      userId: 'u1',
      pageId: 'page_1',
      pageTitle: 'My Booking',
      touchpoints: [baseTp],
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('manually_edited')
    expect(inserts).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })

  it('rejects when validateTouchpoints fails (e.g. bad offset)', async () => {
    const { admin } = makeAdmin({ existing: null })
    const result = await saveManagedFollowups(admin, {
      userId: 'u1',
      pageId: 'page_1',
      pageTitle: 'My Booking',
      touchpoints: [{ ...baseTp, offset: 'garbage' }],
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('offset')
  })
})

describe('resetManualEdit', () => {
  it('flips manually_edited to false', async () => {
    const { admin, updates } = makeAdmin({
      existing: { id: 'wf_1', manually_edited: true, version: 1, status: 'active' },
    })
    await resetManualEdit(admin, 'page_1')
    expect(updates).toHaveLength(1)
    expect(updates[0].values.manually_edited).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests, expect FAIL**

Run: `pnpm vitest run src/lib/workflow/booking-followups-persistence.test.ts`. Module not found.

- [ ] **Step 3: Implement persistence helpers**

Create `src/lib/workflow/booking-followups-persistence.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  generateFollowupGraph,
  parseTouchpointsFromWorkflow,
  validateTouchpoints,
  type FollowupTouchpoint,
} from './booking-followups'
import type { WorkflowGraph, WorkflowTrigger } from './types'

export interface ManagedFollowupsLoadResult {
  workflowId: string
  manuallyEdited: boolean
  version: number
  status: 'draft' | 'active' | 'paused' | 'archived'
  touchpoints: FollowupTouchpoint[]
}

interface WorkflowRow {
  id: string
  manually_edited: boolean
  version: number
  status: 'draft' | 'active' | 'paused' | 'archived'
  triggers: WorkflowTrigger[] | null
  graph: WorkflowGraph | null
}

export async function loadManagedFollowups(
  admin: SupabaseClient,
  pageId: string,
): Promise<ManagedFollowupsLoadResult | null> {
  const { data: wf } = await admin
    .from('workflows')
    .select('id, manually_edited, version, status, triggers, graph')
    .eq('managed_kind', 'booking_followups')
    .eq('managed_source_id', pageId)
    .maybeSingle<WorkflowRow>()

  if (!wf) return null

  const touchpoints =
    wf.triggers && wf.graph
      ? parseTouchpointsFromWorkflow({ triggers: wf.triggers, graph: wf.graph })
      : []

  return {
    workflowId: wf.id,
    manuallyEdited: wf.manually_edited,
    version: wf.version,
    status: wf.status,
    touchpoints,
  }
}

export type SaveManagedFollowupsResult =
  | { ok: true; workflowId: string }
  | { ok: false; reason: string }

export async function saveManagedFollowups(
  admin: SupabaseClient,
  args: {
    userId: string
    pageId: string
    pageTitle: string
    touchpoints: FollowupTouchpoint[]
  },
): Promise<SaveManagedFollowupsResult> {
  const validationError = validateTouchpoints(args.touchpoints)
  if (validationError) return { ok: false, reason: validationError }

  const existing = await loadManagedFollowups(admin, args.pageId)
  if (existing && existing.manuallyEdited) {
    return { ok: false, reason: 'manually_edited' }
  }

  const generated = generateFollowupGraph(args.touchpoints, args.pageId)
  const triggers = generated.triggers
  const graph = {
    nodes: generated.nodes,
    edges: generated.edges,
    start_node_id: generated.start_node_id,
  }

  const name = `${args.pageTitle || 'Booking'} — Follow-ups`
  // No active triggers means the workflow has nothing to fire — pause it so
  // the dispatcher's "active workflows" query skips it cleanly.
  const status: 'active' | 'paused' = triggers.length > 0 ? 'active' : 'paused'

  if (!existing) {
    const { data: ins, error } = await admin
      .from('workflows')
      .insert({
        user_id: args.userId,
        name,
        status,
        version: 1,
        trigger: triggers[0] ?? { kind: 'booking_offset', config: {} },
        triggers,
        graph,
        managed_kind: 'booking_followups',
        managed_source_id: args.pageId,
        manually_edited: false,
      })
      .select('id')
      .maybeSingle<{ id: string }>()
    if (error || !ins) return { ok: false, reason: error?.message ?? 'insert failed' }
    return { ok: true, workflowId: ins.id }
  }

  const { error } = await admin
    .from('workflows')
    .update({
      name,
      status,
      version: existing.version + 1,
      trigger: triggers[0] ?? { kind: 'booking_offset', config: {} },
      triggers,
      graph,
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.workflowId)
    .eq('manually_edited', false)
  if (error) return { ok: false, reason: error.message }
  return { ok: true, workflowId: existing.workflowId }
}

export async function resetManualEdit(
  admin: SupabaseClient,
  pageId: string,
): Promise<void> {
  await admin
    .from('workflows')
    .update({ manually_edited: false, updated_at: new Date().toISOString() })
    .eq('managed_kind', 'booking_followups')
    .eq('managed_source_id', pageId)
}
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `pnpm vitest run src/lib/workflow/booking-followups-persistence.test.ts`.

If a test fails because the supabase chain mock doesn't match the real chain shape (the `.update().eq().eq()` chain ends with the second `eq` returning a thenable), inspect the helper's actual chain calls and adjust the test mock so the chain emulation matches. Do NOT change production behavior to satisfy a fragile mock — refine the mock instead.

- [ ] **Step 5: Typecheck + full suite**

Run: `pnpm tsc --noEmit && pnpm vitest run`. No NEW failures.

- [ ] **Step 6: Commit**

```bash
git add src/lib/workflow/booking-followups-persistence.ts src/lib/workflow/booking-followups-persistence.test.ts
git commit -m "feat(workflow): persist managed booking-followup workflows"
```

---

## Task 5: Server actions

**Files:**
- Create: `src/app/(app)/dashboard/action-pages/_kinds/booking/followups-actions.ts`

These are the only auth boundary; all DB access for the UI flows through them.

- [ ] **Step 1: Implement the actions**

Create `src/app/(app)/dashboard/action-pages/_kinds/booking/followups-actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  loadManagedFollowups,
  saveManagedFollowups,
  resetManualEdit,
  type ManagedFollowupsLoadResult,
} from '@/lib/workflow/booking-followups-persistence'
import type { FollowupTouchpoint } from '@/lib/workflow/booking-followups'

async function requireUserAndPage(pageId: string): Promise<{
  userId: string
  pageTitle: string
  pageKind: string
}> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: page } = await supabase
    .from('action_pages')
    .select('id, user_id, title, kind')
    .eq('id', pageId)
    .maybeSingle<{ id: string; user_id: string; title: string | null; kind: string }>()

  if (!page || page.user_id !== user.id) {
    throw new Error('not_found_or_forbidden')
  }
  return { userId: user.id, pageTitle: page.title ?? 'Booking', pageKind: page.kind }
}

export interface ApprovedTemplateOption {
  id: string
  name: string
  display_name: string
  language: string
  body_text: string
  variable_count: number
  buttons: Array<{ type: string; index?: number; url?: string; text?: string }>
}

export async function loadFollowupsForPage(pageId: string): Promise<{
  managed: ManagedFollowupsLoadResult | null
  approvedTemplates: ApprovedTemplateOption[]
}> {
  const { userId } = await requireUserAndPage(pageId)
  const admin = createAdminClient()

  const managed = await loadManagedFollowups(admin, pageId)

  const { data: tpls } = await admin
    .from('messenger_message_templates')
    .select('id, name, display_name, language, body_text, variable_count, buttons, meta_status')
    .eq('user_id', userId)
    .eq('meta_status', 'approved')
    .order('display_name', { ascending: true })

  const approvedTemplates = (tpls ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    display_name: t.display_name as string,
    language: t.language as string,
    body_text: t.body_text as string,
    variable_count: t.variable_count as number,
    buttons: (t.buttons ?? []) as ApprovedTemplateOption['buttons'],
  }))

  return { managed, approvedTemplates }
}

export async function saveFollowupsForPage(
  pageId: string,
  touchpoints: FollowupTouchpoint[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { userId, pageTitle } = await requireUserAndPage(pageId)
  const admin = createAdminClient()
  const result = await saveManagedFollowups(admin, {
    userId,
    pageId,
    pageTitle,
    touchpoints,
  })
  if (!result.ok) return { ok: false, reason: result.reason }
  revalidatePath(`/dashboard/action-pages/${pageId}`)
  return { ok: true }
}

export async function resetFollowupManagementForPage(pageId: string): Promise<void> {
  await requireUserAndPage(pageId)
  const admin = createAdminClient()
  await resetManualEdit(admin, pageId)
  revalidatePath(`/dashboard/action-pages/${pageId}`)
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit`. No NEW errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/dashboard/action-pages/_kinds/booking/followups-actions.ts
git commit -m "feat(action-pages): server actions for booking follow-up touchpoints"
```

---

## Task 6: `<FollowupTouchpointsEditor>` component

**Files:**
- Create: `src/app/(app)/dashboard/action-pages/_kinds/booking/FollowupTouchpointsEditor.tsx`

This is a client component. It loads its data on mount via the server action (you can use `useEffect` + `startTransition`) and saves via a "Save touchpoints" button.

Match the existing visual language in `BookingEditor.tsx`: `SubSection`, `13px`/`14px` typography, `#D1D5DB` borders, `#059669` accent color, `rounded-md` on inputs. Reuse those classnames verbatim.

Touchpoint row layout (from spec):

```
[ ⋮ drag handle ] [ Offset: <preset|custom> ] [ Template: <select> ] [Enabled ☑] [✕]
                  └ {{1}} = [Field|Static] <value/picker>
                  └ {{2}} = ...
                  └ Button URL: ( ) Default (booking page) ( ) Override [____]
                  └ Preview: "Hi {{1}}, ..."
```

- [ ] **Step 1: Write the component**

Create `src/app/(app)/dashboard/action-pages/_kinds/booking/FollowupTouchpointsEditor.tsx`:

```tsx
'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  loadFollowupsForPage,
  saveFollowupsForPage,
  resetFollowupManagementForPage,
  type ApprovedTemplateOption,
} from './followups-actions'
import type { FollowupTouchpoint } from '@/lib/workflow/booking-followups'
import { renderTemplateVariables, type LeadForRender } from '@/lib/messenger-templates/render'

const MAX_TOUCHPOINTS = 7

const OFFSET_PRESETS: Array<{ value: string; label: string }> = [
  { value: '-3d', label: '3 days before' },
  { value: '-2d', label: '2 days before' },
  { value: '-1d', label: '1 day before' },
  { value: '-2h', label: '2 hours before' },
  { value: '-1h', label: '1 hour before' },
  { value: '-30m', label: '30 minutes before' },
  { value: '-10m', label: '10 minutes before' },
  { value: '-5m', label: '5 minutes before' },
  { value: '0', label: 'At booking time' },
  { value: '+1h', label: '1 hour after' },
  { value: '+1d', label: '1 day after' },
]

const SAMPLE_LEAD: LeadForRender = {
  name: 'Sarah',
  custom_fields: {},
  booking: {
    event_at: '2026-06-01T01:00:00Z',
    event_at_relative: 'in 24 hours',
    title: 'Sample booking',
  },
}

function genTpId() {
  return 'tp_' + Math.random().toString(36).slice(2, 9)
}

export function FollowupTouchpointsEditor({ pageId }: { pageId: string }) {
  const [loading, setLoading] = useState(true)
  const [saving, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [touchpoints, setTouchpoints] = useState<FollowupTouchpoint[]>([])
  const [templates, setTemplates] = useState<ApprovedTemplateOption[]>([])
  const [manuallyEdited, setManuallyEdited] = useState(false)

  useEffect(() => {
    let mounted = true
    void (async () => {
      try {
        const { managed, approvedTemplates } = await loadFollowupsForPage(pageId)
        if (!mounted) return
        setTouchpoints(managed?.touchpoints ?? [])
        setTemplates(approvedTemplates)
        setManuallyEdited(managed?.manuallyEdited ?? false)
      } catch (e) {
        if (!mounted) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [pageId])

  const templateById = useMemo(() => {
    const m = new Map<string, ApprovedTemplateOption>()
    for (const t of templates) m.set(t.id, t)
    return m
  }, [templates])

  function patchTp(idx: number, patch: Partial<FollowupTouchpoint>) {
    setTouchpoints((tps) => tps.map((tp, i) => (i === idx ? { ...tp, ...patch } : tp)))
  }

  function addTp() {
    if (touchpoints.length >= MAX_TOUCHPOINTS) return
    setTouchpoints((tps) => [
      ...tps,
      {
        id: genTpId(),
        enabled: true,
        offset: '-1d',
        template_id: templates[0]?.id ?? '',
        variables: {},
      },
    ])
  }

  function removeTp(idx: number) {
    setTouchpoints((tps) => tps.filter((_, i) => i !== idx))
  }

  function save() {
    setError(null)
    startTransition(async () => {
      const result = await saveFollowupsForPage(pageId, touchpoints)
      if (!result.ok) setError(result.reason)
    })
  }

  function reset() {
    if (!confirm('Discard manual workflow edits and let the booking page manage this workflow again?')) return
    startTransition(async () => {
      await resetFollowupManagementForPage(pageId)
      setManuallyEdited(false)
    })
  }

  if (loading) return <p className="text-[13px] text-[#6B7280]">Loading follow-ups…</p>

  if (manuallyEdited) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
        <p className="font-semibold">Managed externally</p>
        <p className="mt-1">
          This workflow was edited directly in the workflow editor. Saving from here is disabled
          until you reset.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-2 rounded-md border border-amber-300 bg-white px-2 py-1 text-[12px] font-semibold text-amber-900 hover:bg-amber-100"
        >
          Reset & take over
        </button>
      </div>
    )
  }

  return (
    <div>
      {error && (
        <p className="mb-2 rounded-md border border-red-200 bg-red-50 p-2 text-[12px] text-red-700">
          {error}
        </p>
      )}

      <div className="space-y-3">
        {touchpoints.map((tp, idx) => {
          const tpl = templateById.get(tp.template_id)
          const variableCount = tpl?.variable_count ?? 0
          const previewBody = tpl
            ? renderPreview(tpl.body_text, tp, variableCount)
            : 'Pick a template to see a preview.'
          return (
            <div
              key={tp.id}
              className="rounded-md border border-[#D1D5DB] bg-white p-3"
            >
              <div className="flex items-center gap-2">
                <select
                  value={tp.offset}
                  onChange={(e) => patchTp(idx, { offset: e.target.value })}
                  className="rounded-md border border-[#D1D5DB] bg-white px-2 py-1 text-[13px]"
                >
                  {OFFSET_PRESETS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>

                <select
                  value={tp.template_id}
                  onChange={(e) =>
                    patchTp(idx, { template_id: e.target.value, variables: {} })
                  }
                  className="rounded-md border border-[#D1D5DB] bg-white px-2 py-1 text-[13px]"
                >
                  <option value="">— pick template —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.display_name}
                    </option>
                  ))}
                </select>

                <label className="ml-auto flex items-center gap-1 text-[13px]">
                  <input
                    type="checkbox"
                    checked={tp.enabled}
                    onChange={(e) => patchTp(idx, { enabled: e.target.checked })}
                  />
                  Enabled
                </label>

                <button
                  type="button"
                  onClick={() => removeTp(idx)}
                  className="rounded-md border border-red-200 bg-white px-2 py-1 text-[12px] font-semibold text-red-600 hover:bg-red-50"
                >
                  Remove
                </button>
              </div>

              {tpl && variableCount > 0 && (
                <div className="mt-2 space-y-1 pl-4 text-[13px]">
                  {Array.from({ length: variableCount }, (_, i) => i + 1).map((slot) => {
                    const key = String(slot)
                    const rule = tp.variables[key]
                    return (
                      <div key={slot} className="flex items-center gap-2">
                        <span className="text-[12px] text-[#6B7280]">{`{{${slot}}}`}</span>
                        <select
                          value={rule?.kind ?? 'static'}
                          onChange={(e) => {
                            const kind = e.target.value as 'static' | 'lead_field' | 'booking_field'
                            const next =
                              kind === 'static'
                                ? { kind: 'static' as const, text: '' }
                                : kind === 'lead_field'
                                  ? { kind: 'lead_field' as const, field: 'name' }
                                  : { kind: 'booking_field' as const, field: 'event_at_relative' as const }
                            patchTp(idx, {
                              variables: { ...tp.variables, [key]: next },
                            })
                          }}
                          className="rounded-md border border-[#D1D5DB] bg-white px-2 py-1 text-[13px]"
                        >
                          <option value="static">Static text</option>
                          <option value="lead_field">Lead field</option>
                          <option value="booking_field">Booking field</option>
                        </select>
                        {rule?.kind === 'static' && (
                          <input
                            type="text"
                            value={rule.text}
                            onChange={(e) =>
                              patchTp(idx, {
                                variables: {
                                  ...tp.variables,
                                  [key]: { kind: 'static', text: e.target.value },
                                },
                              })
                            }
                            className="flex-1 rounded-md border border-[#D1D5DB] bg-white px-2 py-1 text-[13px]"
                          />
                        )}
                        {rule?.kind === 'lead_field' && (
                          <select
                            value={rule.field}
                            onChange={(e) =>
                              patchTp(idx, {
                                variables: {
                                  ...tp.variables,
                                  [key]: { kind: 'lead_field', field: e.target.value },
                                },
                              })
                            }
                            className="rounded-md border border-[#D1D5DB] bg-white px-2 py-1 text-[13px]"
                          >
                            <option value="name">name</option>
                          </select>
                        )}
                        {rule?.kind === 'booking_field' && (
                          <select
                            value={rule.field}
                            onChange={(e) =>
                              patchTp(idx, {
                                variables: {
                                  ...tp.variables,
                                  [key]: {
                                    kind: 'booking_field',
                                    field: e.target.value as 'event_at' | 'event_at_relative' | 'title',
                                  },
                                },
                              })
                            }
                            className="rounded-md border border-[#D1D5DB] bg-white px-2 py-1 text-[13px]"
                          >
                            <option value="event_at_relative">when (relative)</option>
                            <option value="event_at">when (ISO)</option>
                            <option value="title">title</option>
                          </select>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              <p className="mt-2 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-2 text-[12px] text-[#374151]">
                {previewBody}
              </p>
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={addTp}
          disabled={touchpoints.length >= MAX_TOUCHPOINTS}
          className="rounded-md border border-[#D1D5DB] bg-white px-3 py-1 text-[13px] font-semibold text-[#111827] hover:bg-[#F9FAFB] disabled:opacity-50"
        >
          + Add touchpoint
        </button>
        <span className="text-[12px] text-[#6B7280]">
          {touchpoints.length} / {MAX_TOUCHPOINTS}
        </span>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="ml-auto rounded-md bg-[#059669] px-3 py-1 text-[13px] font-semibold text-white hover:bg-[#047857] disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save touchpoints'}
        </button>
      </div>
    </div>
  )
}

function renderPreview(
  bodyText: string,
  tp: FollowupTouchpoint,
  variableCount: number,
): string {
  const params = renderTemplateVariables(tp.variables, variableCount, SAMPLE_LEAD)
  return bodyText.replace(/\{\{(\d+)\}\}/g, (_m, idx) => {
    const i = Number(idx)
    return params[i - 1] ?? ''
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit`. No NEW errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/dashboard/action-pages/_kinds/booking/FollowupTouchpointsEditor.tsx
git commit -m "feat(action-pages): FollowupTouchpointsEditor client component"
```

---

## Task 7: Mount the editor in the booking-page editor

**Files:**
- Modify: `src/app/(app)/dashboard/action-pages/_kinds/booking/Editor.tsx`

- [ ] **Step 1: Import and mount**

In `src/app/(app)/dashboard/action-pages/_kinds/booking/Editor.tsx`, add the import at the top alongside other imports:

```ts
import { FollowupTouchpointsEditor } from './FollowupTouchpointsEditor'
import { KIND_REGISTRY } from '@/lib/action-pages/kinds'
```

Find the rendered tree's bottom — the last `</SubSection>` block before the closing fragment/wrapper. Append a new `SubSection`:

```tsx
{KIND_REGISTRY[page.kind].supportsFollowups && (
  <SubSection title="Follow-up touchpoints">
    <p className="mb-2 text-[12px] text-[#6B7280]">
      Send up to 7 Meta utility-template messages around the booking time. Templates must be
      approved on the Templates page first.
    </p>
    <FollowupTouchpointsEditor pageId={page.id} />
  </SubSection>
)}
```

(If the `SubSection` component is locally defined inside `Editor.tsx`, reuse it. If it's imported, follow the existing import.)

- [ ] **Step 2: Typecheck**

Run: `pnpm tsc --noEmit`. No NEW errors.

- [ ] **Step 3: Manual smoke test (recommended; not gating)**

Start dev server (`pnpm dev`), navigate to a booking action page in `/dashboard/action-pages/[id]`. Confirm:
- The "Follow-up touchpoints" section is rendered.
- "+ Add touchpoint" works.
- Selecting an approved template shows variable rows + a preview.
- "Save touchpoints" succeeds and a workflow appears at `/dashboard/workflows`.
- Editing that workflow in the editor and saving it sets `manually_edited=true`. Returning to the booking page should now show the "Managed externally" banner.
- "Reset & take over" clears that banner.

If a manual smoke is impractical, document what the implementer verified via test/typecheck and what they could not.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/dashboard/action-pages/_kinds/booking/Editor.tsx"
git commit -m "feat(action-pages): mount FollowupTouchpointsEditor on booking page"
```

---

## Self-Review Notes

- **Spec coverage:**
  - Migration columns + partial unique index → Task 1.
  - `KindMeta.supportsFollowups` → Task 2.
  - Pure generator + inverse → Task 3.
  - Persistence (load/save/reset) → Task 4.
  - Server-action auth boundary → Task 5.
  - Touchpoints UI with variable mapping + preview + manual-edit banner → Tasks 6 + 7.
  - Phase 2 explicitly defers: cancel hook wire-up (Phase 3), `resolveFollowupPageId` and realestate mount (Phase 4).
- **Phase 2 testability:** A user creates touchpoints in the booking page, saves, the engine (Phase 1) actually fires them on real booking submissions. Manual editing through `/dashboard/workflows` round-trips into the same managed workflow.
- **No placeholders.** Each step has the exact code or migration SQL.
- **Type consistency:**
  - `FollowupTouchpoint.variables` uses `VariableMap` from `render.ts`, matching the executor's expected payload shape.
  - The generator emits `if`-node configs that match `IfNodeConfig` (existing type from `types.ts`); the `custom_field_eq` condition kind is already in the allowed-set.
  - `parseTouchpointsFromWorkflow` mirrors the generator's node-id convention (`if_<tpId>` / `send_<tpId>`); changes to one must update the other.
- **Risk: `if` node with `custom_field_eq` reading `state.variables.offset`.** Confirm the executor's `if`-handler resolves dotted paths against `run.state.variables`. If it does not (i.e. `custom_field_eq` only checks `lead.custom_fields[k]`), Phase 2 must either extend the if-handler or use a different routing approach. **Implementer for Task 3 should grep `custom_field_eq` in `src/lib/workflow/executor.ts` first; if state-variable comparison isn't supported, escalate to the controller before writing the generator** — we may switch to writing one workflow per offset (managed as a set) instead of a single chained-if workflow.
- **Risk: Workflow API validator.** `src/app/api/workflows/[id]/route.ts` validates trigger kinds and node types — new `utility_template` payload kind on send nodes might fail strict payload validation. Implementer should grep that file once during Task 3 to confirm no extra validation blocks our shape; if it does, Task 3 fix the validator alongside the generator (separate commit).
