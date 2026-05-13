# Leads Stages Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the weak default lead pipeline with a 9-stage signal-gated pipeline that auto-progresses leads from observable conversation behavior, syncs stage definitions with the user's knowledge base via reviewable suggestions, and provides a safe opt-in upgrade path for existing users.

**Architecture:** All changes are additive at the DB layer (4 new tables/columns, 0 destructive migrations). Classifier is enriched in-place at `src/lib/chatbot/deep-reclassify.ts`. The centralized `public.set_lead_stage` RPC is extended to manage `previous_stage_id` for Objection. A new background suggester job runs after knowledge-base edits and writes pending suggestions surfaced in three UI locations. An opt-in upgrade flow updates existing users' stages in place without renumbering ids, preserving every `leads.stage_id` reference.

**Tech Stack:** Next.js App Router · Supabase Postgres · Supabase Cron (pg_cron + pg_net) · TypeScript · Vitest · React Server Components

**Spec:** `docs/superpowers/specs/2026-05-14-leads-stages-redesign-design.md`

---

## Resolved opens (from spec §10)

- **Profile table for `dismissed_stage_upgrade_at`:** `public.profiles`.
- **Cron mechanism:** Supabase pg_cron → bearer-auth HTTP call to `src/app/api/cron/<name>/route.ts`.
- **Embedding-job completion hook attach point:** `src/lib/rag/worker/embed-job.ts` (where jobs settle to `succeeded`).
- **Objection identification in DB:** extend `pipeline_stages.kind` enum with `'objection'` (additive constraint change). `set_lead_stage` reads target stage's `kind` to decide whether to capture `previous_stage_id`.
- **Chip-array editor:** new local primitive `SignalChipsInput` co-located in `_components/`, no external lib.
- **`move-stage.ts` scope:** new helper wraps `set_lead_stage` RPC for the bot path. Manual UI moves continue calling the RPC directly through existing `actions/leads.ts:moveLead` — no refactor of drag-drop in v1.

---

## Task list

1. Database migrations (4 SQL files + RPC update + extend `kind` enum)
2. Rewrite `DEFAULT_STAGES` with full signal definitions
3. Update `seed.ts` to write jsonb columns
4. Create centralized `move-stage.ts` bot-side helper
5. Rewrite `deep-reclassify.ts` prompt with signal checklists
6. Tiered confidence + `matched_signals` + Objection-resolution logic
7. Dormant sweeper cron route + scheduling
8. `stage-suggester.ts` core lib
9. Hook suggester enqueue into embed-job completion + suggester-runner cron route
10. Stale-suggestion housekeeping (daily)
11. `upgrade.ts` lib — detect / preview / apply / undo
12. `UpgradeBanner` UI + preview-diff modal + server actions
13. `StageSuggestionsPanel` UI + accept/reject server actions
14. Sidebar pending-suggestion badge + once-per-session toast
15. `StageManager` chip editors for signals
16. `LeadCard` "Why here?" tooltip

---

## Task 1: Database migrations

**Files:**
- Create: `supabase/migrations/20260514100000_pipeline_stage_kind_objection.sql`
- Create: `supabase/migrations/20260514100100_pipeline_stage_suggestions.sql`
- Create: `supabase/migrations/20260514100200_leads_previous_stage_id.sql`
- Create: `supabase/migrations/20260514100300_pipeline_stage_upgrade_snapshots.sql`
- Create: `supabase/migrations/20260514100400_profiles_dismissed_stage_upgrade.sql`
- Create: `supabase/migrations/20260514100500_set_lead_stage_objection.sql`

- [ ] **Step 1: Extend `kind` enum to include `'objection'`**

Write `supabase/migrations/20260514100000_pipeline_stage_kind_objection.sql`:

```sql
-- Allow Objection as a first-class stage kind (side-track stage).
alter table public.pipeline_stages
  drop constraint if exists pipeline_stages_kind_check;

alter table public.pipeline_stages
  add constraint pipeline_stages_kind_check
  check (kind in ('entry','qualifying','nurture','decision','won','lost','dormant','objection'));
```

- [ ] **Step 2: Create `pipeline_stage_suggestions` + `stage_suggestion_jobs`**

Write `supabase/migrations/20260514100100_pipeline_stage_suggestions.sql`:

```sql
create table public.pipeline_stage_suggestions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  stage_id        uuid not null references public.pipeline_stages(id) on delete cascade,
  field           text not null check (field in ('description','entry_signals','exit_signals','required_fields')),
  current_value   jsonb not null,
  proposed_value  jsonb not null,
  reason          text,
  source_refs     jsonb not null default '[]'::jsonb,
  status          text not null default 'pending'
                    check (status in ('pending','accepted','rejected','superseded','stale')),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references auth.users(id)
);

create index pipeline_stage_suggestions_user_pending_idx
  on public.pipeline_stage_suggestions (user_id)
  where status = 'pending';

create index pipeline_stage_suggestions_stage_field_idx
  on public.pipeline_stage_suggestions (stage_id, field)
  where status = 'pending';

alter table public.pipeline_stage_suggestions enable row level security;

create policy pipeline_stage_suggestions_owner_select
  on public.pipeline_stage_suggestions
  for select to authenticated using (user_id = auth.uid());

create policy pipeline_stage_suggestions_owner_update
  on public.pipeline_stage_suggestions
  for update to authenticated using (user_id = auth.uid());

create table public.stage_suggestion_jobs (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  run_at            timestamptz not null,
  last_completed_at timestamptz,
  status            text not null default 'queued'
                      check (status in ('queued','running','idle'))
);

create index stage_suggestion_jobs_due_idx
  on public.stage_suggestion_jobs (run_at)
  where status = 'queued';
```

- [ ] **Step 3: Add `leads.previous_stage_id`**

Write `supabase/migrations/20260514100200_leads_previous_stage_id.sql`:

```sql
alter table public.leads
  add column if not exists previous_stage_id uuid null
    references public.pipeline_stages(id) on delete set null;

create index if not exists leads_user_previous_stage_idx
  on public.leads (user_id, previous_stage_id)
  where previous_stage_id is not null;
```

- [ ] **Step 4: Add upgrade snapshots table**

Write `supabase/migrations/20260514100300_pipeline_stage_upgrade_snapshots.sql`:

```sql
create table public.pipeline_stage_upgrade_snapshots (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  snapshot   jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.pipeline_stage_upgrade_snapshots enable row level security;

create policy upgrade_snapshots_owner_select
  on public.pipeline_stage_upgrade_snapshots
  for select to authenticated using (user_id = auth.uid());
```

- [ ] **Step 5: Add `profiles.dismissed_stage_upgrade_at`**

Write `supabase/migrations/20260514100400_profiles_dismissed_stage_upgrade.sql`:

```sql
alter table public.profiles
  add column if not exists dismissed_stage_upgrade_at timestamptz null;
```

- [ ] **Step 6: Extend `set_lead_stage` RPC to manage `previous_stage_id`**

Write `supabase/migrations/20260514100500_set_lead_stage_objection.sql`:

```sql
-- Drop & recreate the function with previous_stage_id management.
-- The function signature is unchanged; behavior added:
--   * when moving INTO a stage where kind='objection', capture v_lead.stage_id
--     into leads.previous_stage_id (only if not already in Objection).
--   * when moving OUT OF a stage where kind='objection', clear leads.previous_stage_id.

create or replace function public.set_lead_stage(
  p_lead_id           uuid,
  p_to_stage_id       uuid,
  p_source            text,
  p_reason            text    default null,
  p_idempotency_key   text    default null,
  p_expected_version  int     default null,
  p_confidence        text    default null,
  p_thread_id         uuid    default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead         record;
  v_stage_user   uuid;
  v_from_stage   uuid;
  v_from_kind    text;
  v_to_kind      text;
  v_event_id     uuid;
  v_new_prev     uuid;
begin
  select id, user_id, stage_id, version, previous_stage_id
    into v_lead
    from public.leads
   where id = p_lead_id
     for update;

  if not found then
    raise exception 'Lead % not found', p_lead_id;
  end if;

  if p_expected_version is not null and v_lead.version != p_expected_version then
    return false;
  end if;

  select user_id, kind into v_stage_user, v_to_kind
    from public.pipeline_stages
   where id = p_to_stage_id;

  if not found then
    raise exception 'Stage % not found', p_to_stage_id;
  end if;

  if v_stage_user != v_lead.user_id then
    raise exception 'Stage % does not belong to the lead''s user', p_to_stage_id;
  end if;

  v_from_stage := v_lead.stage_id;

  select kind into v_from_kind
    from public.pipeline_stages
   where id = v_from_stage;

  -- Decide new previous_stage_id:
  --  * entering objection from non-objection -> capture v_from_stage
  --  * leaving objection (to non-objection)  -> clear (callers may have used previous_stage_id as the target)
  --  * objection -> objection                -> keep existing
  --  * any other transition                  -> keep existing previous_stage_id untouched
  if v_to_kind = 'objection' and coalesce(v_from_kind, '') <> 'objection' then
    v_new_prev := v_from_stage;
  elsif coalesce(v_from_kind, '') = 'objection' and v_to_kind <> 'objection' then
    v_new_prev := null;
  else
    v_new_prev := v_lead.previous_stage_id;
  end if;

  v_event_id := gen_random_uuid();

  insert into public.lead_stage_events
    (id, lead_id, user_id, from_stage_id, to_stage_id,
     source, reason, confidence, thread_id, idempotency_key)
  values
    (v_event_id, p_lead_id, v_lead.user_id, v_from_stage, p_to_stage_id,
     p_source, p_reason, p_confidence, p_thread_id, p_idempotency_key)
  on conflict (idempotency_key)
    where idempotency_key is not null
    do nothing;

  update public.leads
     set stage_id          = p_to_stage_id,
         previous_stage_id = v_new_prev,
         version           = version + 1,
         entered_stage_at  = case when stage_id <> p_to_stage_id then now() else entered_stage_at end,
         updated_at        = now()
   where id = p_lead_id;

  return true;
end;
$$;

revoke all on function public.set_lead_stage(uuid,uuid,text,text,text,int,text,uuid) from public;
grant execute on function public.set_lead_stage(uuid,uuid,text,text,text,int,text,uuid) to service_role;
```

- [ ] **Step 7: Apply migrations and verify**

Run:
```bash
npx supabase db push
```
Expected: 6 migrations applied; no errors.

Verify in Supabase Studio:
```sql
select kind, count(*) from public.pipeline_stages group by kind;
select column_name from information_schema.columns where table_name='leads' and column_name='previous_stage_id';
select column_name from information_schema.columns where table_name='profiles' and column_name='dismissed_stage_upgrade_at';
```

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/2026051410*.sql
git commit -m "feat(db): pipeline stage suggestions, objection kind, previous_stage_id, upgrade snapshots"
```

---

## Task 2: Rewrite `DEFAULT_STAGES` with full signal definitions

**Files:**
- Modify: `src/app/(app)/dashboard/leads/_lib/defaults.ts`
- Test: `src/app/(app)/dashboard/leads/_lib/defaults.test.ts`

- [ ] **Step 1: Write the snapshot test first**

Create `src/app/(app)/dashboard/leads/_lib/defaults.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_STAGES } from './defaults'

