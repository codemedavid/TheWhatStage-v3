# Lead Silent Auto Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically nudge a Messenger lead who has gone silent with a fixed 7-step time-decaying schedule (5m, 1h, 5h, 8h, 12h, 18h, 24h after the lead's last inbound), gated on `lifetime lead inbound < 15` and `no completed page action`. Any new lead inbound cancels the schedule and reseeds.

**Architecture:**
- New table `lead_followup_schedules` holds per-thread schedule state.
- Inbound webhook (in `messenger/process` route) cancels any active schedule and (if gates pass) seeds a fresh one.
- A new cron tick `/api/cron/followups-tick` (every minute) finds due schedules and enqueues `messenger_jobs` rows with `kind='followup_send'` — reusing the existing per-thread-serialized worker.
- A new handler `handleFollowupSend` in `messenger/process` generates the message (LLM + fallback), sanitizes (no dashes, one line), sends via `sendOutbound`, and advances the schedule.

**Tech Stack:** Next.js App Router · TypeScript · Supabase Postgres + pg_cron · Vitest · `HfRouterLlm` · `sendOutbound`.

**Related spec:** `docs/superpowers/specs/2026-05-17-lead-silent-followup-design.md`

---

## File Structure

**New:**
- `supabase/migrations/20260601000000_lead_followup_schedules.sql` — table, indexes, RLS, `messenger_jobs.kind` extend, cron schedule.
- `src/lib/followups/config.ts` — constants (offsets, thresholds, statuses).
- `src/lib/followups/sanitize.ts` — pure: strip dashes, force one-line, length cap.
- `src/lib/followups/sanitize.test.ts`
- `src/lib/followups/gates.ts` — `countLeadInbound`, `hasCompletedPageAction`, `shouldSeed`.
- `src/lib/followups/gates.test.ts`
- `src/lib/followups/generateMessage.ts` — LLM call + per-offset fallback pool.
- `src/lib/followups/generateMessage.test.ts`
- `src/lib/followups/seed.ts` — `maybeScheduleFollowup`, `cancelActiveFollowup`.
- `src/lib/followups/seed.test.ts`
- `src/lib/followups/fire.ts` — `handleFollowupSend`, `advanceSchedule`.
- `src/lib/followups/fire.test.ts`
- `src/app/api/cron/followups-tick/route.ts` — every-minute enqueuer.
- `src/app/api/cron/followups-tick/route.test.ts`

**Modified:**
- `src/app/api/messenger/process/route.ts` — call `maybeScheduleFollowup` after committing inbound; add `kind='followup_send'` dispatch branch in `runJob`.
- `.env.example` — no new secrets (reuses `CRON_SECRET` + `MESSENGER_WORKER_SECRET`).

---

## Task 1: Migration — `lead_followup_schedules` table, RLS, cron

**Files:**
- Create: `supabase/migrations/20260601000000_lead_followup_schedules.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =========================================================================
-- Lead Silent Auto Follow-Up: per-thread schedule of timed nudges fired after
-- a lead goes silent. Cancelled on any new lead inbound; reseeded if gates
-- still pass. Touchpoints at 5m, 1h, 5h, 8h, 12h, 18h, 24h after last inbound.
-- =========================================================================

-- 1. Extend messenger_jobs.kind enum check to include followup_send.
alter table public.messenger_jobs
  drop constraint if exists messenger_jobs_kind_check;

alter table public.messenger_jobs
  add constraint messenger_jobs_kind_check
  check (kind in ('inbound_reply', 'agent_campaign_send', 'reminder_fire', 'followup_send'));

-- 2. lead_followup_schedules — one active row per thread at a time.
create table public.lead_followup_schedules (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id)              on delete cascade,
  lead_id      uuid not null references public.leads(id)            on delete cascade,
  thread_id    uuid not null references public.messenger_threads(id) on delete cascade,
  page_id      uuid not null references public.facebook_pages(id)   on delete cascade,

  started_at   timestamptz not null,
  next_offset_idx smallint not null default 0
    check (next_offset_idx between 0 and 6),
  next_run_at  timestamptz not null,

  status text not null default 'pending'
    check (status in ('pending','running','done','cancelled','failed')),

  conversation_kind text not null
    check (conversation_kind in ('generic','real')),

  lead_inbound_count_at_seed smallint not null default 0,
  job_id     uuid references public.messenger_jobs(id) on delete set null,
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One active schedule per thread.
create unique index uniq_active_followup_per_thread
  on public.lead_followup_schedules (thread_id)
  where status in ('pending','running');

-- Worker claim path.
create index idx_followup_due
  on public.lead_followup_schedules (next_run_at)
  where status = 'pending';

-- Lookup by user (for dashboards / debugging).
create index idx_followup_user
  on public.lead_followup_schedules (user_id, status, next_run_at desc);

alter table public.lead_followup_schedules enable row level security;

create policy "lead_followup_schedules_owner_rw" on public.lead_followup_schedules
  for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- updated_at trigger
create or replace function public.touch_lead_followup_schedules_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger lead_followup_schedules_touch_updated_at
  before update on public.lead_followup_schedules
  for each row execute function public.touch_lead_followup_schedules_updated_at();

-- 3. Schedule the followups-tick cron (every minute).
do $$
declare
  job_id bigint;
begin
  for job_id in
    select jobid from cron.job where jobname = 'whatstage-followups-tick'
  loop
    perform cron.unschedule(job_id);
  end loop;
end $$;

select cron.schedule(
  'whatstage-followups-tick',
  '* * * * *',
  $$select app_private.invoke_cron_route('/api/cron/followups-tick', 10000);$$
);
```

- [ ] **Step 2: Apply the migration locally**

Run: `npx supabase db reset` (or `supabase db push` if reset is too destructive in your env).
Expected: migration applies cleanly; `\d public.lead_followup_schedules` shows the table.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260601000000_lead_followup_schedules.sql
git commit -m "feat(followups): add lead_followup_schedules table + cron"
```

---

## Task 2: Constants module

**Files:**
- Create: `src/lib/followups/config.ts`

- [ ] **Step 1: Write the constants module**

```ts
// src/lib/followups/config.ts
//
// Single source of truth for the auto-followup schedule. If you change
// OFFSETS_MS, also update FALLBACK_POOL in generateMessage.ts to keep the
// pool length in sync.