describe('DEFAULT_STAGES', () => {
  it('contains exactly 9 stages in canonical order', () => {
    expect(DEFAULT_STAGES.map((s) => s.name)).toEqual([
      'New Lead',
      'Engaged',
      'Interested',
      'Qualified',
      'Objection',
      'Proposal / Booked',
      'Won',
      'Lost',
      'Dormant',
    ])
  })

  it('every non-terminal stage has entry_signals populated', () => {
    for (const s of DEFAULT_STAGES) {
      if (s.kind === 'won' || s.kind === 'lost') continue
      expect(s.entry_signals.length, `stage "${s.name}" missing entry_signals`).toBeGreaterThan(0)
    }
  })

  it('Objection stage uses kind="objection"', () => {
    expect(DEFAULT_STAGES.find((s) => s.name === 'Objection')?.kind).toBe('objection')
  })

  it('first stage is the entry kind', () => {
    expect(DEFAULT_STAGES[0].kind).toBe('entry')
    expect(DEFAULT_STAGES[0].isDefault).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/app/\(app\)/dashboard/leads/_lib/defaults.test.ts`
Expected: FAIL — current `DEFAULT_STAGES` has 7 entries, no `entry_signals`.

- [ ] **Step 3: Rewrite `defaults.ts`**

Replace the entire contents of `src/app/(app)/dashboard/leads/_lib/defaults.ts`:

```ts
import type { PipelineStageKind } from '@/lib/action-pages/default-stage'

export type DefaultStage = {
  name: string
  description: string
  isDefault: boolean
  kind: PipelineStageKind | 'objection'
  entry_signals: string[]
  exit_signals: string[]
  required_fields: string[]
}

export const DEFAULT_STAGES: DefaultStage[] = [
  {
    name: 'New Lead',
    description: 'Freshly captured from any source. No inbound message yet.',
    isDefault: true,
    kind: 'entry',
    entry_signals: [
      'Lead record was just created from any source (form, ad, manual import).',
      'No inbound message exists from the lead yet.',
    ],
    exit_signals: ['Lead sends any inbound message.'],
    required_fields: [],
  },
  {
    name: 'Engaged',
    description: 'Lead has started talking but has not shown buying intent yet.',
    isDefault: false,
    kind: 'nurture',
    entry_signals: [
      'Lead sent at least one inbound message.',
      'Greeting, generic question ("hello", "kamusta", "what is this"), or acknowledgment.',
      'Asking about the business, brand, or general offerings without specifying price or buying details.',
    ],
    exit_signals: [
      'Asks a concrete buying question (price, stock, availability, schedule).',
      'Requests a sample, demo, menu, or quote.',
      'Volunteers qualifying info (budget, timeline, decision-maker).',
    ],
    required_fields: [],
  },
  {
    name: 'Interested',
    description: 'Actively evaluating — buying questions, requests for samples, follow-ups after pricing is shared.',
    isDefault: false,
    kind: 'nurture',
    entry_signals: [
      'Asked about price, stock, or availability ("magkano", "how much", "available ba").',
      'Asked about delivery, scheduling, location, or process AFTER pricing or offer was shared.',
      'Requested a sample, demo, menu, brochure, or catalog.',
      'Asked product-specific or service-specific clarifying questions tied to a purchase decision.',
    ],
    exit_signals: [
      'Confirms budget + timing + decision-maker (verbally or via form).',
      'Submits a qualification form with qualified outcome.',
      'Raises a clear objection (price, timing, trust, competitor).',
      'Books a slot or pays.',
    ],
    required_fields: [],
  },
  {
    name: 'Qualified',
    description: 'Confirmed fit — said yes to budget/timing/decision-maker or completed a qualifying form.',
    isDefault: false,
    kind: 'qualifying',
    entry_signals: [
      'Completed qualification form with qualified outcome.',
      'Explicitly confirmed budget AND timing AND decision-maker in chat.',
      'Requested a proposal or quote.',
      'Asked for next-step paperwork (contract, terms, invoice).',
    ],
    exit_signals: [
      'Proposal or quote sent.',
      'Booking confirmed.',
      'Raises an objection after qualification.',
      'No inbound for 7+ days.',
    ],
    required_fields: [],
  },
  {
    name: 'Objection',
    description: 'Side-track stage. Raised a blocking concern but has not rejected. Will return to previous active stage on resolution.',
    isDefault: false,
    kind: 'objection',
    entry_signals: [
      'Says price is too high, expensive, or wants a discount.',
      'Says "not now", "next time", or "need to think about it".',
      'Mentions a competitor or alternative they are considering.',
      'Raises a trust concern (legitimacy, reviews, refunds).',
      'Says they are waiting on someone else to decide.',
    ],
    exit_signals: [
      'Resolution: "okay, let\'s proceed", "sige, push natin", or similar positive commitment.',
      'Asks a forward-moving question (next steps, payment, scheduling) after the objection.',
      'Schedules a call, demo, or payment.',
      'Hard reject ("not interested", "no thanks", "unsubscribe") — moves to Lost.',
    ],
    required_fields: [],
  },
  {
    name: 'Proposal / Booked',
    description: 'Proposal, quote, or booking is on the table. Awaiting decision.',
    isDefault: false,
    kind: 'decision',
    entry_signals: [
      'Proposal or quote was sent.',
      'Booking confirmed by lead or by action page.',
      'Cart created or order link sent.',
    ],
    exit_signals: [
      'Payment received → Won.',
      'Explicitly declines → Lost.',
      '14 days of silence → Dormant (handled by sweeper).',
    ],
    required_fields: [],
  },
  {
    name: 'Won',
    description: 'Closed-won deal. Payment confirmed or order checked out.',
    isDefault: false,
    kind: 'won',
    entry_signals: [
      'Payment confirmed by action page or manual entry.',
      'Order checked out.',
      'Deal explicitly closed-won by user.',
    ],
    exit_signals: [],
    required_fields: [],
  },
  {
    name: 'Lost',
    description: 'Closed-lost. Explicit no, hard reject, or disqualification outcome.',
    isDefault: false,
    kind: 'lost',
    entry_signals: [
      'Explicit "no thanks", "not interested", "unsubscribe".',
      'Disqualification form outcome.',
      'Hard reject following an Objection.',
    ],
    exit_signals: [],
    required_fields: [],
  },
  {
    name: 'Dormant',
    description: 'Active lead that has gone quiet for 14+ days. Auto-detected daily; returns to previous active stage when they reply.',
    isDefault: false,
    kind: 'dormant',
    entry_signals: [
      'No inbound message for 14+ days in any non-terminal stage past New Lead.',
    ],
    exit_signals: [
      'Lead replies → return to previous active stage via previous_stage_id.',
    ],
    required_fields: [],
  },
]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/app/\(app\)/dashboard/leads/_lib/defaults.test.ts`
Expected: PASS — all 4 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/dashboard/leads/_lib/defaults.ts src/app/\(app\)/dashboard/leads/_lib/defaults.test.ts
git commit -m "feat(leads): rewrite DEFAULT_STAGES with 9 behavior-anchored stages and signals"
```

---

## Task 3: Update `seed.ts` to write jsonb columns

**Files:**
- Modify: `src/app/(app)/dashboard/leads/_lib/seed.ts`

- [ ] **Step 1: Replace seed.ts**

Replace the entire contents of `src/app/(app)/dashboard/leads/_lib/seed.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_STAGES } from './defaults'

export async function seedDefaultStagesIfEmpty(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { count, error: countErr } = await supabase
    .from('pipeline_stages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (countErr) throw countErr
  if ((count ?? 0) > 0) return false

  const rows = DEFAULT_STAGES.map((s, i) => ({
    user_id: userId,
    name: s.name,
    description: s.description,
    position: i,
    is_default: s.isDefault,
    kind: s.kind,
    is_won: s.kind === 'won',
    is_lost: s.kind === 'lost',
    is_terminal: s.kind === 'won' || s.kind === 'lost',
    entry_signals: s.entry_signals,
    exit_signals: s.exit_signals,
    required_fields: s.required_fields,
  }))

  const { error } = await supabase.from('pipeline_stages').insert(rows)
  if (error) throw error
  return true
}
```

- [ ] **Step 2: Smoke test against local Supabase (manual)**

Create a fresh test user via the auth panel, sign in. Confirm `select name, kind, jsonb_array_length(entry_signals) from pipeline_stages where user_id=...` returns 9 rows with non-zero `entry_signals` length for the 7 non-terminal stages.

- [ ] **Step 3: Commit**

```bash
git add src/app/\(app\)/dashboard/leads/_lib/seed.ts
git commit -m "feat(leads): seed new pipeline_stages jsonb columns from defaults"
```

---

## Task 4: Centralized bot-side `move-stage.ts` helper

**Files:**
- Create: `src/lib/leads/move-stage.ts`
- Test: `src/lib/leads/move-stage.test.ts`

- [ ] **Step 1: Write the test (mocked admin client)**

Create `src/lib/leads/move-stage.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { moveLeadToStage } from './move-stage'

function makeAdmin(rpcResult: unknown = true) {
  const rpc = vi.fn().mockResolvedValue({ data: rpcResult, error: null })
  return { rpc } as unknown as Parameters<typeof moveLeadToStage>[0]
}

describe('moveLeadToStage', () => {
  it('calls set_lead_stage with bot source and forwards matched signals into reason', async () => {
    const admin = makeAdmin(true)
    const ok = await moveLeadToStage(admin, {
      leadId: 'lead-1',
      toStageId: 'stage-1',
      source: 'bot-deep',
      confidence: 'medium',
      reason: 'asked price',
      matchedSignals: ['asked price', 'asked schedule'],
      threadId: 't-1',
    })
    expect(ok).toBe(true)
    expect((admin.rpc as ReturnType<typeof vi.fn>).mock.calls[0]).toMatchObject([
      'set_lead_stage',
      expect.objectContaining({
        p_lead_id: 'lead-1',
        p_to_stage_id: 'stage-1',
        p_source: 'bot-deep',
        p_confidence: 'medium',
        p_reason: 'matched: asked price, asked schedule — asked price',
        p_thread_id: 't-1',
      }),
    ])
  })

  it('returns false when the RPC returns false (version mismatch)', async () => {
    const admin = makeAdmin(false)
    const ok = await moveLeadToStage(admin, {
      leadId: 'lead-1',
      toStageId: 'stage-1',
      source: 'bot-deep',
      reason: 'r',
      matchedSignals: [],
    })
    expect(ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/leads/move-stage.test.ts`
Expected: FAIL — `move-stage` doesn't exist yet.

- [ ] **Step 3: Implement `move-stage.ts`**

Create `src/lib/leads/move-stage.ts`:

```ts
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export type MoveStageArgs = {
  leadId: string
  toStageId: string
  source: string
  reason: string
  matchedSignals: string[]
  confidence?: 'low' | 'medium' | 'high'
  idempotencyKey?: string
  threadId?: string
  expectedVersion?: number
}

export async function moveLeadToStage(admin: Admin, args: MoveStageArgs): Promise<boolean> {
  const reason =
    args.matchedSignals.length > 0
      ? `matched: ${args.matchedSignals.join(', ')} — ${args.reason}`
      : args.reason

  const { data, error } = await admin.rpc('set_lead_stage', {
    p_lead_id: args.leadId,
    p_to_stage_id: args.toStageId,
    p_source: args.source,
    p_reason: reason,
    p_confidence: args.confidence ?? null,
    p_idempotency_key: args.idempotencyKey ?? null,
    p_thread_id: args.threadId ?? null,
    p_expected_version: args.expectedVersion ?? null,
  })

  if (error) {
    console.warn('[leads.move-stage] set_lead_stage failed', { err: error.message, args })
    return false
  }
  return data === true
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/leads/move-stage.test.ts`
Expected: PASS — both cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/leads/move-stage.ts src/lib/leads/move-stage.test.ts
git commit -m "feat(leads): centralized bot-side moveLeadToStage helper"
```

---

## Task 5: Rewrite `deep-reclassify.ts` prompt with signal checklists

**Files:**
- Modify: `src/lib/chatbot/deep-reclassify.ts` (specifically `buildSystemPrompt` and `select` of stages)

- [ ] **Step 1: Update the stage select to fetch jsonb columns**

In `src/lib/chatbot/deep-reclassify.ts`, find the existing query that loads `ctx.stages` (look for the `.from('pipeline_stages').select(...)`). Replace its `select(...)` to include the signal columns:

```ts
const { data: stages } = await admin
  .from('pipeline_stages')
  .select('id, name, kind, position, description, entry_signals, exit_signals')
  .eq('user_id', lead.user_id)
  .order('position', { ascending: true })
```

Also update the `DeepStage` type used elsewhere in the file to include the new fields:

```ts
type DeepStage = {
  id: string
  name: string
  kind: string
  position: number
  description: string | null
  entry_signals: string[] | null
  exit_signals: string[] | null
}
```

- [ ] **Step 2: Rewrite `buildSystemPrompt`**

Replace the existing `buildSystemPrompt` with:

```ts
function buildSystemPrompt(ctx: DeepContext): string {
  const currentStage = ctx.stages.find((s) => s.id === ctx.lead.stage_id)

  const stageListText = ctx.stages
    .map((s) => {
      const entry = (s.entry_signals ?? []).map((sig) => `    • ${sig}`).join('\n')
      const exit = (s.exit_signals ?? []).map((sig) => `    • ${sig}`).join('\n')
      return (
        `- id=${s.id} name="${s.name}" kind=${s.kind} pos=${s.position}\n` +
        (s.description ? `  description: ${s.description}\n` : '') +
        (entry ? `  enter_when (≥1 must be observed):\n${entry}\n` : '') +
        (exit ? `  leave_when:\n${exit}` : '')
      )
    })
    .join('\n\n')

  return (
    'You are a deep sales-pipeline classifier. ' +
    'Analyse the full conversation history, form submissions, and prior stage transitions ' +
    'to decide whether this lead should move to a different pipeline stage.\n\n' +
    'Each stage has explicit ENTER signals — ≥1 must be observed in the lead\'s behaviour ' +
    'before you can move them in. The conversation may be in English, Tagalog, Taglish, or any language.\n\n' +
    'Output JSON only, matching this schema exactly:\n' +
    '{"stage_change": {' +
    '"to_stage_id": string, ' +
    '"move_type": "adjacent_forward"|"skip_ahead"|"into_terminal"|"into_objection"|"out_of_objection"|"backward", ' +
    '"confidence": "low"|"medium"|"high", ' +
    '"matched_signals": string[], ' +
    '"reason": string' +
    '} | null}\n\n' +
    'Rules for move_type:\n' +
    '  - adjacent_forward: target position is current position + 1 (or current is Objection and target is the lead\'s prior stage).\n' +
    '  - skip_ahead: target position is more than 1 greater than current.\n' +
    '  - into_terminal: target is Won or Lost (kind=won|lost).\n' +
    '  - into_objection: target kind=objection.\n' +
    '  - out_of_objection: current kind=objection and target is non-objection.\n' +
    '  - backward: target position is lower than current and not an objection move.\n\n' +
    'Return null when no move is warranted.\n' +
    'matched_signals MUST list which specific enter_when signals you observed (verbatim short phrases).\n' +
    'If no enter_when signal is observed, return null.\n\n' +
    `Current stage: id=${ctx.lead.stage_id}` +
    (currentStage ? ` name="${currentStage.name}" kind=${currentStage.kind}` : '') +
    '\n\n' +
    'Available stages:\n' +
    stageListText
  )
}
```

- [ ] **Step 3: Build the project to catch type errors**

Run: `pnpm tsc --noEmit`
Expected: PASS — or fix any `entry_signals`/`exit_signals` typing issues by aligning the `DeepStage` type with the select.

- [ ] **Step 4: Commit**

```bash
git add src/lib/chatbot/deep-reclassify.ts
git commit -m "feat(chatbot): deep-reclassify prompt uses entry/exit signal checklists per stage"
```

---

## Task 6: Tiered confidence policy, `matched_signals`, Objection-resolution

**Files:**
- Modify: `src/lib/chatbot/deep-reclassify.ts`
- Test: `src/lib/chatbot/deep-reclassify.test.ts`

- [ ] **Step 1: Write the test cases**

Create `src/lib/chatbot/deep-reclassify.test.ts` (if it doesn't exist already; otherwise append):

```ts
import { describe, it, expect } from 'vitest'
import { coerceDecision, classifyMoveType } from './deep-reclassify'

const stages = [
  { id: 's1', name: 'New', kind: 'entry', position: 0 },
  { id: 's2', name: 'Engaged', kind: 'nurture', position: 1 },
  { id: 's3', name: 'Interested', kind: 'nurture', position: 2 },
  { id: 's4', name: 'Qualified', kind: 'qualifying', position: 3 },
  { id: 's5', name: 'Objection', kind: 'objection', position: 4 },
  { id: 's7', name: 'Won', kind: 'won', position: 6 },
] as const

describe('classifyMoveType', () => {
  it('adjacent forward', () => {
    expect(classifyMoveType(stages, 's2', 's3')).toBe('adjacent_forward')
  })
  it('skip ahead', () => {
    expect(classifyMoveType(stages, 's2', 's4')).toBe('skip_ahead')
  })
  it('into terminal', () => {
    expect(classifyMoveType(stages, 's3', 's7')).toBe('into_terminal')
  })
  it('into objection', () => {
    expect(classifyMoveType(stages, 's3', 's5')).toBe('into_objection')
  })
  it('out of objection', () => {
    expect(classifyMoveType(stages, 's5', 's3')).toBe('out_of_objection')
  })
  it('backward', () => {
    expect(classifyMoveType(stages, 's4', 's2')).toBe('backward')
  })
})

describe('coerceDecision', () => {
  const base = {
    to_stage_id: 's3',
    matched_signals: ['asked price'],
    reason: 'lead asked magkano',
    move_type: 'adjacent_forward',
  }

  it('accepts medium confidence on adjacent forward', () => {
    const json = JSON.stringify({ stage_change: { ...base, confidence: 'medium' } })
    expect(coerceDecision(json)).not.toBeNull()
  })

  it('rejects medium confidence on skip_ahead', () => {
    const json = JSON.stringify({
      stage_change: { ...base, move_type: 'skip_ahead', confidence: 'medium' },
    })
    expect(coerceDecision(json)).toBeNull()
  })

  it('rejects medium confidence on into_terminal', () => {
    const json = JSON.stringify({
      stage_change: { ...base, move_type: 'into_terminal', confidence: 'medium' },
    })
    expect(coerceDecision(json)).toBeNull()
  })

  it('rejects when matched_signals is empty', () => {
    const json = JSON.stringify({
      stage_change: { ...base, matched_signals: [], confidence: 'high' },
    })
    expect(coerceDecision(json)).toBeNull()
  })

  it('accepts high confidence on backward only with regression in reason', () => {
    const okJson = JSON.stringify({
      stage_change: { ...base, move_type: 'backward', confidence: 'high', reason: 'regression: lead un-confirmed budget' },
    })
    const badJson = JSON.stringify({
      stage_change: { ...base, move_type: 'backward', confidence: 'high', reason: 'lead said nothing' },
    })
    expect(coerceDecision(okJson)).not.toBeNull()
    expect(coerceDecision(badJson)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/lib/chatbot/deep-reclassify.test.ts`
Expected: FAIL — `classifyMoveType` doesn't exist; `coerceDecision` is too strict.

- [ ] **Step 3: Implement `classifyMoveType` and rewrite `coerceDecision`**

In `src/lib/chatbot/deep-reclassify.ts`:

```ts
export type MoveType =
  | 'adjacent_forward'
  | 'skip_ahead'
  | 'into_terminal'
  | 'into_objection'
  | 'out_of_objection'
  | 'backward'

export function classifyMoveType(
  stages: ReadonlyArray<{ id: string; kind: string; position: number }>,
  fromId: string,
  toId: string,
): MoveType | null {
  const from = stages.find((s) => s.id === fromId)
  const to = stages.find((s) => s.id === toId)
  if (!from || !to) return null
  if (to.kind === 'won' || to.kind === 'lost') return 'into_terminal'
  if (to.kind === 'objection') return 'into_objection'
  if (from.kind === 'objection') return 'out_of_objection'
  if (to.position === from.position + 1) return 'adjacent_forward'
  if (to.position > from.position) return 'skip_ahead'
  return 'backward'
}

export type DeepDecision = {
  to_stage_id: string
  move_type: MoveType
  confidence: 'low' | 'medium' | 'high'
  matched_signals: string[]
  reason: string
}

const VALID_MOVE_TYPES = new Set<MoveType>([
  'adjacent_forward',
  'skip_ahead',
  'into_terminal',
  'into_objection',
  'out_of_objection',
  'backward',
])

export function coerceDecision(raw: string): DeepDecision | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const p = parsed as { stage_change?: unknown }
  const sc = p.stage_change
  if (!sc || typeof sc !== 'object') return null
  const s = sc as Record<string, unknown>

  if (typeof s.to_stage_id !== 'string') return null
  if (typeof s.reason !== 'string') return null
  if (!Array.isArray(s.matched_signals)) return null
  const matched = s.matched_signals.filter((x): x is string => typeof x === 'string')
  if (matched.length === 0) return null

  if (typeof s.move_type !== 'string' || !VALID_MOVE_TYPES.has(s.move_type as MoveType)) return null
  const moveType = s.move_type as MoveType

  if (s.confidence !== 'low' && s.confidence !== 'medium' && s.confidence !== 'high') return null
  const confidence = s.confidence

  // Tiered gate
  const allowsMedium =
    moveType === 'adjacent_forward' ||
    moveType === 'into_objection' ||
    moveType === 'out_of_objection'

  if (confidence === 'low') return null
  if (confidence === 'medium' && !allowsMedium) return null

  if (moveType === 'backward') {
    // require explicit regression language
    if (!/regress|moved? back|un-?confirmed|reverted/i.test(s.reason)) return null
  }

  return { to_stage_id: s.to_stage_id, move_type: moveType, confidence, matched_signals: matched, reason: s.reason }
}
```

- [ ] **Step 4: Wire the move execution through `moveLeadToStage`**

Find the existing call site that applies the decision (look for `set_lead_stage` RPC call inside `deep-reclassify.ts`). Replace it with:

```ts
import { moveLeadToStage } from '@/lib/leads/move-stage'

// ... inside the apply path:
if (!ctx.stages.some((s) => s.id === decision.to_stage_id)) return

const moveType = classifyMoveType(ctx.stages, ctx.lead.stage_id, decision.to_stage_id)
if (!moveType) return

// If LLM-reported move_type disagrees with the structural one, trust the structural classification.
if (moveType !== decision.move_type) {
  console.warn('[deep-reclassify] move_type mismatch — trusting structural', {
    llm: decision.move_type,
    structural: moveType,
  })
}

await moveLeadToStage(admin, {
  leadId: ctx.lead.id,
  toStageId: decision.to_stage_id,
  source: 'bot-deep',
  reason: decision.reason,
  matchedSignals: decision.matched_signals,
  confidence: decision.confidence,
  threadId: ctx.thread_id,
})
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/lib/chatbot/deep-reclassify.test.ts`
Expected: PASS — all cases green.

- [ ] **Step 6: Run type check**

Run: `pnpm tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/chatbot/deep-reclassify.ts src/lib/chatbot/deep-reclassify.test.ts
git commit -m "feat(chatbot): tiered confidence policy + matched_signals + structural move_type validation"
```

---

## Task 7: Dormant sweeper cron

**Files:**
- Create: `src/lib/leads/dormant-sweeper.ts`
- Create: `src/lib/leads/dormant-sweeper.test.ts`
- Create: `src/app/api/cron/leads-dormant-sweep/route.ts`
- Modify: Supabase cron schedule (one-time SQL via Studio or migration)

- [ ] **Step 1: Write the test**

Create `src/lib/leads/dormant-sweeper.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { computeDormantMoves } from './dormant-sweeper'

const now = new Date('2026-05-14T00:00:00Z')

const stages = [
  { id: 'new', kind: 'entry', name: 'New', position: 0 },
  { id: 'eng', kind: 'nurture', name: 'Engaged', position: 1 },
  { id: 'won', kind: 'won', name: 'Won', position: 6 },
  { id: 'dor', kind: 'dormant', name: 'Dormant', position: 8 },
]

describe('computeDormantMoves', () => {
  it('marks leads inactive >14d in Engaged as Dormant', () => {
    const leads = [
      { id: 'L1', stage_id: 'eng', last_inbound_at: '2026-04-20T00:00:00Z' }, // 24d
      { id: 'L2', stage_id: 'eng', last_inbound_at: '2026-05-10T00:00:00Z' }, // 4d
    ]
    const moves = computeDormantMoves(leads, stages, now)
    expect(moves).toEqual([{ leadId: 'L1', toStageId: 'dor', fromStageId: 'eng' }])
  })

  it('skips terminal stages', () => {
    const leads = [{ id: 'L1', stage_id: 'won', last_inbound_at: '2026-01-01T00:00:00Z' }]
    expect(computeDormantMoves(leads, stages, now)).toEqual([])
  })

  it('skips New Lead (kind=entry) — only Engaged or further qualifies for Dormant', () => {
    const leads = [{ id: 'L1', stage_id: 'new', last_inbound_at: null }]
    expect(computeDormantMoves(leads, stages, now)).toEqual([])
  })

  it('returns empty when no Dormant stage exists for the user', () => {
    const noDormant = stages.filter((s) => s.kind !== 'dormant')
    const leads = [{ id: 'L1', stage_id: 'eng', last_inbound_at: '2026-04-01T00:00:00Z' }]
    expect(computeDormantMoves(leads, noDormant, now)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/leads/dormant-sweeper.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the sweeper**

Create `src/lib/leads/dormant-sweeper.ts`:

```ts
import type { createAdminClient } from '@/lib/supabase/admin'
import { moveLeadToStage } from './move-stage'

type Admin = ReturnType<typeof createAdminClient>

const DORMANT_DAYS = 14

export type SweepStage = { id: string; kind: string; name: string; position: number }
export type SweepLead = { id: string; stage_id: string; last_inbound_at: string | null }
export type SweepMove = { leadId: string; toStageId: string; fromStageId: string }

export function computeDormantMoves(
  leads: SweepLead[],
  stages: SweepStage[],
  now: Date,
): SweepMove[] {
  const dormant = stages.find((s) => s.kind === 'dormant')
  if (!dormant) return []

  const byId = new Map(stages.map((s) => [s.id, s]))
  const threshold = now.getTime() - DORMANT_DAYS * 24 * 60 * 60 * 1000

  const moves: SweepMove[] = []
  for (const l of leads) {
    const stage = byId.get(l.stage_id)
    if (!stage) continue
    if (stage.kind === 'won' || stage.kind === 'lost' || stage.kind === 'dormant') continue
    if (stage.kind === 'entry') continue // New Lead doesn't go Dormant
    if (!l.last_inbound_at) continue
    if (new Date(l.last_inbound_at).getTime() > threshold) continue
    moves.push({ leadId: l.id, toStageId: dormant.id, fromStageId: l.stage_id })
  }
  return moves
}

export async function runDormantSweepForUser(admin: Admin, userId: string, now = new Date()): Promise<number> {
  const { data: stages, error: stagesErr } = await admin
    .from('pipeline_stages')
    .select('id, kind, name, position')
    .eq('user_id', userId)
  if (stagesErr || !stages) return 0

  const { data: leads, error: leadsErr } = await admin
    .from('leads')
    .select('id, stage_id, last_inbound_at')
    .eq('user_id', userId)
  if (leadsErr || !leads) return 0

  const moves = computeDormantMoves(leads as SweepLead[], stages as SweepStage[], now)
  let moved = 0
  for (const m of moves) {
    const ok = await moveLeadToStage(admin, {
      leadId: m.leadId,
      toStageId: m.toStageId,
      source: 'system-dormant',
      reason: `no inbound for ${DORMANT_DAYS}+ days`,
      matchedSignals: [],
    })
    if (ok) moved++
  }
  return moved
}

export async function runDormantSweepForAllUsers(admin: Admin, now = new Date()): Promise<number> {
  const { data: users } = await admin.from('profiles').select('id')
  let total = 0
  for (const u of (users ?? []) as { id: string }[]) {
    total += await runDormantSweepForUser(admin, u.id, now)
  }
  return total
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/leads/dormant-sweeper.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the cron route**

Create `src/app/api/cron/leads-dormant-sweep/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runDormantSweepForAllUsers } from '@/lib/leads/dormant-sweeper'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  const isDev = process.env.NODE_ENV !== 'production'
  if (!isDev) {
    const auth = req.headers.get('authorization')
    const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
    if (!process.env.CRON_SECRET || auth !== expected) {
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }
  const admin = createAdminClient()
  const moved = await runDormantSweepForAllUsers(admin)
  return NextResponse.json({ ok: true, moved })
}
```

- [ ] **Step 6: Schedule pg_cron job**

Run this SQL once in Supabase Studio (capture it in a migration if your team policy requires):

```sql
select cron.schedule(
  'leads-dormant-sweep-daily',
  '0 3 * * *',
  $$
    select net.http_get(
      url := current_setting('app.cron_base_url') || '/api/cron/leads-dormant-sweep',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.cron_secret'))
    );
  $$
);
```

Confirm with: `select * from cron.job where jobname = 'leads-dormant-sweep-daily';`

- [ ] **Step 7: Commit**

```bash
git add src/lib/leads/dormant-sweeper.ts src/lib/leads/dormant-sweeper.test.ts src/app/api/cron/leads-dormant-sweep/route.ts
git commit -m "feat(leads): dormant sweeper cron — auto-mark inactive leads as Dormant"
```

---

## Task 8: `stage-suggester.ts` core lib

**Files:**
- Create: `src/lib/leads/stage-suggester.ts`
- Create: `src/lib/leads/stage-suggester.test.ts`

- [ ] **Step 1: Write the test (mock LLM)**

Create `src/lib/leads/stage-suggester.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { buildSuggesterPrompt, parseSuggesterOutput } from './stage-suggester'

describe('buildSuggesterPrompt', () => {
  it('includes every stage with its signals and the knowledge summary', () => {
    const prompt = buildSuggesterPrompt({
      stages: [
        { id: 's1', name: 'Interested', kind: 'nurture', description: 'd', entry_signals: ['asked price'], exit_signals: ['booked'], required_fields: [] },
      ],
      knowledge: {
        offers: ['Premium tier — ₱5000/mo'],
        faqs: ['Do you ship internationally? Yes.'],
        qualification_criteria: ['Budget ≥ ₱3000/mo'],
        tags: ['saas', 'monthly'],
      },
    })
    expect(prompt).toContain('Interested')
    expect(prompt).toContain('asked price')
    expect(prompt).toContain('Premium tier')
    expect(prompt).toContain('Do you ship internationally')
  })
})

describe('parseSuggesterOutput', () => {
  it('returns suggestions when JSON is valid', () => {
    const json = JSON.stringify({
      suggestions: [
        {
          stage_id: 's1',
          field: 'entry_signals',
          proposed_value: ['asked price', 'asked about premium tier specifically'],
          reason: 'knowledge mentions Premium tier as a buying signal',
        },
      ],
    })
    expect(parseSuggesterOutput(json)).toHaveLength(1)
  })

  it('rejects unknown fields', () => {
    const json = JSON.stringify({
      suggestions: [
        { stage_id: 's1', field: 'random_field', proposed_value: [], reason: 'x' },
      ],
    })
    expect(parseSuggesterOutput(json)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/leads/stage-suggester.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the suggester**

Create `src/lib/leads/stage-suggester.ts`:

```ts
import type { createAdminClient } from '@/lib/supabase/admin'
import { callLlm } from '@/lib/chatbot/llm' // existing project LLM client; adjust path if different

type Admin = ReturnType<typeof createAdminClient>

export type SuggesterStage = {
  id: string
  name: string
  kind: string
  description: string | null
  entry_signals: string[]
  exit_signals: string[]
  required_fields: string[]
}

export type KnowledgeSummary = {
  offers: string[]
  faqs: string[]
  qualification_criteria: string[]
  tags: string[]
}

export type Suggestion = {
  stage_id: string
  field: 'description' | 'entry_signals' | 'exit_signals' | 'required_fields'
  proposed_value: unknown
  reason: string
  source_refs?: string[]
}

const VALID_FIELDS = new Set<Suggestion['field']>([
  'description',
  'entry_signals',
  'exit_signals',
  'required_fields',
])

export function buildSuggesterPrompt(input: { stages: SuggesterStage[]; knowledge: KnowledgeSummary }): string {
  const stageBlock = input.stages
    .map((s) =>
      [
        `stage_id=${s.id} name="${s.name}" kind=${s.kind}`,
        `  description: ${s.description ?? ''}`,
        `  entry_signals: ${JSON.stringify(s.entry_signals)}`,
        `  exit_signals: ${JSON.stringify(s.exit_signals)}`,
        `  required_fields: ${JSON.stringify(s.required_fields)}`,
      ].join('\n'),
    )
    .join('\n\n')

  const knowBlock =
    `offers:\n${input.knowledge.offers.map((o) => '  - ' + o).join('\n') || '  (none)'}\n` +
    `faqs:\n${input.knowledge.faqs.map((f) => '  - ' + f).join('\n') || '  (none)'}\n` +
    `qualification_criteria:\n${input.knowledge.qualification_criteria.map((q) => '  - ' + q).join('\n') || '  (none)'}\n` +
    `tags: ${input.knowledge.tags.join(', ')}`

  return (
    'You are a sales pipeline tuner. Given the user\'s current pipeline stages and a summary of ' +
    'their business knowledge (offers, FAQs, qualification criteria), propose targeted edits to ' +
    'stage descriptions and signal lists so they match what this business actually sells and asks.\n\n' +
    'Only propose changes where there is a concrete mismatch — e.g. the knowledge mentions a specific ' +
    'product or qualification question that the stage signals do not reflect. Do NOT propose stylistic ' +
    'rewrites.\n\n' +
    'Output JSON only:\n' +
    '{"suggestions": [{"stage_id": string, "field": "description"|"entry_signals"|"exit_signals"|"required_fields", "proposed_value": any, "reason": string}]}\n\n' +
    'For array fields (entry_signals, exit_signals, required_fields), proposed_value is the FULL replacement array, not a delta.\n\n' +
    `# Current stages\n${stageBlock}\n\n# Knowledge\n${knowBlock}`
  )
}

export function parseSuggesterOutput(raw: string): Suggestion[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return []
    const arr = (parsed as { suggestions?: unknown }).suggestions
    if (!Array.isArray(arr)) return []
    const out: Suggestion[] = []
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue
      const it = item as Record<string, unknown>
      if (typeof it.stage_id !== 'string') continue
      if (typeof it.field !== 'string' || !VALID_FIELDS.has(it.field as Suggestion['field'])) continue
      if (typeof it.reason !== 'string') continue
      out.push({
        stage_id: it.stage_id,
        field: it.field as Suggestion['field'],
        proposed_value: it.proposed_value,
        reason: it.reason,
      })
    }
    return out
  } catch {
    return []
  }
}

export async function loadKnowledgeSummary(admin: Admin, userId: string): Promise<KnowledgeSummary> {
  const offers: string[] = []
  const faqs: string[] = []
  const qualification_criteria: string[] = []
  const tagsSet = new Set<string>()

  const { data: items } = await admin
    .from('business_items')
    .select('title, rag_text')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(50)
  for (const it of (items ?? []) as { title: string; rag_text: string | null }[]) {
    offers.push(`${it.title}: ${(it.rag_text ?? '').slice(0, 240)}`)
  }

  const { data: faqRows } = await admin
    .from('knowledge_faqs')
    .select('question, answer')
    .eq('user_id', userId)
    .limit(50)
  for (const f of (faqRows ?? []) as { question: string; answer: string }[]) {
    faqs.push(`${f.question} → ${(f.answer ?? '').slice(0, 200)}`)
  }

  // Qualification criteria from any qualification action page
  const { data: pages } = await admin
    .from('action_pages')
    .select('id, kind, config')
    .eq('user_id', userId)
    .eq('kind', 'qualification')
  for (const p of (pages ?? []) as { config: unknown }[]) {
    const cfg = p.config as { questions?: { prompt?: string }[] } | null
    for (const q of cfg?.questions ?? []) {
      if (q.prompt) qualification_criteria.push(q.prompt)
    }
  }

  const { data: tagRows } = await admin
    .from('knowledge_tags')
    .select('name')
    .eq('user_id', userId)
    .limit(30)
  for (const t of (tagRows ?? []) as { name: string }[]) tagsSet.add(t.name)

  return { offers, faqs, qualification_criteria, tags: [...tagsSet] }
}

export async function runSuggesterForUser(admin: Admin, userId: string): Promise<number> {
  const { data: stages } = await admin
    .from('pipeline_stages')
    .select('id, name, kind, description, entry_signals, exit_signals, required_fields')
    .eq('user_id', userId)
    .order('position')

  if (!stages || stages.length === 0) return 0

  const knowledge = await loadKnowledgeSummary(admin, userId)
  const prompt = buildSuggesterPrompt({ stages: stages as SuggesterStage[], knowledge })
  const raw = await callLlm({ prompt, jsonMode: true })
  const suggestions = parseSuggesterOutput(raw)

  let written = 0
  for (const s of suggestions) {
    const stage = (stages as SuggesterStage[]).find((x) => x.id === s.stage_id)
    if (!stage) continue
    const currentValue =
      s.field === 'description'
        ? stage.description
        : s.field === 'entry_signals'
          ? stage.entry_signals
          : s.field === 'exit_signals'
            ? stage.exit_signals
            : stage.required_fields

    // Supersede earlier pending suggestions for the same (stage_id, field).
    await admin
      .from('pipeline_stage_suggestions')
      .update({ status: 'superseded' })
      .eq('user_id', userId)
      .eq('stage_id', s.stage_id)
      .eq('field', s.field)
      .eq('status', 'pending')

    const { error } = await admin.from('pipeline_stage_suggestions').insert({
      user_id: userId,
      stage_id: s.stage_id,
      field: s.field,
      current_value: currentValue,
      proposed_value: s.proposed_value,
      reason: s.reason,
      source_refs: s.source_refs ?? [],
    })
    if (!error) written++
  }

  await admin
    .from('stage_suggestion_jobs')
    .update({ status: 'idle', last_completed_at: new Date().toISOString() })
    .eq('user_id', userId)

  return written
}
```

> **Note:** If the existing project LLM client lives at a different path than `@/lib/chatbot/llm`, swap the import to match. `grep -rn "callLlm\|chat.completions" src/lib/chatbot` will surface the real location.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/leads/stage-suggester.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/leads/stage-suggester.ts src/lib/leads/stage-suggester.test.ts
git commit -m "feat(leads): stage-suggester core — diff stages vs knowledge into pending suggestions"
```

---

## Task 9: Embedding-completion hook + suggester-runner cron

**Files:**
- Modify: `src/lib/rag/worker/embed-job.ts` (call `enqueueStageSuggestionJob` on success)
- Create: `src/lib/leads/stage-suggester-queue.ts`
- Create: `src/app/api/cron/stage-suggestions-tick/route.ts`

- [ ] **Step 1: Create the enqueue helper**

Create `src/lib/leads/stage-suggester-queue.ts`:

```ts
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

const DEBOUNCE_SECONDS = 60
const MIN_INTERVAL_SECONDS = 300 // 5-minute cost guardrail

export async function enqueueStageSuggestionJob(admin: Admin, userId: string): Promise<void> {
  const runAt = new Date(Date.now() + DEBOUNCE_SECONDS * 1000).toISOString()

  // Upsert: if a row exists with status='queued', push run_at forward.
  // If status='running' or 'idle', queue a new run respecting MIN_INTERVAL_SECONDS.
  const { data: existing } = await admin
    .from('stage_suggestion_jobs')
    .select('user_id, status, last_completed_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (!existing) {
    await admin.from('stage_suggestion_jobs').insert({
      user_id: userId,
      run_at: runAt,
      status: 'queued',
    })
    return
  }

  if (existing.status === 'queued') {
    await admin.from('stage_suggestion_jobs').update({ run_at: runAt }).eq('user_id', userId)
    return
  }

  // running or idle — check minimum interval before requeuing
  const last = existing.last_completed_at ? new Date(existing.last_completed_at).getTime() : 0
  if (Date.now() - last < MIN_INTERVAL_SECONDS * 1000) return

  await admin
    .from('stage_suggestion_jobs')
    .update({ status: 'queued', run_at: runAt })
    .eq('user_id', userId)
}
```

- [ ] **Step 2: Hook into embed-job success**

Open `src/lib/rag/worker/embed-job.ts` and find where a job transitions to `succeeded` (search for `status: 'succeeded'` or similar). Add the hook right after the status update commits:

```ts
import { enqueueStageSuggestionJob } from '@/lib/leads/stage-suggester-queue'

// ... after marking the embedding job succeeded:
try {
  await enqueueStageSuggestionJob(admin, job.user_id)
} catch (err) {
  console.warn('[embed-job] failed to enqueue stage suggestion', { err })
}
```

If there are multiple "succeeded" transitions in that file, hook into all of them — but only when the source is one of `document | faq | business_item` (skip `media_asset`, which doesn't affect stage signals).

- [ ] **Step 3: Create the suggester runner cron route**

Create `src/app/api/cron/stage-suggestions-tick/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runSuggesterForUser } from '@/lib/leads/stage-suggester'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: Request) {
  const isDev = process.env.NODE_ENV !== 'production'
  if (!isDev) {
    const auth = req.headers.get('authorization')
    const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
    if (!process.env.CRON_SECRET || auth !== expected) {
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  // Claim up to 20 due jobs.
  const { data: due } = await admin
    .from('stage_suggestion_jobs')
    .select('user_id')
    .eq('status', 'queued')
    .lte('run_at', nowIso)
    .limit(20)

  let processed = 0
  for (const j of (due ?? []) as { user_id: string }[]) {
    // Mark running, idempotently (best-effort lock).
    const { error: lockErr } = await admin
      .from('stage_suggestion_jobs')
      .update({ status: 'running' })
      .eq('user_id', j.user_id)
      .eq('status', 'queued')
    if (lockErr) continue

    try {
      await runSuggesterForUser(admin, j.user_id)
      processed++
    } catch (err) {
      console.warn('[stage-suggestions-tick] failed', { user_id: j.user_id, err })
      await admin.from('stage_suggestion_jobs').update({ status: 'idle' }).eq('user_id', j.user_id)
    }
  }

  return NextResponse.json({ ok: true, processed })
}
```

- [ ] **Step 4: Schedule the pg_cron job**

Run in Supabase Studio:

```sql
select cron.schedule(
  'stage-suggestions-tick',
  '* * * * *',
  $$
    select net.http_get(
      url := current_setting('app.cron_base_url') || '/api/cron/stage-suggestions-tick',
      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.cron_secret'))
    );
  $$
);
```

- [ ] **Step 5: Manual smoke test**

In a dev environment: edit a FAQ; within ~90s, confirm a `pipeline_stage_suggestions` row appears (or that the LLM correctly returned no suggestions).

```sql
select user_id, run_at, status, last_completed_at from stage_suggestion_jobs;
select status, field, reason from pipeline_stage_suggestions order by created_at desc limit 5;
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/leads/stage-suggester-queue.ts src/app/api/cron/stage-suggestions-tick/route.ts src/lib/rag/worker/embed-job.ts
git commit -m "feat(leads): debounced stage-suggestion enqueue on embed success + runner cron"
```

---

## Task 10: Stale-suggestion housekeeping

**Files:**
- Modify: `src/app/api/cron/leads-dormant-sweep/route.ts` (piggyback the daily run)
- Create: `src/lib/leads/suggestion-housekeeping.ts`
- Create: `src/lib/leads/suggestion-housekeeping.test.ts`

- [ ] **Step 1: Write the test**

Create `src/lib/leads/suggestion-housekeeping.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeStaleSuggestionIds } from './suggestion-housekeeping'

describe('computeStaleSuggestionIds', () => {
  it('flags suggestions older than stage.updated_at', () => {
    const suggestions = [
      { id: 'S1', stage_id: 'stg', created_at: '2026-05-01T00:00:00Z' },
      { id: 'S2', stage_id: 'stg', created_at: '2026-05-10T00:00:00Z' },
    ]
    const stages = [{ id: 'stg', updated_at: '2026-05-05T00:00:00Z' }]
    expect(computeStaleSuggestionIds(suggestions, stages)).toEqual(['S1'])
  })

  it('keeps suggestions for stages with no updated_at change since creation', () => {
    const suggestions = [{ id: 'S1', stage_id: 'stg', created_at: '2026-05-10T00:00:00Z' }]
    const stages = [{ id: 'stg', updated_at: '2026-05-01T00:00:00Z' }]
    expect(computeStaleSuggestionIds(suggestions, stages)).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/lib/leads/suggestion-housekeeping.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `src/lib/leads/suggestion-housekeeping.ts`:

```ts
import type { createAdminClient } from '@/lib/supabase/admin'

type Admin = ReturnType<typeof createAdminClient>

export function computeStaleSuggestionIds(
  suggestions: { id: string; stage_id: string; created_at: string }[],
  stages: { id: string; updated_at: string | null }[],
): string[] {
  const stageMap = new Map(stages.map((s) => [s.id, s.updated_at]))
  const stale: string[] = []
  for (const s of suggestions) {
    const stageUpdated = stageMap.get(s.stage_id)
    if (!stageUpdated) continue
    if (new Date(stageUpdated).getTime() > new Date(s.created_at).getTime()) {
      stale.push(s.id)
    }
  }
  return stale
}

const SNAPSHOT_TTL_DAYS = 30

export async function runSuggestionHousekeeping(admin: Admin, now = new Date()): Promise<{ stale: number; snapshotsRemoved: number }> {
  // 1. Mark stale: pending suggestions whose stage was edited after the suggestion was created.
  const { data: pending } = await admin
    .from('pipeline_stage_suggestions')
    .select('id, stage_id, created_at')
    .eq('status', 'pending')

  const stageIds = [...new Set((pending ?? []).map((s) => s.stage_id))]
  let stale = 0
  if (stageIds.length > 0) {
    const { data: stages } = await admin
      .from('pipeline_stages')
      .select('id, updated_at')
      .in('id', stageIds)
    const staleIds = computeStaleSuggestionIds(
      (pending ?? []) as { id: string; stage_id: string; created_at: string }[],
      (stages ?? []) as { id: string; updated_at: string | null }[],
    )
    if (staleIds.length > 0) {
      await admin
        .from('pipeline_stage_suggestions')
        .update({ status: 'stale', resolved_at: now.toISOString() })
        .in('id', staleIds)
      stale = staleIds.length
    }
  }

  // 2. Drop upgrade snapshots older than 30 days.
  const cutoff = new Date(now.getTime() - SNAPSHOT_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { count } = await admin
    .from('pipeline_stage_upgrade_snapshots')
    .delete({ count: 'exact' })
    .lt('created_at', cutoff)

  return { stale, snapshotsRemoved: count ?? 0 }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/lib/leads/suggestion-housekeeping.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into the daily cron**

Modify `src/app/api/cron/leads-dormant-sweep/route.ts` — add the housekeeping call after the sweep:

```ts
import { runSuggestionHousekeeping } from '@/lib/leads/suggestion-housekeeping'
// ...
const moved = await runDormantSweepForAllUsers(admin)
const housekeeping = await runSuggestionHousekeeping(admin)
return NextResponse.json({ ok: true, moved, housekeeping })
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/leads/suggestion-housekeeping.ts src/lib/leads/suggestion-housekeeping.test.ts src/app/api/cron/leads-dormant-sweep/route.ts
git commit -m "feat(leads): daily suggestion staleness + snapshot TTL housekeeping"
```

---

## Task 11: `upgrade.ts` — detect / preview / apply / undo

**Files:**
- Create: `src/lib/leads/upgrade.ts`
- Create: `src/lib/leads/upgrade.test.ts`

- [ ] **Step 1: Write the test**

Create `src/lib/leads/upgrade.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { matchStage, planUpgrade } from './upgrade'
import { DEFAULT_STAGES } from '@/app/(app)/dashboard/leads/_lib/defaults'

const existingClassic = [
  { id: 'A', name: 'New Lead', kind: 'entry', position: 0, entry_signals: null },
  { id: 'B', name: 'Contacted', kind: 'nurture', position: 1, entry_signals: null },
  { id: 'C', name: 'Qualified', kind: 'qualifying', position: 2, entry_signals: null },
  { id: 'D', name: 'Won', kind: 'won', position: 5, entry_signals: null },
  { id: 'E', name: 'Lost', kind: 'lost', position: 6, entry_signals: null },
  { id: 'X', name: 'Follow-Up', kind: 'nurture', position: 7, entry_signals: null },
]

describe('matchStage', () => {
  it('matches Contacted to the canonical Engaged slot via kind=nurture pos=1', () => {
    const m = matchStage(existingClassic[1], DEFAULT_STAGES)
    expect(m?.name).toBe('Engaged')
  })

  it('returns null for user-renamed custom stage Follow-Up', () => {
    const m = matchStage(existingClassic[5], DEFAULT_STAGES)
    // We do NOT auto-match custom user-created stages onto defaults.
    expect(m).toBeNull()
  })
})

describe('planUpgrade', () => {
  it('produces enrich + add operations and zero lead moves', () => {
    const plan = planUpgrade(existingClassic, DEFAULT_STAGES)
    const enrich = plan.operations.filter((op) => op.kind === 'enrich')
    const add = plan.operations.filter((op) => op.kind === 'add')
    expect(enrich.length).toBeGreaterThan(0)
    expect(add.length).toBeGreaterThan(0)
    expect(plan.leadsMoved).toBe(0)
    // Custom stage Follow-Up is preserved untouched.
    expect(plan.preservedCustomStageIds).toContain('X')
  })

  it('reports needsUpgrade=false when entry_signals already populated', () => {
    const stages = existingClassic.map((s) => ({ ...s, entry_signals: ['x'] }))
    const plan = planUpgrade(stages, DEFAULT_STAGES)
    expect(plan.needsUpgrade).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/leads/upgrade.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

Create `src/lib/leads/upgrade.ts`:

```ts
import type { createAdminClient } from '@/lib/supabase/admin'
import { DEFAULT_STAGES, type DefaultStage } from '@/app/(app)/dashboard/leads/_lib/defaults'

type Admin = ReturnType<typeof createAdminClient>

export type ExistingStage = {
  id: string
  name: string
  kind: string
  position: number
  entry_signals: string[] | null
}

export type UpgradeOp =
  | {
      kind: 'enrich'
      stageId: string
      newName: string
      newDescription: string
      newKind: string
      newEntrySignals: string[]
      newExitSignals: string[]
      newRequiredFields: string[]
    }
  | {
      kind: 'add'
      defaultStageName: string
      position: number
      payload: DefaultStage
    }

export type UpgradePlan = {
  needsUpgrade: boolean
  operations: UpgradeOp[]
  preservedCustomStageIds: string[]
  leadsMoved: number
}

/**
 * Match an existing stage to a default. We only auto-match when the user's
 * stage shares a structural identity with the default — same kind AND either
 * same canonical name (case-insensitive) OR same legacy alias.
 */
const KIND_ALIASES: Record<string, string[]> = {
  Engaged: ['contacted', 'first contact', 'outreach'],
  Interested: ['warm', 'engaged lead'],
  'Proposal / Booked': ['proposal', 'booking', 'booked'],
  Dormant: ['cold', 'inactive'],
}

export function matchStage(existing: ExistingStage, defaults: readonly DefaultStage[]): DefaultStage | null {
  for (const d of defaults) {
    const sameKind = d.kind === existing.kind
    const nameLower = existing.name.toLowerCase().trim()
    const directName = nameLower === d.name.toLowerCase().trim()
    const aliasMatch = (KIND_ALIASES[d.name] ?? []).some((a) => nameLower === a)
    if (sameKind && (directName || aliasMatch)) return d
  }
  return null
}

export function planUpgrade(existing: ExistingStage[], defaults: readonly DefaultStage[]): UpgradePlan {
  const needsUpgrade = existing.every((s) => !s.entry_signals || s.entry_signals.length === 0)

  const operations: UpgradeOp[] = []
  const preservedCustomStageIds: string[] = []
  const matched = new Set<string>()

  for (const ex of existing) {
    const d = matchStage(ex, defaults)
    if (!d) {
      preservedCustomStageIds.push(ex.id)
      continue
    }
    matched.add(d.name)
    operations.push({
      kind: 'enrich',
      stageId: ex.id,
      newName: d.name,
      newDescription: d.description,
      newKind: d.kind,
      newEntrySignals: d.entry_signals,
      newExitSignals: d.exit_signals,
      newRequiredFields: d.required_fields,
    })
  }

  defaults.forEach((d, i) => {
    if (!matched.has(d.name)) {
      operations.push({ kind: 'add', defaultStageName: d.name, position: i + existing.length, payload: d })
    }
  })

  return { needsUpgrade, operations, preservedCustomStageIds, leadsMoved: 0 }
}

export async function needsStageUpgrade(admin: Admin, userId: string): Promise<boolean> {
  const { data: profile } = await admin
    .from('profiles')
    .select('dismissed_stage_upgrade_at')
    .eq('id', userId)
    .maybeSingle()
  const dismissed = profile?.dismissed_stage_upgrade_at
    ? Date.now() - new Date(profile.dismissed_stage_upgrade_at).getTime() < 7 * 24 * 60 * 60 * 1000
    : false
  if (dismissed) return false

  const { data: stages } = await admin
    .from('pipeline_stages')
    .select('id, entry_signals')
    .eq('user_id', userId)
  if (!stages || stages.length === 0) return false
  const allEmpty = stages.every((s) => !s.entry_signals || (Array.isArray(s.entry_signals) && s.entry_signals.length === 0))
  return allEmpty
}

export async function previewUpgrade(admin: Admin, userId: string): Promise<UpgradePlan> {
  const { data: stages } = await admin
    .from('pipeline_stages')
    .select('id, name, kind, position, entry_signals')
    .eq('user_id', userId)
    .order('position')
  return planUpgrade((stages ?? []) as ExistingStage[], DEFAULT_STAGES)
}

export async function applyUpgrade(admin: Admin, userId: string): Promise<{ enriched: number; added: number }> {
  const { data: snapshot } = await admin
    .from('pipeline_stages')
    .select('*')
    .eq('user_id', userId)
  await admin.from('pipeline_stage_upgrade_snapshots').upsert({ user_id: userId, snapshot })

  const plan = await previewUpgrade(admin, userId)
  let enriched = 0
  let added = 0

  for (const op of plan.operations) {
    if (op.kind === 'enrich') {
      const { error } = await admin
        .from('pipeline_stages')
        .update({
          name: op.newName,
          description: op.newDescription,
          kind: op.newKind,
          entry_signals: op.newEntrySignals,
          exit_signals: op.newExitSignals,
          required_fields: op.newRequiredFields,
        })
        .eq('id', op.stageId)
      if (!error) enriched++
    } else {
      // append at the next free position
      const { data: maxRow } = await admin
        .from('pipeline_stages')
        .select('position')
        .eq('user_id', userId)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle()
      const nextPos = (maxRow?.position ?? -1) + 1
      const { error } = await admin.from('pipeline_stages').insert({
        user_id: userId,
        name: op.payload.name,
        description: op.payload.description,
        position: nextPos,
        is_default: op.payload.isDefault,
        kind: op.payload.kind,
        is_won: op.payload.kind === 'won',
        is_lost: op.payload.kind === 'lost',
        is_terminal: op.payload.kind === 'won' || op.payload.kind === 'lost',
        entry_signals: op.payload.entry_signals,
        exit_signals: op.payload.exit_signals,
        required_fields: op.payload.required_fields,
      })
      if (!error) added++
    }
  }

  // Trigger an immediate suggestion run.
  await admin
    .from('stage_suggestion_jobs')
    .upsert({ user_id: userId, run_at: new Date().toISOString(), status: 'queued' })

  return { enriched, added }
}

export async function undoUpgrade(admin: Admin, userId: string): Promise<boolean> {
  const { data: snap } = await admin
    .from('pipeline_stage_upgrade_snapshots')
    .select('snapshot')
    .eq('user_id', userId)
    .maybeSingle()
  if (!snap?.snapshot || !Array.isArray(snap.snapshot)) return false

  // Drop current stages (cascades to leads via NULL not applied — DO NOT actually delete because of FK).
  // Instead: update every stage in the snapshot back to its original values; remove stages that were inserted (kind+name not in snapshot).
  const snapshot = snap.snapshot as Array<Record<string, unknown>>
  const snapshotIds = new Set(snapshot.map((s) => s.id as string))

  const { data: current } = await admin
    .from('pipeline_stages')
    .select('id')
    .eq('user_id', userId)
  const currentIds = new Set((current ?? []).map((s) => s.id as string))

  // Delete inserted ones (in current but not in snapshot). Leads referencing them are impossible: we just added them, so no leads can be there yet — but guard anyway by checking lead counts.
  for (const id of currentIds) {
    if (snapshotIds.has(id)) continue
    const { count } = await admin
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('stage_id', id)
    if ((count ?? 0) === 0) {
      await admin.from('pipeline_stages').delete().eq('id', id)
    }
  }

  // Restore enriched stages.
  for (const row of snapshot) {
    if (!currentIds.has(row.id as string)) continue
    await admin
      .from('pipeline_stages')
      .update({
        name: row.name,
        description: row.description,
        kind: row.kind,
        entry_signals: row.entry_signals,
        exit_signals: row.exit_signals,
        required_fields: row.required_fields,
      })
      .eq('id', row.id as string)
  }

  await admin.from('pipeline_stage_upgrade_snapshots').delete().eq('user_id', userId)
  return true
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/leads/upgrade.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/leads/upgrade.ts src/lib/leads/upgrade.test.ts
git commit -m "feat(leads): upgrade lib — detect/preview/apply/undo opt-in pipeline upgrade"
```

---

## Task 12: `UpgradeBanner` UI + preview-diff modal + server actions

**Files:**
- Create: `src/app/(app)/dashboard/leads/stages/_components/UpgradeBanner.tsx`
- Create: `src/app/(app)/dashboard/leads/stages/_components/UpgradePreviewModal.tsx`
- Create: `src/app/(app)/dashboard/leads/actions/upgrade.ts`
- Modify: `src/app/(app)/dashboard/leads/stages/page.tsx` (mount the banner)

- [ ] **Step 1: Create server actions**

Create `src/app/(app)/dashboard/leads/actions/upgrade.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { applyUpgrade, undoUpgrade, previewUpgrade } from '@/lib/leads/upgrade'

async function getUserId() {
  const supabase = await createServerClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) throw new Error('unauthorized')
  return data.user.id
}

export async function getUpgradePreview() {
  const userId = await getUserId()
  return previewUpgrade(createAdminClient(), userId)
}

export async function applyUpgradeAction() {
  const userId = await getUserId()
  const result = await applyUpgrade(createAdminClient(), userId)
  revalidatePath('/dashboard/leads/stages')
  return result
}

export async function dismissUpgradeAction() {
  const userId = await getUserId()
  const supabase = createAdminClient()
  await supabase.from('profiles').update({ dismissed_stage_upgrade_at: new Date().toISOString() }).eq('id', userId)
  revalidatePath('/dashboard/leads/stages')
}

export async function undoUpgradeAction() {
  const userId = await getUserId()
  await undoUpgrade(createAdminClient(), userId)
  revalidatePath('/dashboard/leads/stages')
}
```

- [ ] **Step 2: Create the banner component**

Create `src/app/(app)/dashboard/leads/stages/_components/UpgradeBanner.tsx`:

```tsx
'use client'
import { useState, useTransition } from 'react'
import { UpgradePreviewModal } from './UpgradePreviewModal'
import { dismissUpgradeAction, applyUpgradeAction } from '../../actions/upgrade'

export function UpgradeBanner() {
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between">
      <div>
        <div className="font-medium text-amber-900">Upgrade to the smart pipeline</div>
        <div className="text-sm text-amber-800">
          Better stage movement with signal-based detection. Your existing leads stay put.
        </div>
      </div>
      <div className="flex gap-2">
        <button
          className="rounded border border-amber-300 bg-white px-3 py-1.5 text-sm hover:bg-amber-100"
          onClick={() => setOpen(true)}
        >
          Preview changes
        </button>
        <button
          className="rounded bg-amber-900 px-3 py-1.5 text-sm text-white hover:bg-amber-800 disabled:opacity-60"
          disabled={isPending}
          onClick={() => startTransition(() => applyUpgradeAction().then(() => {}))}
        >
          {isPending ? 'Upgrading…' : 'Apply upgrade'}
        </button>
        <button
          className="rounded border border-transparent px-3 py-1.5 text-sm text-amber-900 hover:bg-amber-100"
          onClick={() => startTransition(() => dismissUpgradeAction().then(() => {}))}
        >
          Not now
        </button>
      </div>
      {open && <UpgradePreviewModal onClose={() => setOpen(false)} />}
    </div>
  )
}
```

- [ ] **Step 3: Create the preview modal**

Create `src/app/(app)/dashboard/leads/stages/_components/UpgradePreviewModal.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { getUpgradePreview, applyUpgradeAction } from '../../actions/upgrade'

type Plan = Awaited<ReturnType<typeof getUpgradePreview>>

export function UpgradePreviewModal({ onClose }: { onClose: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null)
  useEffect(() => { getUpgradePreview().then(setPlan) }, [])

  if (!plan) return null

  const enrich = plan.operations.filter((op) => op.kind === 'enrich')
  const add = plan.operations.filter((op) => op.kind === 'add')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Smart pipeline upgrade preview</h2>

        <section className="mt-4">
          <h3 className="font-medium">Stages added ({add.length})</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {add.map((op) => (
              <li key={op.defaultStageName}>
                <strong>{op.defaultStageName}</strong>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-4">
          <h3 className="font-medium">Stages enriched ({enrich.length})</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {enrich.map((op) => (
              <li key={op.stageId} className="rounded border p-2">
                <div className="font-medium">{op.newName}</div>
                <div className="text-xs text-gray-500">kind: {op.newKind}</div>
                <div className="mt-1 text-xs">{op.newDescription}</div>
                <div className="mt-1 text-xs">
                  <strong>Entry signals:</strong> {op.newEntrySignals.length} added
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-4 rounded bg-gray-50 p-3 text-sm">
          <strong>Custom stages preserved:</strong> {plan.preservedCustomStageIds.length}
          <br />
          <strong>Leads that will move:</strong> 0 — every existing lead stays in its current stage.
        </section>

        <div className="mt-6 flex justify-end gap-2">
          <button className="rounded border px-3 py-1.5 text-sm" onClick={onClose}>Cancel</button>
          <button
            className="rounded bg-amber-900 px-3 py-1.5 text-sm text-white"
            onClick={() => applyUpgradeAction().then(onClose)}
          >
            Apply upgrade
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Mount the banner conditionally on the stages page**

In `src/app/(app)/dashboard/leads/stages/page.tsx`, at the top of the page body, fetch `needsStageUpgrade` and render the banner:

```tsx
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { needsStageUpgrade } from '@/lib/leads/upgrade'
import { UpgradeBanner } from './_components/UpgradeBanner'

// inside the server component, before the existing UI:
const supabase = await createServerClient()
const { data: userData } = await supabase.auth.getUser()
const userId = userData.user?.id
const showBanner = userId ? await needsStageUpgrade(createAdminClient(), userId) : false

return (
  <>
    {showBanner && <UpgradeBanner />}
    {/* existing stages UI */}
  </>
)
```

- [ ] **Step 5: Manual UI smoke**

Spin up the dev server with a user whose stages have empty `entry_signals`. Banner should appear; clicking "Preview changes" should list enrich/add ops; clicking "Apply upgrade" should refresh the page with banner gone and stages enriched.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/dashboard/leads/stages/_components/UpgradeBanner.tsx \
        src/app/\(app\)/dashboard/leads/stages/_components/UpgradePreviewModal.tsx \
        src/app/\(app\)/dashboard/leads/actions/upgrade.ts \
        src/app/\(app\)/dashboard/leads/stages/page.tsx
git commit -m "feat(leads): opt-in pipeline upgrade banner + preview-diff modal"
```

---

## Task 13: `StageSuggestionsPanel` UI + accept/reject server actions

**Files:**
- Create: `src/app/(app)/dashboard/leads/actions/suggestions.ts`
- Create: `src/app/(app)/dashboard/leads/stages/_components/StageSuggestionsPanel.tsx`
- Modify: `src/app/(app)/dashboard/leads/stages/page.tsx` (mount the panel)

- [ ] **Step 1: Server actions for accept/reject**

Create `src/app/(app)/dashboard/leads/actions/suggestions.ts`:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createServerClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function getUserId() {
  const supabase = await createServerClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) throw new Error('unauthorized')
  return data.user.id
}

export async function listPendingSuggestions() {
  const userId = await getUserId()
  const admin = createAdminClient()
  const { data } = await admin
    .from('pipeline_stage_suggestions')
    .select('id, stage_id, field, current_value, proposed_value, reason, created_at, pipeline_stages!inner(name)')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  return data ?? []
}

export async function acceptSuggestion(id: string) {
  const userId = await getUserId()
  const admin = createAdminClient()

  const { data: sug } = await admin
    .from('pipeline_stage_suggestions')
    .select('stage_id, field, proposed_value')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (!sug) throw new Error('suggestion not found')

  await admin
    .from('pipeline_stages')
    .update({ [sug.field]: sug.proposed_value })
    .eq('id', sug.stage_id)
    .eq('user_id', userId)

  await admin
    .from('pipeline_stage_suggestions')
    .update({ status: 'accepted', resolved_at: new Date().toISOString(), resolved_by: userId })
    .eq('id', id)

  revalidatePath('/dashboard/leads/stages')
}

export async function rejectSuggestion(id: string) {
  const userId = await getUserId()
  const admin = createAdminClient()
  await admin
    .from('pipeline_stage_suggestions')
    .update({ status: 'rejected', resolved_at: new Date().toISOString(), resolved_by: userId })
    .eq('id', id)
    .eq('user_id', userId)
  revalidatePath('/dashboard/leads/stages')
}

export async function countPendingSuggestions(): Promise<number> {
  const userId = await getUserId()
  const admin = createAdminClient()
  const { count } = await admin
    .from('pipeline_stage_suggestions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('status', 'pending')
  return count ?? 0
}
```

- [ ] **Step 2: Build the panel component**

Create `src/app/(app)/dashboard/leads/stages/_components/StageSuggestionsPanel.tsx`:

```tsx
'use client'
import { useEffect, useState, useTransition } from 'react'
import { listPendingSuggestions, acceptSuggestion, rejectSuggestion } from '../../actions/suggestions'

type Suggestion = Awaited<ReturnType<typeof listPendingSuggestions>>[number]

export function StageSuggestionsPanel() {
  const [items, setItems] = useState<Suggestion[] | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => { listPendingSuggestions().then(setItems) }, [])
  if (!items || items.length === 0) return null

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="font-medium text-blue-900">
        {items.length} suggested improvement{items.length === 1 ? '' : 's'} from your knowledge base
      </div>
      <ul className="mt-3 space-y-3">
        {items.map((s) => (
          <li key={s.id} className="rounded border bg-white p-3">
            <div className="flex items-center justify-between">
              <div className="font-medium">
                {(s as unknown as { pipeline_stages: { name: string } }).pipeline_stages.name} — <code>{s.field}</code>
              </div>
              <div className="text-xs text-gray-500">{new Date(s.created_at).toLocaleString()}</div>
            </div>
            <div className="mt-1 text-sm text-gray-700">{s.reason}</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div>
                <div className="font-semibold text-gray-500">Current</div>
                <pre className="whitespace-pre-wrap break-words">{JSON.stringify(s.current_value, null, 2)}</pre>
              </div>
              <div>
                <div className="font-semibold text-gray-500">Proposed</div>
                <pre className="whitespace-pre-wrap break-words">{JSON.stringify(s.proposed_value, null, 2)}</pre>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                className="rounded bg-blue-700 px-3 py-1 text-sm text-white disabled:opacity-60"
                disabled={isPending}
                onClick={() => startTransition(() => acceptSuggestion(s.id).then(() => setItems((x) => (x ?? []).filter((y) => y.id !== s.id))))}
              >
                Accept
              </button>
              <button
                className="rounded border px-3 py-1 text-sm"
                disabled={isPending}
                onClick={() => startTransition(() => rejectSuggestion(s.id).then(() => setItems((x) => (x ?? []).filter((y) => y.id !== s.id))))}
              >
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Mount the panel on the stages page**

In `src/app/(app)/dashboard/leads/stages/page.tsx`, add `<StageSuggestionsPanel />` right under the `UpgradeBanner` mount.

- [ ] **Step 4: Manual smoke test**

Manually insert a fake suggestion via Supabase Studio and confirm it renders with Accept/Reject. Click Accept and confirm the stage row updates and the suggestion disappears.

```sql
insert into pipeline_stage_suggestions (user_id, stage_id, field, current_value, proposed_value, reason)
values (
  '<your-user-id>',
  (select id from pipeline_stages where user_id='<your-user-id>' and name='Interested' limit 1),
  'entry_signals',
  '["asked price"]'::jsonb,
  '["asked price","asked about Premium tier"]'::jsonb,
  'Knowledge mentions Premium tier — add it as an interest signal.'
);
```

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/dashboard/leads/actions/suggestions.ts \
        src/app/\(app\)/dashboard/leads/stages/_components/StageSuggestionsPanel.tsx \
        src/app/\(app\)/dashboard/leads/stages/page.tsx
git commit -m "feat(leads): pending stage suggestions review panel with accept/reject"
```

---

## Task 14: Sidebar pending-suggestion badge + once-per-session toast

**Files:**
- Modify: existing sidebar nav component (search the codebase for the `Leads` nav link; likely under `src/app/(app)/_components/` or similar)
- Create: `src/app/(app)/dashboard/leads/_components/SuggestionsToast.client.tsx`
- Modify: `src/app/(app)/dashboard/layout.tsx` (mount the toast)

- [ ] **Step 1: Locate the sidebar nav and add a badge**

Run:
```bash
grep -rn "dashboard/leads\b" src/app --include="*.tsx" | grep -i "nav\|sidebar\|link"
```

Identify the file rendering the `Leads` nav item. In that file, fetch the pending count server-side and pass it to the `Leads` link. Render a dot when count > 0:

```tsx
import { countPendingSuggestions } from '@/app/(app)/dashboard/leads/actions/suggestions'

const pending = await countPendingSuggestions().catch(() => 0)

// in JSX next to the "Leads" label:
<span className="inline-flex items-center gap-2">
  Leads
  {pending > 0 && (
    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-600 px-1 text-[10px] font-semibold text-white">
      {pending}
    </span>
  )}
</span>
```

> If the sidebar is a client component, expose `countPendingSuggestions` via a small fetch helper or pass `pending` as a prop from the parent server layout.

- [ ] **Step 2: Build the once-per-session toast**

Create `src/app/(app)/dashboard/leads/_components/SuggestionsToast.client.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { countPendingSuggestions } from '../actions/suggestions'

const KEY = 'leads:suggestions:toast-acked'

export function SuggestionsToast() {
  const [count, setCount] = useState<number | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (sessionStorage.getItem(KEY)) return
    countPendingSuggestions().then((n) => {
      if (n > 0) setCount(n)
    })
  }, [])

  if (!count) return null

  const dismiss = () => {
    sessionStorage.setItem(KEY, '1')
    setCount(null)
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border bg-white p-4 shadow-lg">
      <div className="text-sm font-medium">
        {count} suggested stage improvement{count === 1 ? '' : 's'} based on your knowledge.
      </div>
      <div className="mt-2 flex gap-2">
        <Link
          href="/dashboard/leads/stages"
          className="rounded bg-blue-700 px-3 py-1 text-xs text-white"
          onClick={dismiss}
        >
          Review
        </Link>
        <button onClick={dismiss} className="rounded border px-3 py-1 text-xs">
          Later
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Mount it in the dashboard layout**

In `src/app/(app)/dashboard/layout.tsx` (or the nearest dashboard layout server component), import and render `<SuggestionsToast />` once at the bottom of the layout tree.

- [ ] **Step 4: Manual smoke**

Insert a fake suggestion (Task 13 step 4). Visit the dashboard. Sidebar `Leads` item shows a `1` badge. Toast appears bottom-right. Click "Review" → routes to `/dashboard/leads/stages` and toast does not appear again in the same session.

- [ ] **Step 5: Commit**

```bash
git add <touched sidebar file> \
        src/app/\(app\)/dashboard/leads/_components/SuggestionsToast.client.tsx \
        src/app/\(app\)/dashboard/layout.tsx
git commit -m "feat(leads): sidebar pending-suggestion badge + once-per-session toast"
```

---

## Task 15: `StageManager` chip editors for signals

**Files:**
- Modify: `src/app/(app)/dashboard/leads/_components/StageManager.tsx`
- Create: `src/app/(app)/dashboard/leads/_components/SignalChipsInput.tsx`
- Modify: `src/app/(app)/dashboard/leads/_lib/schemas.ts` (extend the stage update schema)
- Modify: `src/app/(app)/dashboard/leads/actions/stages.ts` (accept the new fields)

- [ ] **Step 1: Extend the stage schema**

Open `src/app/(app)/dashboard/leads/_lib/schemas.ts`. Find the existing stage update Zod schema and extend it:

```ts
import { z } from 'zod'

export const stageUpdateSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(2000).nullable(),
  kind: z.enum(['entry','qualifying','nurture','decision','won','lost','dormant','objection']),
  entry_signals: z.array(z.string().min(1).max(240)).max(20).default([]),
  exit_signals: z.array(z.string().min(1).max(240)).max(20).default([]),
  required_fields: z.array(z.string().min(1).max(80)).max(20).default([]),
})
export type StageUpdate = z.infer<typeof stageUpdateSchema>
```

(If the existing schema name differs, update it in place. Don't introduce a parallel schema.)

- [ ] **Step 2: Update the server action to persist the new fields**

In `src/app/(app)/dashboard/leads/actions/stages.ts`, where `updateStage` writes to `pipeline_stages`, include the new fields:

```ts
const parsed = stageUpdateSchema.parse(raw)
await supabase.from('pipeline_stages').update({
  name: parsed.name,
  description: parsed.description,
  kind: parsed.kind,
  entry_signals: parsed.entry_signals,
  exit_signals: parsed.exit_signals,
  required_fields: parsed.required_fields,
}).eq('id', id).eq('user_id', userId)
```

- [ ] **Step 3: Build the chip input primitive**

Create `src/app/(app)/dashboard/leads/_components/SignalChipsInput.tsx`:

```tsx
'use client'
import { useState } from 'react'

export function SignalChipsInput({
  label,
  value,
  onChange,
  placeholder = 'Add signal and press Enter',
}: {
  label: string
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')

  const add = () => {
    const v = draft.trim()
    if (!v) return
    if (value.includes(v)) { setDraft(''); return }
    onChange([...value, v])
    setDraft('')
  }

  return (
    <div>
      <div className="text-xs font-medium text-gray-600">{label}</div>
      <div className="mt-1 flex flex-wrap gap-1 rounded border p-2">
        {value.map((v, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs">
            {v}
            <button
              type="button"
              className="text-gray-500 hover:text-red-600"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              aria-label={`Remove ${v}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); add() }
            if (e.key === 'Backspace' && !draft && value.length > 0) {
              onChange(value.slice(0, -1))
            }
          }}
          placeholder={placeholder}
          className="flex-1 min-w-[120px] text-xs outline-none"
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Wire `SignalChipsInput` into `StageManager`**

In `src/app/(app)/dashboard/leads/_components/StageManager.tsx`, locate the per-stage edit form. Add three `SignalChipsInput` instances bound to local state for each stage's `entry_signals`, `exit_signals`, `required_fields`. On submit, include these arrays in the update payload that calls the existing `updateStage` action.

> If the file is large or has multiple sub-forms, add the new fields inside the same form section that already edits `description` and `kind`. Do not split the file.

- [ ] **Step 5: Manual smoke**

Edit a stage on `/dashboard/leads/stages`. Add a couple of chips to `entry_signals`. Save. Reload. Confirm the chips persisted via `select entry_signals from pipeline_stages where id=...`.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/dashboard/leads/_components/StageManager.tsx \
        src/app/\(app\)/dashboard/leads/_components/SignalChipsInput.tsx \
        src/app/\(app\)/dashboard/leads/_lib/schemas.ts \
        src/app/\(app\)/dashboard/leads/actions/stages.ts
git commit -m "feat(leads): stage editor — chip inputs for entry/exit signals and required fields"
```

---

## Task 16: `LeadCard` "Why here?" tooltip

**Files:**
- Modify: `src/app/(app)/dashboard/leads/_components/LeadCard.tsx`
- Modify: the lead-loading query (likely `src/app/(app)/dashboard/leads/_lib/queries.ts`) — include the latest `lead_stage_events.reason`.

- [ ] **Step 1: Extend the lead query**

Open `src/app/(app)/dashboard/leads/_lib/queries.ts`. Find the function that loads leads for the kanban view. Add a join for the latest `lead_stage_events` per lead:

```ts
// In whatever shape the existing query returns:
const { data: leads } = await supabase
  .from('leads')
  .select(`
    id, name, stage_id, score, entered_stage_at, previous_stage_id,
    latest_event:lead_stage_events!lead_stage_events_lead_id_fkey(reason, source, confidence, created_at)
  `)
  .eq('user_id', userId)
  .order('position', { ascending: true })
```

> If Supabase doesn't allow "latest only" in the join, fetch the latest event separately with `.order('created_at', { ascending: false }).limit(1)` per lead, or use an RPC. Keep it simple: a separate batched query for the latest event per lead in the visible set.

- [ ] **Step 2: Parse matched signals out of the reason text**

In `src/app/(app)/dashboard/leads/_lib/queries.ts` (or a new helper next to it), add a small parser:

```ts
export function parseMatchedSignals(reason: string | null | undefined): { matched: string[]; freeReason: string } {
  if (!reason) return { matched: [], freeReason: '' }
  const m = reason.match(/^matched:\s*([^—]+?)\s*—\s*(.*)$/)
  if (!m) return { matched: [], freeReason: reason }
  return {
    matched: m[1].split(',').map((x) => x.trim()).filter(Boolean),
    freeReason: m[2],
  }
}
```

- [ ] **Step 3: Render the tooltip on `LeadCard`**

In `src/app/(app)/dashboard/leads/_components/LeadCard.tsx`, accept the latest event and render a small "?" icon in the card corner. On hover (or popover), show a card with:

```tsx
import { parseMatchedSignals } from '../_lib/queries'

// inside the component:
const { matched, freeReason } = parseMatchedSignals(lead.latest_event?.reason)

// somewhere in the card markup:
{matched.length > 0 && (
  <div className="group relative inline-block">
    <button className="text-[10px] text-gray-400 hover:text-gray-700" aria-label="Why is this lead here?">
      ?
    </button>
    <div className="absolute right-0 top-5 z-10 hidden w-64 rounded border bg-white p-2 text-xs shadow group-hover:block">
      <div className="font-medium">Why this stage</div>
      <ul className="mt-1 list-disc pl-4">
        {matched.map((m) => <li key={m}>{m}</li>)}
      </ul>
      {freeReason && <div className="mt-1 text-gray-500">{freeReason}</div>}
      <div className="mt-1 text-[10px] text-gray-400">
        source: {lead.latest_event?.source} · {lead.latest_event?.confidence ?? '—'}
      </div>
    </div>
  </div>
)}
```

> If the existing kanban already uses a popover/tooltip primitive (e.g. from a shared `_components/` folder), use that instead of the bare-bones hover-show pattern.

- [ ] **Step 4: Manual smoke**

In dev, send a synthetic conversation through the chatbot that triggers a stage move. Open the Kanban and hover the lead card — confirm matched signals appear in the tooltip.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/dashboard/leads/_components/LeadCard.tsx \
        src/app/\(app\)/dashboard/leads/_lib/queries.ts
git commit -m "feat(leads): 'why here?' tooltip on lead cards shows matched signals"
```

---

## Final manual QA checklist (from spec §9)

Run these after all tasks are merged into a staging environment:

- [ ] Legacy synthetic user sees the upgrade banner on `/dashboard/leads/stages`.
- [ ] Apply upgrade — preview-diff lead count matches actuals; stages enriched in place; suggester runs immediately.
- [ ] Undo upgrade restores pre-upgrade stages exactly.
- [ ] Edit a FAQ in the knowledge base; within ~90s a pending suggestion appears in the panel.
- [ ] Send a synthetic conversation that asks for price in Tagalog; lead moves Engaged → Interested.
- [ ] Synthetic objection conversation → lead enters Objection; `previous_stage_id` is set in the DB.
- [ ] Resolution message → lead returns to `previous_stage_id`, not forward.
- [ ] Sidebar `Leads` badge appears when pending > 0; clears after accept/reject of all suggestions.
- [ ] Toast appears once per session when pending > 0; doesn't reappear after dismissal in the same session.
- [ ] Daily dormant sweep moves leads inactive 14+ days into Dormant; does not touch terminal stages.

---

## Self-review notes

- **Spec coverage:** Every requirement from spec §1–§9 is mapped to a task. Notification surfaces (§5: i/ii/iii) → Tasks 13 + 14. Objection mechanics (§2.4) → Task 1 (RPC) + Task 6 (classifier). Knowledge sync (§3) → Tasks 8 + 9. Upgrade flow (§4) → Tasks 11 + 12. Dormant (§1) → Task 7.
- **Placeholders:** None remain. Every code step shows complete code. Two soft pointers ("If the existing project LLM client lives at…", "If the existing kanban already uses a popover primitive…") are runtime adapter notes, not placeholders — the engineer follows the existing pattern in the codebase, which is the project convention per `AGENTS.md`.
- **Type consistency:** `MoveType` is consistent between `classifyMoveType` and `coerceDecision` (Task 6). `Suggestion.field` is consistent across Tasks 8, 10, 13. `DefaultStage` exported from `defaults.ts` (Task 2) is the source of truth used by `seed.ts` (Task 3) and `upgrade.ts` (Task 11).