export const OFFSETS_MS = [
  5 * 60_000,        // 5 minutes
  60 * 60_000,       // 1 hour
  5 * 3600_000,      // 5 hours
  8 * 3600_000,      // 8 hours
  12 * 3600_000,     // 12 hours
  18 * 3600_000,     // 18 hours
  24 * 3600_000,     // 24 hours
] as const

export const MAX_OFFSET_IDX = OFFSETS_MS.length - 1

export const REAL_CONVERSATION_LEAD_MSG_THRESHOLD = 4
export const MAX_LIFETIME_LEAD_INBOUND = 15

export type ConversationKind = 'generic' | 'real'
export type FollowupStatus = 'pending' | 'running' | 'done' | 'cancelled' | 'failed'
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/followups/config.ts
git commit -m "feat(followups): add schedule constants"
```

---

## Task 3: Sanitizer (TDD, pure)

**Files:**
- Create: `src/lib/followups/sanitize.ts`
- Create: `src/lib/followups/sanitize.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/followups/sanitize.test.ts
import { describe, expect, it } from 'vitest'
import { sanitizeFollowup } from './sanitize'

describe('sanitizeFollowup', () => {
  it('strips ASCII hyphen', () => {
    expect(sanitizeFollowup('Hi - interested?')).toBe('Hi interested?')
  })

  it('strips every dash glyph (en, em, figure, hyphen-bullet)', () => {
    expect(sanitizeFollowup('a-b‐c‑d‒e–f—g―h')).toBe('a b c d e f g h')
  })

  it('collapses whitespace and forces one line', () => {
    expect(sanitizeFollowup('Hi\nthere\n\n  friend')).toBe('Hi there friend')
  })

  it('trims surrounding quotes the LLM sometimes adds', () => {
    expect(sanitizeFollowup('"Hi there"')).toBe('Hi there')
    expect(sanitizeFollowup("'Hi there'")).toBe('Hi there')
  })

  it('caps length at 200 chars', () => {
    const long = 'a'.repeat(300)
    expect(sanitizeFollowup(long).length).toBe(200)
  })

  it('returns empty string on empty input', () => {
    expect(sanitizeFollowup('')).toBe('')
    expect(sanitizeFollowup('   ')).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/followups/sanitize.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/followups/sanitize.ts
//
// Strip every dash glyph (project rule: follow-ups must contain no dashes),
// flatten to a single line, cap at 200 chars. Idempotent.

const DASH_RE = /[-‐‑‒–—―]/g
const WS_RE = /\s+/g
const SURROUNDING_QUOTES_RE = /^["']|["']$/g

const MAX_LEN = 200

export function sanitizeFollowup(input: string): string {
  if (!input) return ''
  const dropped = input.replace(DASH_RE, ' ')
  const oneLine = dropped.replace(WS_RE, ' ').trim()
  const dequoted = oneLine.replace(SURROUNDING_QUOTES_RE, '').trim()
  if (!dequoted) return ''
  return dequoted.length > MAX_LEN ? dequoted.slice(0, MAX_LEN) : dequoted
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/followups/sanitize.test.ts`
Expected: PASS — all 6 cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/followups/sanitize.ts src/lib/followups/sanitize.test.ts
git commit -m "feat(followups): sanitizer strips dashes and forces one line"
```

---

## Task 4: Gates (TDD)

**Files:**
- Create: `src/lib/followups/gates.ts`
- Create: `src/lib/followups/gates.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/followups/gates.test.ts
import { describe, expect, it, vi } from 'vitest'
import { shouldSeed } from './gates'

// Minimal admin-client stub: each .from(table) returns a chainable query
// whose terminal call resolves with the canned value. The factory inside the
// test wires the canned values per case.
function makeAdmin(tables: Record<string, { count?: number; rows?: unknown[] }>) {
  return {
    from(table: string) {
      const canned = tables[table] ?? {}
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        then: (resolve: (r: { data: unknown[] | null; count: number | null; error: null }) => void) =>
          resolve({ data: canned.rows ?? [], count: canned.count ?? 0, error: null }),
      }
      return query
    },
  } as never
}

describe('shouldSeed', () => {
  it('passes when inbound count is 14 and no completed action', async () => {
    const admin = makeAdmin({
      messenger_messages: { count: 14 },
      action_page_submissions: { rows: [] },
    })
    const r = await shouldSeed(admin, { threadId: 't1', leadId: 'l1' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.inboundCount).toBe(14)
  })

  it('fails when inbound count is 15', async () => {
    const admin = makeAdmin({
      messenger_messages: { count: 15 },
      action_page_submissions: { rows: [] },
    })
    const r = await shouldSeed(admin, { threadId: 't1', leadId: 'l1' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('inbound_count_15')
  })

  it('fails when lead has a completed page action', async () => {
    const admin = makeAdmin({
      messenger_messages: { count: 3 },
      action_page_submissions: { rows: [{ id: 's1' }] },
    })
    const r = await shouldSeed(admin, { threadId: 't1', leadId: 'l1' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('page_action_completed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/followups/gates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/followups/gates.ts
//
// Gates G1 (lifetime lead inbound count < 15) and G2 (no completed action
// page submission). Both evaluated at seed time and again before each fire.
//
// "Completed page action" = any row in action_page_submissions for the lead.
// The submissions table is only written when a real form submit / booking /
// order goes through; row presence is the terminal signal.

import type { SupabaseClient } from '@supabase/supabase-js'
import { MAX_LIFETIME_LEAD_INBOUND } from './config'

export type ShouldSeedResult =
  | { ok: true; inboundCount: number }
  | { ok: false; reason: 'inbound_count_15' | 'page_action_completed' }

export async function countLeadInbound(
  admin: SupabaseClient,
  threadId: string,
): Promise<number> {
  const { count } = await admin
    .from('messenger_messages')
    .select('id', { head: true, count: 'exact' })
    .eq('thread_id', threadId)
    .eq('direction', 'inbound')
  return count ?? 0
}

export async function hasCompletedPageAction(
  admin: SupabaseClient,
  leadId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('action_page_submissions')
    .select('id')
    .eq('lead_id', leadId)
    .limit(1)
  return (data ?? []).length > 0
}

export async function shouldSeed(
  admin: SupabaseClient,
  args: { threadId: string; leadId: string },
): Promise<ShouldSeedResult> {
  const inboundCount = await countLeadInbound(admin, args.threadId)
  if (inboundCount >= MAX_LIFETIME_LEAD_INBOUND) {
    return { ok: false, reason: 'inbound_count_15' }
  }
  const hasAction = await hasCompletedPageAction(admin, args.leadId)
  if (hasAction) {
    return { ok: false, reason: 'page_action_completed' }
  }
  return { ok: true, inboundCount }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/followups/gates.test.ts`
Expected: PASS — 3 cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/followups/gates.ts src/lib/followups/gates.test.ts
git commit -m "feat(followups): gate helpers for inbound count and page action"
```

---

## Task 5: Message generation (TDD)

**Files:**
- Create: `src/lib/followups/generateMessage.ts`
- Create: `src/lib/followups/generateMessage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/followups/generateMessage.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const completeMock = vi.fn<(messages: unknown, opts?: unknown) => Promise<string>>()

vi.mock('@/lib/rag/llm', () => ({
  HfRouterLlm: vi.fn().mockImplementation(() => ({ complete: completeMock })),
}))
vi.mock('@/lib/rag/config', () => ({
  ragConfig: { classifierModel: 'fake-model' },
}))

import { generateFollowupMessage } from './generateMessage'

describe('generateFollowupMessage', () => {
  beforeEach(() => {
    completeMock.mockReset()
  })

  it('uses the LLM response when it returns content (real, offset 2)', async () => {
    completeMock.mockResolvedValueOnce('Hi Ana, kumusta na yung budget mo for the package?')
    const text = await generateFollowupMessage({
      kind: 'real',
      offsetIdx: 2,
      leadName: 'Ana',
      personalityBlock: 'warm and casual',
      recentMessages: [
        { role: 'user', content: 'how much po?' },
        { role: 'assistant', content: 'Starts at 5k po.' },
      ],
    })
    expect(text).toContain('Ana')
    expect(text).not.toMatch(/-|—|–/)
    expect(text.split('\n').length).toBe(1)
  })

  it('uses the fallback pool when LLM throws (generic, offset 0)', async () => {
    completeMock.mockRejectedValueOnce(new Error('llm timeout'))
    const text = await generateFollowupMessage({
      kind: 'generic',
      offsetIdx: 0,
      leadName: 'Jay',
      personalityBlock: '',
      recentMessages: [],
    })
    expect(text).toBe('Hi Jay, interested pa po kayo?')
  })

  it('forces offset 0 to be a light check-in for both kinds', async () => {
    completeMock.mockResolvedValueOnce(' "Hi Ana, interested pa po kayo?" ')
    const text = await generateFollowupMessage({
      kind: 'real',
      offsetIdx: 0,
      leadName: 'Ana',
      personalityBlock: 'warm',
      recentMessages: [
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
        { role: 'user', content: 'c' },
        { role: 'user', content: 'd' },
      ],
    })
    expect(text).toBe('Hi Ana, interested pa po kayo?')
  })

  it('sanitizes LLM output (dashes stripped, one line)', async () => {
    completeMock.mockResolvedValueOnce('Hey - any thoughts\non the proposal?')
    const text = await generateFollowupMessage({
      kind: 'real',
      offsetIdx: 3,
      leadName: null,
      personalityBlock: '',
      recentMessages: [],
    })
    expect(text).toBe('Hey any thoughts on the proposal?')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/followups/generateMessage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/followups/generateMessage.ts
//
// One LLM call per follow-up. Hard rules baked into the system prompt:
//   one line, ≤200 chars, no dashes, no markdown, match personality.
// Offset 0 is always a light check-in (per spec) — short-circuit to the
// fallback line so we don't pay for a model call on a fixed message.
// Generic-kind messages don't include the message history. Real-kind
// messages pass the last 20 turns so the LLM can reference what was said.
// 8s LLM timeout; on failure or empty response, fall back to a curated
// per-offset pool so the user never sees a dropped touchpoint.

import { HfRouterLlm } from '@/lib/rag/llm'
import { ragConfig } from '@/lib/rag/config'
import { sanitizeFollowup } from './sanitize'
import { MAX_OFFSET_IDX, type ConversationKind } from './config'

const LLM_TIMEOUT_MS = 8_000

export interface GenerateArgs {
  kind: ConversationKind
  offsetIdx: number
  leadName: string | null
  personalityBlock: string
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string }>
}

// Per-offset fallback pool. Indices 0..6 line up with OFFSETS_MS. Each pool
// has at least one Taglish line that uses the lead's first name. Strings here
// are pre-sanitized: no dashes, one line.
const FALLBACK_POOL: Record<ConversationKind, string[]> = {
  generic: [
    'Hi {name}, interested pa po kayo?',                          // 0  · 5m
    'Hi {name}, may follow up lang po, anything I can help with?', // 1  · 1h
    'Hi {name}, balik lang po ako, anong sa tingin niyo?',         // 2  · 5h
    'Hi {name}, gusto niyo pa po ba ituloy?',                       // 3  · 8h
    'Hi {name}, available pa po kayo to chat?',                     // 4  · 12h
    'Hi {name}, last check po, may itatanong pa po ba kayo?',       // 5  · 18h
    'Hi {name}, balik na lang po kayo anytime kung interested.',    // 6  · 24h
  ],
  real: [
    'Hi {name}, interested pa po kayo?',                            // 0  · 5m  (light check-in)
    'Hi {name}, anything pa po na gusto niyong i clarify?',         // 1  · 1h
    'Hi {name}, balikan lang po, ano sa tingin niyo so far?',       // 2  · 5h
    'Hi {name}, naisip niyo na po ba ituloy?',                      // 3  · 8h
    'Hi {name}, sabihan niyo lang po kung kailangan pa ng info.',   // 4  · 12h
    'Hi {name}, follow up po, gusto niyo pa po ba i pursue?',       // 5  · 18h
    'Hi {name}, kahit anong oras po pwede tayo ulit mag usap.',     // 6  · 24h
  ],
}

function firstName(name: string | null): string {
  if (!name) return ''
  return name.trim().split(/\s+/)[0]
}

function fallback(kind: ConversationKind, idx: number, leadName: string | null): string {
  const safeIdx = Math.max(0, Math.min(MAX_OFFSET_IDX, idx))
  const line = FALLBACK_POOL[kind][safeIdx]
  const fn = firstName(leadName)
  return sanitizeFollowup(line.replace('{name}', fn || 'there'))
}

function buildSystemPrompt(args: GenerateArgs): string {
  const rules =
    'Hard rules: one line only, max 200 characters, no dashes ("-", "—", "–"), no markdown, no emojis ' +
    'unless the personality calls for them. Match the personality language (Tagalog, Taglish, or English). ' +
    'Sound human, never robotic. Never start with "Hello! I am..." or generic AI phrasing.'
  const personality = args.personalityBlock?.trim()
    ? `Personality / tone:\n${args.personalityBlock.trim()}\n\n`
    : ''
  const fnHint = firstName(args.leadName) ? `Use the customer's first name once: ${firstName(args.leadName)}.\n` : ''

  if (args.kind === 'generic') {
    return (
      `${personality}` +
      `You are writing follow-up message #${args.offsetIdx + 1} of 7 to a Messenger lead who replied earlier ` +
      `but has gone quiet. The previous exchange had less than 4 messages from the lead, so DO NOT pretend ` +
      `to remember specifics. Write a warm, light check-in that nudges them to reply. ` +
      `${fnHint}${rules}`
    )
  }
  return (
    `${personality}` +
    `You are writing follow-up message #${args.offsetIdx + 1} of 7 to a Messenger lead who has gone quiet ` +
    `after a real back-and-forth. Reference what was already discussed naturally and propose a concrete ` +
    `next step or ask one focused question. ${fnHint}${rules}`
  )
}

function buildUserPrompt(args: GenerateArgs): string {
  if (args.kind === 'generic' || args.recentMessages.length === 0) {
    return `Write follow-up #${args.offsetIdx + 1} now. Do not repeat earlier phrasings.`
  }
  const transcript = args.recentMessages
    .slice(-20)
    .map((m) => (m.role === 'user' ? `Customer: ${m.content}` : `You earlier: ${m.content}`))
    .join('\n')
  return `Last messages in the conversation:\n${transcript}\n\nWrite follow-up #${args.offsetIdx + 1} now.`
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('llm_timeout')), ms)),
  ])
}

export async function generateFollowupMessage(args: GenerateArgs): Promise<string> {
  // Offset 0 is always the fixed light check-in regardless of kind.
  if (args.offsetIdx === 0) {
    return fallback(args.kind, 0, args.leadName)
  }

  try {
    const llm = new HfRouterLlm({ model: ragConfig.classifierModel })
    const raw = await withTimeout(
      llm.complete(
        [
          { role: 'system', content: buildSystemPrompt(args) },
          { role: 'user', content: buildUserPrompt(args) },
        ],
        { temperature: 0.6, maxTokens: 160 },
      ),
      LLM_TIMEOUT_MS,
    )
    const cleaned = sanitizeFollowup(raw)
    if (!cleaned) throw new Error('empty')
    return cleaned
  } catch {
    return fallback(args.kind, args.offsetIdx, args.leadName)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/followups/generateMessage.test.ts`
Expected: PASS — 4 cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/followups/generateMessage.ts src/lib/followups/generateMessage.test.ts
git commit -m "feat(followups): LLM message generator with per-offset fallback"
```

---

## Task 6: Seed & cancel (TDD)

**Files:**
- Create: `src/lib/followups/seed.ts`
- Create: `src/lib/followups/seed.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/followups/seed.test.ts
//
// These tests exercise the seed logic against a hand-rolled fake admin
// client. They do NOT touch Postgres — the goal is to lock in the call
// sequence (cancel-then-insert) and the conversation_kind decision.

import { describe, expect, it, vi } from 'vitest'

vi.mock('./gates', () => ({
  shouldSeed: vi.fn(),
}))

import { shouldSeed } from './gates'
import { maybeScheduleFollowup } from './seed'

type Captured = { table: string; op: string; values?: unknown; match?: unknown }

function makeAdmin(): { admin: unknown; captured: Captured[] } {
  const captured: Captured[] = []
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      chain.update = (values: unknown) => {
        captured.push({ table, op: 'update', values })
        return chain
      }
      chain.insert = (values: unknown) => {
        captured.push({ table, op: 'insert', values })
        return Promise.resolve({ data: null, error: null })
      }
      chain.eq = (col: string, val: unknown) => {
        captured.push({ table, op: 'eq', match: { col, val } })
        return chain
      }
      chain.in = () => chain
      chain.select = () => chain
      return chain
    },
  }
  return { admin, captured }
}

describe('maybeScheduleFollowup', () => {
  it('cancels existing schedule then inserts new pending row when gates pass', async () => {
    ;(shouldSeed as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      inboundCount: 2,
    })
    const { admin, captured } = makeAdmin()
    const lastInboundAt = new Date('2026-05-17T10:00:00Z').toISOString()

    await maybeScheduleFollowup(admin as never, {
      threadId: 't1', leadId: 'l1', userId: 'u1', pageId: 'p1', lastInboundAt,
    })

    const ops = captured.filter((c) => c.op === 'update' || c.op === 'insert')
    expect(ops[0]).toMatchObject({ table: 'lead_followup_schedules', op: 'update' })
    expect(ops[ops.length - 1]).toMatchObject({ table: 'lead_followup_schedules', op: 'insert' })
    const inserted = ops[ops.length - 1].values as Record<string, unknown>
    expect(inserted.conversation_kind).toBe('generic')
    expect(inserted.next_offset_idx).toBe(0)
    expect(inserted.started_at).toBe(lastInboundAt)
    expect(inserted.next_run_at).toBe(new Date(Date.parse(lastInboundAt) + 5 * 60_000).toISOString())
  })

  it('decides conversation_kind=real when inboundCount >= 4', async () => {
    ;(shouldSeed as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      inboundCount: 7,
    })
    const { admin, captured } = makeAdmin()
    await maybeScheduleFollowup(admin as never, {
      threadId: 't2', leadId: 'l2', userId: 'u1', pageId: 'p1',
      lastInboundAt: new Date().toISOString(),
    })
    const ins = captured.find((c) => c.op === 'insert')!
    expect((ins.values as Record<string, unknown>).conversation_kind).toBe('real')
  })

  it('cancels existing schedule but does not insert when gates fail', async () => {
    ;(shouldSeed as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      reason: 'inbound_count_15',
    })
    const { admin, captured } = makeAdmin()
    await maybeScheduleFollowup(admin as never, {
      threadId: 't3', leadId: 'l3', userId: 'u1', pageId: 'p1',
      lastInboundAt: new Date().toISOString(),
    })
    expect(captured.find((c) => c.op === 'insert')).toBeUndefined()
    expect(captured.find((c) => c.op === 'update')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/followups/seed.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/followups/seed.ts
//
// Seed and cancel logic for the auto-followup schedule. Called from the
// messenger inbound worker after the inbound message row is committed.
//
// Idempotency: the `uniq_active_followup_per_thread` partial unique index
// guarantees no two pending/running rows for the same thread. Two concurrent
// inbound deliveries can both arrive here; the loser's insert errors with
// 23505 and we swallow it.

import type { SupabaseClient } from '@supabase/supabase-js'
import { shouldSeed } from './gates'
import { OFFSETS_MS, REAL_CONVERSATION_LEAD_MSG_THRESHOLD } from './config'

export interface SeedArgs {
  threadId: string
  leadId: string
  userId: string
  pageId: string
  lastInboundAt: string
}

export async function cancelActiveFollowup(
  admin: SupabaseClient,
  threadId: string,
): Promise<void> {
  await admin
    .from('lead_followup_schedules')
    .update({ status: 'cancelled' })
    .eq('thread_id', threadId)
    .in('status', ['pending', 'running'])
}

export async function maybeScheduleFollowup(
  admin: SupabaseClient,
  args: SeedArgs,
): Promise<void> {
  // 1. Cancel any active schedule for this thread. Always runs — even when
  //    gates will fail — so a lead crossing the 15-message line cleans up.
  await cancelActiveFollowup(admin, args.threadId)

  // 2. Re-evaluate gates after cancel.
  const gate = await shouldSeed(admin, {
    threadId: args.threadId,
    leadId: args.leadId,
  })
  if (!gate.ok) return

  const conversation_kind =
    gate.inboundCount >= REAL_CONVERSATION_LEAD_MSG_THRESHOLD ? 'real' : 'generic'
  const next_run_at = new Date(Date.parse(args.lastInboundAt) + OFFSETS_MS[0]).toISOString()

  const { error } = await admin
    .from('lead_followup_schedules')
    .insert({
      user_id: args.userId,
      lead_id: args.leadId,
      thread_id: args.threadId,
      page_id: args.pageId,
      started_at: args.lastInboundAt,
      next_offset_idx: 0,
      next_run_at,
      status: 'pending',
      conversation_kind,
      lead_inbound_count_at_seed: gate.inboundCount,
    })

  // 23505 = unique_violation. A concurrent inbound already seeded — fine.
  if (error && (error as { code?: string }).code !== '23505') {
    console.warn('[followups.seed] insert failed', error.message)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/followups/seed.test.ts`
Expected: PASS — 3 cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/followups/seed.ts src/lib/followups/seed.test.ts
git commit -m "feat(followups): seed and cancel logic"
```

---

## Task 7: Fire handler (TDD)

**Files:**
- Create: `src/lib/followups/fire.ts`
- Create: `src/lib/followups/fire.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/followups/fire.test.ts
//
// Exercises the per-job handler: claim row → re-check gates → generate →
// sanitize → send → advance. The send and generator are mocked.

import { describe, expect, it, vi, beforeEach } from 'vitest'

const sendOutboundMock = vi.fn()
const generateMock = vi.fn()
const shouldSeedMock = vi.fn()

vi.mock('@/lib/messenger/outbound', () => ({ sendOutbound: sendOutboundMock }))
vi.mock('@/lib/facebook/crypto', () => ({ decryptToken: (s: string) => `dec:${s}` }))
vi.mock('@/lib/agent/classifyPolicy', () => ({
  isInsideWindow: (s: string | null) => !!s && Date.now() - new Date(s).getTime() < 24 * 3600_000,
}))
vi.mock('./generateMessage', () => ({ generateFollowupMessage: generateMock }))
vi.mock('./gates', () => ({ shouldSeed: shouldSeedMock }))

import { handleFollowupSend } from './fire'

interface FakeRow {
  id: string
  user_id: string
  lead_id: string
  thread_id: string
  page_id: string
  started_at: string
  next_offset_idx: number
  conversation_kind: 'generic' | 'real'
  status: string
}

function makeAdmin(seed: { schedule: FakeRow; thread: Record<string, unknown>; page: Record<string, unknown>; lead: Record<string, unknown>; chatbot: Record<string, unknown>; history: unknown[] }) {
  const updates: Array<{ table: string; values: unknown; match: unknown }> = []
  const inserts: Array<{ table: string; values: unknown }> = []
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      let pendingMatch: Record<string, unknown> = {}
      let pendingUpdate: unknown = null
      chain.select = () => chain
      chain.order = () => chain
      chain.limit = () => chain
      chain.eq = (col: string, val: unknown) => {
        pendingMatch = { ...pendingMatch, [col]: val }
        return chain
      }
      chain.maybeSingle = async () => {
        if (table === 'lead_followup_schedules') return { data: seed.schedule, error: null }
        if (table === 'messenger_threads') return { data: seed.thread, error: null }
        if (table === 'facebook_pages') return { data: seed.page, error: null }
        if (table === 'leads') return { data: seed.lead, error: null }
        if (table === 'chatbot_configs') return { data: seed.chatbot, error: null }
        return { data: null, error: null }
      }
      chain.update = (values: unknown) => {
        pendingUpdate = values
        return chain
      }
      chain.insert = (values: unknown) => {
        inserts.push({ table, values })
        return Promise.resolve({ data: null, error: null })
      }
      chain.then = (resolve: (r: { data: unknown[]; error: null }) => void) => {
        if (pendingUpdate !== null) {
          updates.push({ table, values: pendingUpdate, match: pendingMatch })
        }
        if (table === 'messenger_messages' && pendingUpdate === null) {
          resolve({ data: seed.history, error: null })
        } else {
          resolve({ data: [], error: null })
        }
      }
      return chain
    },
  }
  return { admin, updates, inserts }
}

beforeEach(() => {
  sendOutboundMock.mockReset()
  generateMock.mockReset()
  shouldSeedMock.mockReset()
})

describe('handleFollowupSend', () => {
  const schedule: FakeRow = {
    id: 's1', user_id: 'u1', lead_id: 'l1', thread_id: 't1', page_id: 'p1',
    started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
    next_offset_idx: 0,
    conversation_kind: 'generic',
    status: 'pending',
  }
  const baseSeed = {
    schedule,
    thread: { id: 't1', psid: 'ps1', last_inbound_at: schedule.started_at, page_id: 'p1', full_name: 'Ana Cruz' },
    page: { id: 'p1', page_access_token: 'enc-token' },
    lead: { name: 'Ana Cruz' },
    chatbot: { persona: 'warm, casual' },
    history: [],
  }

  it('generates, sends, and advances to next offset', async () => {
    shouldSeedMock.mockResolvedValue({ ok: true, inboundCount: 1 })
    generateMock.mockResolvedValue('Hi Ana, interested pa po kayo?')
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fb1' })
    const { admin, updates } = makeAdmin(baseSeed)

    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    expect(sendOutboundMock).toHaveBeenCalledTimes(1)
    const upd = updates.filter((u) => u.table === 'lead_followup_schedules')
    const last = upd[upd.length - 1].values as Record<string, unknown>
    expect(last.next_offset_idx).toBe(1)
    expect(last.status).toBe('pending')
  })

  it('marks done when firing the last offset (6)', async () => {
    shouldSeedMock.mockResolvedValue({ ok: true, inboundCount: 1 })
    generateMock.mockResolvedValue('Hi Ana, balik na lang po kayo anytime kung interested.')
    sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fb7' })
    const { admin, updates } = makeAdmin({ ...baseSeed, schedule: { ...schedule, next_offset_idx: 6 } })

    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    const upd = updates.filter((u) => u.table === 'lead_followup_schedules')
    const last = upd[upd.length - 1].values as Record<string, unknown>
    expect(last.status).toBe('done')
  })

  it('marks done without sending when gates fail mid-schedule', async () => {
    shouldSeedMock.mockResolvedValue({ ok: false, reason: 'page_action_completed' })
    const { admin, updates } = makeAdmin(baseSeed)

    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    expect(sendOutboundMock).not.toHaveBeenCalled()
    const upd = updates.filter((u) => u.table === 'lead_followup_schedules')
    expect((upd[upd.length - 1].values as Record<string, unknown>).status).toBe('done')
  })

  it('marks failed on send error', async () => {
    shouldSeedMock.mockResolvedValue({ ok: true, inboundCount: 1 })
    generateMock.mockResolvedValue('hi')
    sendOutboundMock.mockResolvedValue({ sent: false, reason: 'window' })
    const { admin, updates } = makeAdmin(baseSeed)

    await handleFollowupSend(admin as never, { scheduleId: 's1' })

    const upd = updates.filter((u) => u.table === 'lead_followup_schedules')
    const last = upd[upd.length - 1].values as Record<string, unknown>
    expect(last.status).toBe('failed')
    expect(last.last_error).toContain('window')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/followups/fire.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/followups/fire.ts
//
// Per-schedule fire handler. Invoked from the messenger worker via the
// `followup_send` job kind. We re-evaluate gates on every fire so a lead
// who completes a booking between schedule creation and the next touchpoint
// stops getting pinged. After a successful send the row is either advanced
// to the next pending offset or marked done.

import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptToken } from '@/lib/facebook/crypto'
import { sendOutbound } from '@/lib/messenger/outbound'
import { isInsideWindow } from '@/lib/agent/classifyPolicy'
import { shouldSeed } from './gates'
import { generateFollowupMessage } from './generateMessage'
import { OFFSETS_MS, MAX_OFFSET_IDX } from './config'

interface ScheduleRow {
  id: string
  user_id: string
  lead_id: string
  thread_id: string
  page_id: string
  started_at: string
  next_offset_idx: number
  conversation_kind: 'generic' | 'real'
  status: string
}

interface ThreadRow {
  id: string
  psid: string
  last_inbound_at: string | null
  full_name: string | null
}

export interface FollowupSendJob {
  id: string
  payload: { schedule_id: string } | null
}

export async function handleFollowupSend(
  admin: SupabaseClient,
  args: { scheduleId: string },
): Promise<void> {
  const { data: schedule } = await admin
    .from('lead_followup_schedules')
    .select('id, user_id, lead_id, thread_id, page_id, started_at, next_offset_idx, conversation_kind, status')
    .eq('id', args.scheduleId)
    .maybeSingle<ScheduleRow>()

  if (!schedule) return
  if (schedule.status !== 'running' && schedule.status !== 'pending') return

  // Re-check gates: a lead who booked between scheduling and firing should
  // not receive the touchpoint.
  const gate = await shouldSeed(admin, {
    threadId: schedule.thread_id,
    leadId: schedule.lead_id,
  })
  if (!gate.ok) {
    await markDone(admin, schedule.id)
    return
  }

  // Load thread + page + chatbot personality + last 20 messages.
  const { data: thread } = await admin
    .from('messenger_threads')
    .select('id, psid, last_inbound_at, full_name')
    .eq('id', schedule.thread_id)
    .maybeSingle<ThreadRow>()
  if (!thread) {
    await markDone(admin, schedule.id)
    return
  }

  const { data: page } = await admin
    .from('facebook_pages')
    .select('id, page_access_token')
    .eq('id', schedule.page_id)
    .maybeSingle<{ id: string; page_access_token: string }>()
  if (!page) {
    await markFailed(admin, schedule.id, 'page missing')
    return
  }

  const { data: chatbot } = await admin
    .from('chatbot_configs')
    .select('persona, instructions')
    .eq('user_id', schedule.user_id)
    .maybeSingle<{ persona: string | null; instructions: string | null }>()

  const { data: leadRow } = await admin
    .from('leads')
    .select('name')
    .eq('id', schedule.lead_id)
    .maybeSingle<{ name: string | null }>()

  const personalityBlock = [chatbot?.persona, chatbot?.instructions]
    .filter((s) => typeof s === 'string' && s.trim())
    .join('\n\n')

  // For 'real' conversations, load the last 20 messages so the LLM can
  // reference them. For 'generic', skip the DB read — we don't use them.
  let recentMessages: Array<{ role: 'user' | 'assistant'; content: string }> = []
  if (schedule.conversation_kind === 'real') {
    const { data: msgs } = await admin
      .from('messenger_messages')
      .select('direction, body, created_at')
      .eq('thread_id', schedule.thread_id)
      .order('created_at', { ascending: false })
      .limit(20)
    recentMessages = ((msgs ?? []) as Array<{ direction: string; body: string }>)
      .reverse()
      .filter((m) => m.body?.trim())
      .map((m) => ({
        role: m.direction === 'outbound' ? ('assistant' as const) : ('user' as const),
        content: m.body,
      }))
  }

  const leadName = leadRow?.name ?? thread.full_name ?? null

  const text = await generateFollowupMessage({
    kind: schedule.conversation_kind,
    offsetIdx: schedule.next_offset_idx,
    leadName,
    personalityBlock,
    recentMessages,
  })

  if (!text) {
    await markFailed(admin, schedule.id, 'empty message')
    return
  }

  // Inside 24h → 'bot' (plain RESPONSE). Outside → 'workflow_human_agent'
  // which uses HUMAN_AGENT tag on the send. Same pattern as reminders/fire.
  const insideWindow = isInsideWindow(thread.last_inbound_at)
  const sendKind = insideWindow ? 'bot' : 'workflow_human_agent'
  const pageToken = decryptToken(page.page_access_token)

  const result = await sendOutbound({
    admin,
    thread: { id: thread.id, psid: thread.psid, last_inbound_at: thread.last_inbound_at },
    pageToken,
    payload: { kind: 'text', text },
    kind: sendKind,
  })

  if (!result.sent) {
    const reason = (result as { sent: false; reason: string }).reason
    await markFailed(admin, schedule.id, `send_blocked:${reason}`)
    return
  }

  // Persist the outbound message so it shows up in the inbox and counts
  // toward conversation history. Unique violation on fb_message_id is fine.
  await admin
    .from('messenger_messages')
    .insert({
      thread_id: thread.id,
      user_id: schedule.user_id,
      direction: 'outbound',
      sender: 'bot',
      fb_message_id: result.messageId,
      body: text,
    })
    .then(({ error }) => {
      if (error && (error as { code?: string }).code !== '23505') {
        console.warn('[followups.fire] message insert failed', error.message)
      }
    })

  // Advance the schedule.
  await advanceSchedule(admin, schedule)
}

async function advanceSchedule(admin: SupabaseClient, schedule: ScheduleRow): Promise<void> {
  if (schedule.next_offset_idx >= MAX_OFFSET_IDX) {
    await markDone(admin, schedule.id)
    return
  }
  const nextIdx = schedule.next_offset_idx + 1
  const nextRunAt = new Date(Date.parse(schedule.started_at) + OFFSETS_MS[nextIdx]).toISOString()
  await admin
    .from('lead_followup_schedules')
    .update({
      next_offset_idx: nextIdx,
      next_run_at: nextRunAt,
      status: 'pending',
      job_id: null,
    })
    .eq('id', schedule.id)
}

async function markDone(admin: SupabaseClient, id: string): Promise<void> {
  await admin.from('lead_followup_schedules').update({ status: 'done' }).eq('id', id)
}

async function markFailed(admin: SupabaseClient, id: string, reason: string): Promise<void> {
  await admin
    .from('lead_followup_schedules')
    .update({ status: 'failed', last_error: reason.slice(0, 500) })
    .eq('id', id)
}

// Worker entry point — called from `messenger/process` route's `runJob`
// branch when `job.kind === 'followup_send'`.
export async function handleFollowupSendJob(
  admin: SupabaseClient,
  job: FollowupSendJob,
): Promise<void> {
  const scheduleId = job.payload?.schedule_id
  if (!scheduleId) {
    await admin
      .from('messenger_jobs')
      .update({ status: 'skipped', finished_at: new Date().toISOString() })
      .eq('id', job.id)
    return
  }
  try {
    await handleFollowupSend(admin, { scheduleId })
    await admin
      .from('messenger_jobs')
      .update({ status: 'done', finished_at: new Date().toISOString() })
      .eq('id', job.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[followups.fire] handler threw', job.id, msg)
    await admin
      .from('messenger_jobs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        last_error: msg.slice(0, 1000),
      })
      .eq('id', job.id)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/followups/fire.test.ts`
Expected: PASS — 4 cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/followups/fire.ts src/lib/followups/fire.test.ts
git commit -m "feat(followups): fire handler advances schedule and sends"
```

---

## Task 8: Cron tick — enqueue due schedules

**Files:**
- Create: `src/app/api/cron/followups-tick/route.ts`
- Create: `src/app/api/cron/followups-tick/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/api/cron/followups-tick/route.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const adminFromMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: adminFromMock }),
}))

import { GET } from './route'

beforeEach(() => {
  process.env.NODE_ENV = 'test'
  process.env.CRON_SECRET = 'secret'
  process.env.NEXT_PUBLIC_APP_URL = 'http://localhost'
  process.env.MESSENGER_WORKER_SECRET = 'wsecret'
  adminFromMock.mockReset()
})

describe('followups-tick route', () => {
  it('rejects unauthorized requests in production', async () => {
    process.env.NODE_ENV = 'production'
    const res = await GET(new Request('http://x/api/cron/followups-tick'))
    expect(res.status).toBe(401)
  })

  it('enqueues a messenger_jobs row for each due schedule', async () => {
    const due = [
      { id: 's1', user_id: 'u1', thread_id: 't1' },
      { id: 's2', user_id: 'u1', thread_id: 't2' },
    ]
    const inserts: unknown[] = []
    const updates: unknown[] = []
    adminFromMock.mockImplementation((table: string) => {
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = () => chain
      chain.is = () => chain
      chain.lte = () => chain
      chain.limit = () =>
        table === 'lead_followup_schedules'
          ? Promise.resolve({ data: due, error: null })
          : chain
      chain.insert = (v: unknown) => {
        inserts.push({ table, v })
        return {
          select: () => ({
            single: () => Promise.resolve({ data: { id: `job-${inserts.length}` }, error: null }),
          }),
        }
      }
      chain.update = (v: unknown) => {
        updates.push({ table, v })
        chain.eq = () => Promise.resolve({ error: null }) as never
        return chain
      }
      return chain
    })

    const req = new Request('http://x/api/cron/followups-tick', {
      headers: { authorization: 'Bearer secret' },
    })
    const res = await GET(req)
    const json = (await res.json()) as { enqueued: number }
    expect(json.enqueued).toBe(2)
    const jobInserts = inserts.filter((i) => (i as { table: string }).table === 'messenger_jobs')
    expect(jobInserts).toHaveLength(2)
    for (const j of jobInserts) {
      expect((j as { v: Record<string, unknown> }).v.kind).toBe('followup_send')
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/cron/followups-tick/route.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Implement**

```ts
// src/app/api/cron/followups-tick/route.ts
//
// Every-minute tick: find lead_followup_schedules rows whose next_run_at is
// past due and no job is queued for them, then insert a messenger_jobs row
// per schedule. The messenger worker drains them with per-thread
// serialization (no two jobs for the same thread run in parallel).
//
// Reuses CRON_SECRET (cron auth) and MESSENGER_WORKER_SECRET (kicker).

import { after, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface DueSchedule {
  id: string
  user_id: string
  thread_id: string
}

export async function GET(req: Request): Promise<NextResponse> {
  const isDev = process.env.NODE_ENV !== 'production'
  if (!isDev) {
    const auth = req.headers.get('authorization')
    const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`
    if (!process.env.CRON_SECRET || auth !== expected) {
      return new NextResponse('Unauthorized', { status: 401 })
    }
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { data: due, error } = await admin
    .from('lead_followup_schedules')
    .select('id, user_id, thread_id')
    .eq('status', 'pending')
    .is('job_id', null)
    .lte('next_run_at', now)
    .limit(100)

  if (error) {
    console.error('[cron.followups-tick] query failed', error.message)
    return NextResponse.json({ enqueued: 0, error: error.message }, { status: 200 })
  }

  const rows = (due ?? []) as DueSchedule[]
  let enqueued = 0

  for (const r of rows) {
    const { data: job, error: jobErr } = await admin
      .from('messenger_jobs')
      .insert({
        thread_id: r.thread_id,
        user_id: r.user_id,
        kind: 'followup_send',
        payload: { schedule_id: r.id },
        status: 'queued',
        scheduled_at: now,
        inbound_msg_id: null,
      })
      .select('id')
      .single<{ id: string }>()

    if (jobErr || !job) {
      console.warn('[cron.followups-tick] enqueue failed', r.id, jobErr?.message)
      continue
    }

    await admin
      .from('lead_followup_schedules')
      .update({ job_id: job.id, status: 'running' })
      .eq('id', r.id)

    enqueued += 1
  }

  if (enqueued > 0) {
    const base = process.env.NEXT_PUBLIC_APP_URL
    const secret = process.env.MESSENGER_WORKER_SECRET ?? process.env.WORKFLOW_WORKER_SECRET
    if (base && secret) {
      after(async () => {
        try {
          await fetch(`${base}/api/messenger/process`, {
            method: 'POST',
            headers: { 'x-worker-secret': secret },
          })
        } catch (e) {
          console.warn('[cron.followups-tick] worker trigger failed', e)
        }
      })
    }
  }

  return NextResponse.json({ enqueued })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/cron/followups-tick/route.test.ts`
Expected: PASS — 2 cases.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/followups-tick/
git commit -m "feat(followups): cron tick enqueues due schedules"
```

---

## Task 9: Wire seed + dispatch into `messenger/process`

**Files:**
- Modify: `src/app/api/messenger/process/route.ts`

- [ ] **Step 1: Add imports**

Add to the top of `src/app/api/messenger/process/route.ts` (alongside the existing `handleReminderFire` and `handleCampaignSend` imports):

```ts
import { maybeScheduleFollowup } from '@/lib/followups/seed'
import { handleFollowupSendJob } from '@/lib/followups/fire'
```

- [ ] **Step 2: Add the `followup_send` job-kind branch**

In `runJob` in `src/app/api/messenger/process/route.ts`, immediately after the existing `if (job.kind === 'agent_campaign_send') { … return }` block (around line 259), insert:

```ts
if (job.kind === 'followup_send') {
  await handleFollowupSendJob(admin, {
    id: job.id,
    payload: job.payload as { schedule_id: string } | null,
  })
  return
}
```

- [ ] **Step 3: Seed on inbound after `last_inbound_at` update**

In `runJob`, right after the existing block that updates `messenger_threads.last_inbound_at` (around line 308–312, just after `thread.last_inbound_at = inboundAt`), add:

```ts
// Auto follow-up: cancel any pending schedule and (if gates pass) seed a
// fresh one. Lead inbound is the cancel trigger; the seed re-checks both
// gates inline. Fire-and-forget — must never break the inbound reply.
if (thread.lead_id) {
  const leadIdForFu = thread.lead_id
  void maybeScheduleFollowup(admin, {
    threadId: thread.id,
    leadId: leadIdForFu,
    userId: thread.user_id,
    pageId: thread.page_id,
    lastInboundAt: inboundAt,
  }).catch((e) => console.warn('[messenger.worker] followup seed failed', e))
}
```

- [ ] **Step 4: Run the existing route test to make sure nothing regresses**

Run: `npx vitest run src/app/api/messenger/process/route.test.ts`
Expected: PASS (or unchanged-from-baseline; if a stub for `chatbot_configs` or new mocks is needed because new code paths are wired in, the test will surface specific failures — fix them by adding stubs that mirror the existing pattern).

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/messenger/process/route.ts
git commit -m "feat(followups): wire seed and dispatch into messenger worker"
```

---

## Task 10: End-to-end smoke (manual)

**Files:** none

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all suites pass.

- [ ] **Step 2: Lint and type check**

Run: `npx eslint . && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Manual smoke (optional, against a dev Supabase + connected page)**

1. Send a Messenger DM to a connected dev page as a fresh test customer.
2. Observe a row appears in `lead_followup_schedules` with `status='pending'`, `next_run_at` ≈ inbound + 5 min.
3. Wait (or temporarily lower `OFFSETS_MS[0]` to `60_000` for the smoke). After the cron tick fires, observe:
   - A new `messenger_jobs` row with `kind='followup_send'`.
   - The schedule row advances to `next_offset_idx=1`, `status='pending'`.
   - An outbound message in `messenger_messages` with `sender='bot'` and no dash characters.
4. Reply from the customer side. Confirm the existing schedule flips to `status='cancelled'` and a fresh `pending` row is seeded.
5. Trigger gate failure: insert a fake `action_page_submissions` row for the lead and let the next tick fire; the schedule should advance to `status='done'` without sending.

- [ ] **Step 4: Commit any test-only adjustments uncovered above**

```bash
git status
# If anything was tweaked during smoke, commit it now.
```

---

## Self-Review Notes (already applied)

- Spec coverage: every spec section (activation rules, schedule, cancellation, data model, seed, worker, generation, files, tests, ops) maps to at least one task above.
- Type/name consistency: `ConversationKind`, `OFFSETS_MS`, `MAX_OFFSET_IDX`, `shouldSeed`, `maybeScheduleFollowup`, `handleFollowupSend`, `handleFollowupSendJob`, `generateFollowupMessage`, `sanitizeFollowup` — referenced identically across tasks.
- Offset 0 handling: spec says "first follow-up is always a light check-in regardless of kind"; `generateFollowupMessage` short-circuits offset 0 to the fallback line.
- Dash strip: covers every Unicode dash glyph; tested.
- HUMAN_AGENT outside 24h: uses existing `sendOutbound` + `kind: 'workflow_human_agent'` (same pattern as `reminders/fire.ts`).
- Re-evaluating gates in `handleFollowupSend` ensures a lead who books between schedule creation and the next touchpoint stops being pinged.
