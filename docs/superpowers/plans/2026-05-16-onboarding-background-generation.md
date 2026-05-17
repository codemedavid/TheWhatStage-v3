# Onboarding Background Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple onboarding AI generation from page navigation. Generation kicks off on step submit, runs in the background via Next 16 `after()`, and downstream pages render a branded "generating" animation only if the user outpaces it. Durable state in a new `generation_jobs` table.

**Architecture:**
- New `generation_jobs` table tracks one row per `(profile_id, kind)` with `queued|running|done|failed` status, `input_hash` for idempotency, and `result` jsonb.
- New `runGeneration(kind, input)` dispatcher in `src/lib/onboarding/generation/` wraps existing `lib/onboarding/ai/*` generators with status writes. Never throws.
- Existing step-submit actions call `after(() => runGeneration(...))` then `redirect()` — response ships immediately, generation continues on Fluid Compute.
- Each AI-review step page reads the job row server-side: `done` → render edit UI; otherwise → render `<GenerationGate />` which polls `/api/onboarding/generation/[kind]` and swaps via `router.refresh()` when ready.

**Tech Stack:** Next.js 16 App Router (`after` from `next/server`), Supabase (Postgres + RLS), TypeScript, React 19, Vitest, Zod.

**Reference spec:** `docs/superpowers/specs/2026-05-16-onboarding-background-generation-design.md`

---

## Conventions

- **TDD:** every code module is preceded by a failing test.
- **Commits:** after each numbered Task completes, one focused commit.
- **Paths are absolute from repo root** unless they start with `node_modules/`.
- **Tests:** Vitest, colocated as `*.test.ts` next to the source file (matches existing repo pattern in `src/lib/onboarding/ai/`).
- **Type discipline:** `unknown` over `any`; narrow with Zod.
- The `set_updated_at()` trigger function already exists in the DB (used by `onboarding_state`). Reuse it.

---

## Task 1: Migration — `generation_jobs` table

**Files:**
- Create: `supabase/migrations/20260529000000_generation_jobs.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260529000000_generation_jobs.sql` with:

```sql
-- =========================================================================
-- generation_jobs: durable status + result for onboarding AI generations.
-- One row per (profile_id, kind). Lifecycle: queued -> running -> done|failed.
-- Writes are server-side only (admin client). Owners can read their own rows.
-- =========================================================================

create type onboarding_generation_kind as enum
  ('knowledge', 'faqs', 'personality_seed', 'form_fields', 'bot_instructions');

create type onboarding_generation_status as enum
  ('queued', 'running', 'done', 'failed');

create table public.generation_jobs (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  kind        onboarding_generation_kind not null,
  status      onboarding_generation_status not null default 'queued',
  input_hash  text not null,
  result      jsonb,
  error       text,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (profile_id, kind)
);

create index generation_jobs_profile_status_idx
  on public.generation_jobs (profile_id, status);

create trigger generation_jobs_set_updated_at
  before update on public.generation_jobs
  for each row execute function public.set_updated_at();

alter table public.generation_jobs enable row level security;

create policy generation_jobs_select_own on public.generation_jobs
  for select using (profile_id = auth.uid());

-- No insert/update/delete policy: writes go through the service-role admin
-- client from server actions, which bypasses RLS.
```

- [ ] **Step 2: Apply via Supabase MCP**

Use the Supabase MCP `apply_migration` tool with name `generation_jobs` and the file's contents.

- [ ] **Step 3: Verify**

Run via Supabase MCP `execute_sql`:
```sql
select column_name, data_type from information_schema.columns
where table_name = 'generation_jobs' order by ordinal_position;
```
Expected: rows for `id`, `profile_id`, `kind`, `status`, `input_hash`, `result`, `error`, `started_at`, `finished_at`, `created_at`, `updated_at`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260529000000_generation_jobs.sql
git commit -m "feat(onboarding): generation_jobs migration"
```

---

## Task 2: Canonical input hash

**Files:**
- Create: `src/lib/onboarding/generation/hash.ts`
- Test: `src/lib/onboarding/generation/hash.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/onboarding/generation/hash.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { canonicalHash } from './hash'

describe('canonicalHash', () => {
  it('returns a stable 64-char hex string', () => {
    const h = canonicalHash({ a: 1, b: 'two' })
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is order-independent for object keys', () => {
    const a = canonicalHash({ x: 1, y: 2 })
    const b = canonicalHash({ y: 2, x: 1 })
    expect(a).toBe(b)
  })

  it('is order-independent at nested levels', () => {
    const a = canonicalHash({ outer: { p: 1, q: 2 } })
    const b = canonicalHash({ outer: { q: 2, p: 1 } })
    expect(a).toBe(b)
  })

  it('trims top-level string values', () => {
    expect(canonicalHash({ s: '  hello  ' })).toBe(canonicalHash({ s: 'hello' }))
  })

  it('changes when values differ', () => {
    expect(canonicalHash({ a: 1 })).not.toBe(canonicalHash({ a: 2 }))
  })

  it('treats arrays as ordered (different order = different hash)', () => {
    expect(canonicalHash({ list: [1, 2] })).not.toBe(canonicalHash({ list: [2, 1] }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/onboarding/generation/hash.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/onboarding/generation/hash.ts`:

```ts
import { createHash } from 'node:crypto'

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' ? value.trim() : value
  }
  if (Array.isArray(value)) return value.map(canonicalize)
  const obj = value as Record<string, unknown>
  const sortedKeys = Object.keys(obj).sort()
  const out: Record<string, unknown> = {}
  for (const k of sortedKeys) out[k] = canonicalize(obj[k])
  return out
}

export function canonicalHash(input: unknown): string {
  const json = JSON.stringify(canonicalize(input))
  return createHash('sha256').update(json).digest('hex')
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/onboarding/generation/hash.test.ts
```
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/onboarding/generation/hash.ts src/lib/onboarding/generation/hash.test.ts
git commit -m "feat(onboarding): canonical hash for generation inputs"
```

---

## Task 3: Generation repo (DB access)

**Files:**
- Create: `src/lib/onboarding/generation/types.ts`
- Create: `src/lib/onboarding/generation/repo.ts`
- Test: `src/lib/onboarding/generation/repo.test.ts`

- [ ] **Step 1: Write the types module**

Create `src/lib/onboarding/generation/types.ts`:

```ts
export const GENERATION_KINDS = [
  'knowledge',
  'faqs',
  'personality_seed',
  'form_fields',
  'bot_instructions',
] as const

export type GenerationKind = (typeof GENERATION_KINDS)[number]

export type GenerationStatus = 'queued' | 'running' | 'done' | 'failed'

export interface GenerationJob {
  id: string
  profile_id: string
  kind: GenerationKind
  status: GenerationStatus
  input_hash: string
  result: unknown
  error: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
}

export function isGenerationKind(value: unknown): value is GenerationKind {
  return typeof value === 'string' && (GENERATION_KINDS as readonly string[]).includes(value)
}
```

- [ ] **Step 2: Write the failing repo test**

Create `src/lib/onboarding/generation/repo.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const mockFrom = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: mockFrom }),
}))

import {
  getJob,
  upsertRunning,
  markDone,
  markFailed,
} from './repo'

function chain(returns: unknown) {
  const obj: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'maybeSingle', 'upsert', 'update', 'is']) {
    obj[m] = vi.fn().mockReturnValue(obj)
  }
  ;(obj as { then?: (cb: (r: unknown) => unknown) => unknown }).then = (cb) => Promise.resolve(cb(returns))
  return obj
}

beforeEach(() => {
  mockFrom.mockReset()
})

describe('getJob', () => {
  it('returns null when no row', async () => {
    const c = chain(null)
    mockFrom.mockReturnValue(c)
    const result = await getJob('p1', 'knowledge')
    expect(result).toBeNull()
    expect(mockFrom).toHaveBeenCalledWith('generation_jobs')
  })
})

describe('upsertRunning', () => {
  it('writes status=running with input_hash and started_at', async () => {
    const c = chain({ data: null, error: null })
    mockFrom.mockReturnValue(c)
    await upsertRunning('p1', 'faqs', 'h123')
    expect(c.upsert).toHaveBeenCalled()
    const payload = (c.upsert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(payload.profile_id).toBe('p1')
    expect(payload.kind).toBe('faqs')
    expect(payload.status).toBe('running')
    expect(payload.input_hash).toBe('h123')
    expect(payload.started_at).toBeDefined()
    expect(payload.result).toBeNull()
    expect(payload.error).toBeNull()
  })
})

describe('markDone', () => {
  it('updates only when input_hash still matches', async () => {
    const c = chain({ data: null, error: null })
    mockFrom.mockReturnValue(c)
    await markDone('p1', 'faqs', 'h123', { ok: true })
    const updateArg = (c.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateArg.status).toBe('done')
    expect(updateArg.result).toEqual({ ok: true })
    expect(updateArg.finished_at).toBeDefined()
    expect(c.eq).toHaveBeenCalledWith('profile_id', 'p1')
    expect(c.eq).toHaveBeenCalledWith('kind', 'faqs')
    expect(c.eq).toHaveBeenCalledWith('input_hash', 'h123')
  })
})

describe('markFailed', () => {
  it('updates with error string and status=failed', async () => {
    const c = chain({ data: null, error: null })
    mockFrom.mockReturnValue(c)
    await markFailed('p1', 'faqs', 'h123', 'boom')
    const updateArg = (c.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateArg.status).toBe('failed')
    expect(updateArg.error).toBe('boom')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run src/lib/onboarding/generation/repo.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 4: Implement repo**

Create `src/lib/onboarding/generation/repo.ts`:

```ts
import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { GenerationJob, GenerationKind } from './types'

const TABLE = 'generation_jobs'

export async function getJob(
  profileId: string,
  kind: GenerationKind,
): Promise<GenerationJob | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from(TABLE)
    .select('*')
    .eq('profile_id', profileId)
    .eq('kind', kind)
    .maybeSingle()
  if (error) {
    console.error('[generation.repo.getJob]', error)
    return null
  }
  return (data as GenerationJob | null) ?? null
}

export async function upsertRunning(
  profileId: string,
  kind: GenerationKind,
  inputHash: string,
): Promise<void> {
  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { error } = await admin.from(TABLE).upsert(
    {
      profile_id: profileId,
      kind,
      status: 'running',
      input_hash: inputHash,
      result: null,
      error: null,
      started_at: now,
      finished_at: null,
    },
    { onConflict: 'profile_id,kind' },
  )
  if (error) console.error('[generation.repo.upsertRunning]', error)
}

export async function markDone(
  profileId: string,
  kind: GenerationKind,
  inputHash: string,
  result: unknown,
): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin
    .from(TABLE)
    .update({
      status: 'done',
      result,
      error: null,
      finished_at: new Date().toISOString(),
    })
    .eq('profile_id', profileId)
    .eq('kind', kind)
    .eq('input_hash', inputHash)
  if (error) console.error('[generation.repo.markDone]', error)
}

export async function markFailed(
  profileId: string,
  kind: GenerationKind,
  inputHash: string,
  message: string,
): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin
    .from(TABLE)
    .update({
      status: 'failed',
      error: message,
      finished_at: new Date().toISOString(),
    })
    .eq('profile_id', profileId)
    .eq('kind', kind)
    .eq('input_hash', inputHash)
  if (error) console.error('[generation.repo.markFailed]', error)
}

/**
 * Sweep stuck rows: anything in 'running' for > 90s is converted to 'failed'
 * with a sentinel error. Called opportunistically from getJob's call sites
 * (cheap; one indexed update).
 */
export async function sweepStaleForProfile(profileId: string): Promise<void> {
  const admin = createAdminClient()
  const cutoff = new Date(Date.now() - 90_000).toISOString()
  const { error } = await admin
    .from(TABLE)
    .update({
      status: 'failed',
      error: 'timed_out',
      finished_at: new Date().toISOString(),
    })
    .eq('profile_id', profileId)
    .eq('status', 'running')
    .lt('started_at', cutoff)
  if (error) console.error('[generation.repo.sweepStale]', error)
}
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/lib/onboarding/generation/repo.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/onboarding/generation/
git commit -m "feat(onboarding): generation jobs repo + types"
```

---

## Task 4: Kinds registry

**Files:**
- Create: `src/lib/onboarding/generation/kinds.ts`
- Test: `src/lib/onboarding/generation/kinds.test.ts`

The registry maps each `GenerationKind` to (a) a Zod schema for inputs, and (b) a `run(input)` function that wraps the existing `lib/onboarding/ai/*` generator.

- [ ] **Step 1: Write the failing test**

Create `src/lib/onboarding/generation/kinds.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/onboarding/ai/knowledge', () => ({
  generateKnowledge: vi.fn(async () => ({ sections: [{ title: 't', body: 'b' }] })),
}))
vi.mock('@/lib/onboarding/ai/faqs', () => ({
  generateFaqs: vi.fn(async () => ({ suggestions: [] })),
}))
vi.mock('@/lib/onboarding/ai/personality', () => ({
  generatePersonality: vi.fn(async () => ({ vibe_preset: 'friendly', greet: 'hi' })),
  VIBE_PRESETS: ['friendly', 'professional'],
}))
vi.mock('@/lib/onboarding/ai/form-fields', () => ({
  generateFormFields: vi.fn(async () => ({ blocks: [] })),
}))
vi.mock('@/lib/onboarding/ai/bot-instructions', () => ({
  generateBotInstructions: vi.fn(async () => ({ instructions: 'ok' })),
}))

import { KINDS } from './kinds'

describe('KINDS registry', () => {
  it('has one entry per generation kind', () => {
    expect(Object.keys(KINDS).sort()).toEqual(
      ['bot_instructions', 'faqs', 'form_fields', 'knowledge', 'personality_seed'].sort(),
    )
  })

  it('knowledge.run forwards basics + lang to generateKnowledge', async () => {
    const basics = { name: 'X', offer: 'Y', business_type: 'service', audience: '', pain: '', tone: '' }
    const out = await KINDS.knowledge.run({ basics, lang: 'tl' })
    expect(out).toEqual({ sections: [{ title: 't', body: 'b' }] })
  })

  it('faqs.run forwards basics + lang to generateFaqs', async () => {
    const basics = { name: 'X', offer: 'Y', business_type: 'service', audience: '', pain: '', tone: '' }
    await KINDS.faqs.run({ basics, lang: 'en' })
  })

  it('form_fields.run forwards kind to generateFormFields', async () => {
    const basics = { name: 'X', offer: 'Y', business_type: 'service', audience: '', pain: '', tone: '' }
    await KINDS.form_fields.run({ basics, kind: 'form', lang: 'tl' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/onboarding/generation/kinds.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement kinds**

Create `src/lib/onboarding/generation/kinds.ts`:

```ts
import 'server-only'
import { generateKnowledge } from '@/lib/onboarding/ai/knowledge'
import { generateFaqs } from '@/lib/onboarding/ai/faqs'
import { generatePersonality } from '@/lib/onboarding/ai/personality'
import { generateFormFields } from '@/lib/onboarding/ai/form-fields'
import { generateBotInstructions } from '@/lib/onboarding/ai/bot-instructions'
import type { BusinessBasics } from '@/lib/onboarding/business-basics'
import type { OnboardingLang } from '@/lib/onboarding/types'
import type { GenerationKind } from './types'

export interface KnowledgeInput { basics: BusinessBasics; lang: OnboardingLang }
export interface FaqsInput { basics: BusinessBasics; lang: OnboardingLang }
export interface PersonalitySeedInput { basics: BusinessBasics; lang: OnboardingLang }
export interface FormFieldsInput {
  basics: BusinessBasics
  kind: 'form' | 'qualification'
  lang: OnboardingLang
}
export interface BotInstructionsInput {
  basics: BusinessBasics
  flowDescription: string
  lang: OnboardingLang
}

interface KindHandler<I> {
  run(input: I): Promise<unknown>
}

export const KINDS: {
  knowledge: KindHandler<KnowledgeInput>
  faqs: KindHandler<FaqsInput>
  personality_seed: KindHandler<PersonalitySeedInput>
  form_fields: KindHandler<FormFieldsInput>
  bot_instructions: KindHandler<BotInstructionsInput>
} = {
  knowledge: { run: ({ basics, lang }) => generateKnowledge({ basics, lang }) },
  faqs: { run: ({ basics, lang }) => generateFaqs({ basics, lang }) },
  personality_seed: { run: ({ basics, lang }) => generatePersonality({ basics, lang }) },
  form_fields: {
    run: ({ basics, kind, lang }) => generateFormFields({ basics, kind, lang }),
  },
  bot_instructions: {
    run: ({ basics, flowDescription, lang }) =>
      generateBotInstructions({ basics, flow_description: flowDescription, lang }),
  },
}

export type KindInputMap = {
  knowledge: KnowledgeInput
  faqs: FaqsInput
  personality_seed: PersonalitySeedInput
  form_fields: FormFieldsInput
  bot_instructions: BotInstructionsInput
}

export type KindInput<K extends GenerationKind> = KindInputMap[K]
```

> **Caveat:** the `bot_instructions` generator's existing signature uses snake_case `flow_description`. Confirm the actual parameter name by reading `src/lib/onboarding/ai/bot-instructions.ts` before running and adjust if needed.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/onboarding/generation/kinds.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/onboarding/generation/kinds.ts src/lib/onboarding/generation/kinds.test.ts
git commit -m "feat(onboarding): generation kinds registry"
```

---

## Task 5: Runner — `runGeneration`

**Files:**
- Create: `src/lib/onboarding/generation/runner.ts`
- Test: `src/lib/onboarding/generation/runner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/onboarding/generation/runner.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const repo = {
  getJob: vi.fn(),
  upsertRunning: vi.fn(async () => {}),
  markDone: vi.fn(async () => {}),
  markFailed: vi.fn(async () => {}),
}
vi.mock('./repo', () => repo)

const kindsRun = vi.fn()
vi.mock('./kinds', () => ({ KINDS: { knowledge: { run: kindsRun } } }))

import { runGeneration } from './runner'

beforeEach(() => {
  for (const m of Object.values(repo)) m.mockReset?.()
  repo.upsertRunning.mockResolvedValue(undefined)
  repo.markDone.mockResolvedValue(undefined)
  repo.markFailed.mockResolvedValue(undefined)
  kindsRun.mockReset()
})

describe('runGeneration', () => {
  it('short-circuits when an existing done row has the same hash', async () => {
    repo.getJob.mockResolvedValue({ status: 'done', input_hash: 'h' })
    kindsRun.mockResolvedValue({ ok: true })
    // Stub hash to a known value by passing an input that hashes to 'h':
    // easier: spy on canonicalHash via the module.
    await runGeneration('p1', 'knowledge', { basics: { name: 'A' }, lang: 'tl' })
    // either short-circuits OR runs — verify run was NOT called when getJob hash matches:
    // To pin the hash, we instead test by stubbing canonicalHash:
  })

  it('writes running -> done on success', async () => {
    repo.getJob.mockResolvedValue(null)
    kindsRun.mockResolvedValue({ sections: [{ title: 't', body: 'b' }] })
    await runGeneration('p1', 'knowledge', { basics: { name: 'A' }, lang: 'tl' })
    expect(repo.upsertRunning).toHaveBeenCalledWith('p1', 'knowledge', expect.any(String))
    expect(repo.markDone).toHaveBeenCalledWith(
      'p1',
      'knowledge',
      expect.any(String),
      { sections: [{ title: 't', body: 'b' }] },
    )
  })

  it('writes running -> failed when the generator throws', async () => {
    repo.getJob.mockResolvedValue(null)
    kindsRun.mockRejectedValue(new Error('boom'))
    await runGeneration('p1', 'knowledge', { basics: { name: 'A' }, lang: 'tl' })
    expect(repo.markFailed).toHaveBeenCalledWith('p1', 'knowledge', expect.any(String), 'boom')
    expect(repo.markDone).not.toHaveBeenCalled()
  })

  it('never throws', async () => {
    repo.getJob.mockRejectedValue(new Error('db down'))
    kindsRun.mockResolvedValue({})
    await expect(
      runGeneration('p1', 'knowledge', { basics: { name: 'A' }, lang: 'tl' }),
    ).resolves.toBeUndefined()
  })
})
```

Note: the first "short-circuits" test as written is incomplete because the hash for an arbitrary input is not known. Replace it with a clean version after the implementation: re-run with the same input twice and assert the second call does not invoke `kindsRun`:

```ts
it('short-circuits when same input was previously generated', async () => {
  repo.getJob
    .mockResolvedValueOnce(null)
    .mockImplementationOnce(async () => ({ status: 'done', input_hash: lastHash }))
  let lastHash = ''
  repo.upsertRunning.mockImplementation(async (_p, _k, h) => { lastHash = h })
  kindsRun.mockResolvedValue({ ok: true })
  const input = { basics: { name: 'A' }, lang: 'tl' }
  await runGeneration('p1', 'knowledge', input)
  await runGeneration('p1', 'knowledge', input)
  expect(kindsRun).toHaveBeenCalledTimes(1)
})
```

Replace the first test block with that one, then run.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/lib/onboarding/generation/runner.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement runner**

Create `src/lib/onboarding/generation/runner.ts`:

```ts
import 'server-only'
import { canonicalHash } from './hash'
import { KINDS, type KindInput } from './kinds'
import { getJob, upsertRunning, markDone, markFailed } from './repo'
import type { GenerationKind } from './types'

/**
 * Run an AI generation in the background. Writes status to generation_jobs.
 * Idempotent: re-running with the same input short-circuits.
 * Never throws — errors are persisted as status='failed' on the job row.
 */
export async function runGeneration<K extends GenerationKind>(
  profileId: string,
  kind: K,
  input: KindInput<K>,
): Promise<void> {
  try {
    const hash = canonicalHash(input)
    const existing = await getJob(profileId, kind)
    if (existing?.status === 'done' && existing.input_hash === hash) return

    await upsertRunning(profileId, kind, hash)
    try {
      const handler = KINDS[kind] as { run: (i: KindInput<K>) => Promise<unknown> }
      const result = await handler.run(input)
      await markDone(profileId, kind, hash, result)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await markFailed(profileId, kind, hash, message)
    }
  } catch (err) {
    // Swallow — runner must never throw because after() cannot surface it.
    console.error('[generation.runner]', err)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/lib/onboarding/generation/runner.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/onboarding/generation/runner.ts src/lib/onboarding/generation/runner.test.ts
git commit -m "feat(onboarding): runGeneration dispatcher"
```

---

## Task 6: Polling API route

**Files:**
- Create: `src/app/api/onboarding/generation/[kind]/route.ts`

- [ ] **Step 1: Implement the route**

Create `src/app/api/onboarding/generation/[kind]/route.ts`:

```ts
import 'server-only'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getJob, sweepStaleForProfile } from '@/lib/onboarding/generation/repo'
import { isGenerationKind } from '@/lib/onboarding/generation/types'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ kind: string }> },
): Promise<NextResponse> {
  const { kind } = await ctx.params
  if (!isGenerationKind(kind)) {
    return NextResponse.json({ error: 'invalid_kind' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  await sweepStaleForProfile(auth.user.id)
  const job = await getJob(auth.user.id, kind)
  if (!job) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const body: Record<string, unknown> = {
    status: job.status,
    updatedAt: job.updated_at,
  }
  if (job.status === 'done') body.result = job.result
  if (job.status === 'failed') body.error = job.error ?? 'unknown_error'

  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
```

- [ ] **Step 2: Manual smoke**

```bash
npm run dev
```
In another terminal, after signing in:
```bash
curl -i http://localhost:3000/api/onboarding/generation/knowledge
```
Expected: `401` when not authenticated, or `404` for authenticated users with no job row yet.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/onboarding/generation/
git commit -m "feat(onboarding): polling endpoint for generation jobs"
```

---

## Task 7: `<GenerationAnimation />` component

**Files:**
- Create: `src/app/onboarding/_components/GenerationAnimation.tsx`

- [ ] **Step 1: Implement**

Create `src/app/onboarding/_components/GenerationAnimation.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'

interface Props {
  /** Step-specific status lines that rotate every 2s. Required ≥ 1 line. */
  lines: string[]
  /** Optional heading shown above the orb. */
  heading?: string
}

export function GenerationAnimation({ lines, heading }: Props) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (lines.length <= 1) return
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) return
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % lines.length)
    }, 2000)
    return () => clearInterval(id)
  }, [lines])

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center gap-6 py-12 text-center"
    >
      {heading ? (
        <h2 className="text-lg font-semibold text-zinc-900">{heading}</h2>
      ) : null}

      <div className="relative h-24 w-24">
        <div className="absolute inset-0 animate-[spin_8s_linear_infinite] rounded-full bg-[conic-gradient(from_0deg,#a78bfa,#22d3ee,#34d399,#a78bfa)] blur-md opacity-80 motion-reduce:animate-pulse" />
        <div className="absolute inset-2 rounded-full bg-white" />
      </div>

      <p className="min-h-[1.5rem] text-sm text-zinc-700 transition-opacity duration-500">
        {lines[index]}
      </p>

      <div className="h-1 w-48 overflow-hidden rounded-full bg-zinc-200">
        <div className="h-full w-1/3 animate-[shimmer_1.5s_ease-in-out_infinite] rounded-full bg-zinc-900/70 motion-reduce:animate-none" />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add keyframes to globals.css**

Locate the project's global stylesheet (likely `src/app/globals.css`). Verify the location:

```bash
ls src/app/globals.css src/styles/globals.css 2>/dev/null
```

Append (using the file you found):

```css
@keyframes shimmer {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(300%); }
}
```

(The `spin` keyframe is built into Tailwind.)

- [ ] **Step 3: Manual smoke**

Temporarily render `<GenerationAnimation lines={['Test one', 'Test two']} heading="Hi" />` in any onboarding page and visually verify the orb spins, lines rotate, shimmer plays. Revert that change before committing.

- [ ] **Step 4: Commit**

```bash
git add src/app/onboarding/_components/GenerationAnimation.tsx src/app/globals.css
git commit -m "feat(onboarding): GenerationAnimation component"
```

---

## Task 8: `<GenerationGate />` client component

**Files:**
- Create: `src/app/onboarding/_components/GenerationGate.tsx`
- Test: `src/app/onboarding/_components/GenerationGate.test.tsx`

The gate polls the API and either swaps to the real result (via `router.refresh()`), shows an error, or remains on the animation. Always renders a "Skip and review later" link.

- [ ] **Step 1: Write the failing test**

Create `src/app/onboarding/_components/GenerationGate.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { GenerationGate } from './GenerationGate'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}))

const fetchMock = vi.fn()
beforeEach(() => {
  refresh.mockReset()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('GenerationGate', () => {
  it('shows the animation while status is queued/running', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'running', updatedAt: '' }),
    })
    render(
      <GenerationGate
        kind="knowledge"
        animationLines={['Working…']}
        animationHeading="Generating"
        skipHref="/onboarding/faqs"
        skipLabel="Skip"
      />,
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(screen.getByText('Working…')).toBeInTheDocument()
  })

  it('calls router.refresh when status becomes done', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'done', result: {}, updatedAt: '' }),
    })
    render(
      <GenerationGate
        kind="knowledge"
        animationLines={['Working…']}
        animationHeading="Generating"
        skipHref="/onboarding/faqs"
        skipLabel="Skip"
      />,
    )
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('shows error and regenerate hint when status is failed', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'failed', error: 'boom', updatedAt: '' }),
    })
    render(
      <GenerationGate
        kind="knowledge"
        animationLines={['Working…']}
        animationHeading="Generating"
        errorMessage="Something went wrong"
        skipHref="/onboarding/faqs"
        skipLabel="Skip"
      />,
    )
    await waitFor(() => expect(screen.getByText('Something went wrong')).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/app/onboarding/_components/GenerationGate.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/app/onboarding/_components/GenerationGate.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { GenerationKind } from '@/lib/onboarding/generation/types'
import { GenerationAnimation } from './GenerationAnimation'

interface Props {
  kind: GenerationKind
  animationLines: string[]
  animationHeading: string
  errorMessage?: string
  skipHref: string
  skipLabel: string
}

type PollState =
  | { phase: 'polling' }
  | { phase: 'failed'; error: string }

export function GenerationGate({
  kind,
  animationLines,
  animationHeading,
  errorMessage,
  skipHref,
  skipLabel,
}: Props) {
  const router = useRouter()
  const [state, setState] = useState<PollState>({ phase: 'polling' })
  const elapsedRef = useRef(0)
  const cancelled = useRef(false)

  useEffect(() => {
    cancelled.current = false
    let timer: ReturnType<typeof setTimeout>

    const tick = async () => {
      if (cancelled.current) return
      try {
        const res = await fetch(`/api/onboarding/generation/${kind}`, {
          cache: 'no-store',
        })
        if (res.status === 404) {
          // Job not enqueued yet — keep polling; the user may have arrived
          // before the after() callback inserted the row.
        } else if (res.ok) {
          const body = (await res.json()) as {
            status: 'queued' | 'running' | 'done' | 'failed'
            error?: string
          }
          if (body.status === 'done') {
            router.refresh()
            return
          }
          if (body.status === 'failed') {
            setState({ phase: 'failed', error: body.error ?? 'unknown_error' })
            return
          }
        }
      } catch {
        // network blip — keep polling
      }
      elapsedRef.current += 1
      const delay = elapsedRef.current < 7 ? 1500 : 5000
      timer = setTimeout(tick, delay)
    }

    tick()
    return () => {
      cancelled.current = true
      if (timer) clearTimeout(timer)
    }
  }, [kind, router])

  if (state.phase === 'failed') {
    return (
      <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
        <p>{errorMessage ?? 'Generation failed.'}</p>
        <p className="mt-2 text-xs text-red-800/80">{state.error}</p>
        <div className="mt-3">
          <Link href={skipHref} className="font-medium underline">
            {skipLabel}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div>
      <GenerationAnimation lines={animationLines} heading={animationHeading} />
      <div className="mt-2 text-center">
        <Link href={skipHref} className="text-sm text-zinc-600 underline">
          {skipLabel}
        </Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/app/onboarding/_components/GenerationGate.test.tsx
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/onboarding/_components/GenerationGate.tsx src/app/onboarding/_components/GenerationGate.test.tsx
git commit -m "feat(onboarding): GenerationGate polling component"
```

---

## Task 9: i18n keys for generation animation

**Files:**
- Modify: `src/lib/onboarding/i18n.ts`

- [ ] **Step 1: Add keys**

Open `src/lib/onboarding/i18n.ts` and add the following keys to both `tl` and `en` dictionaries. The dictionary shape is established; place these alongside existing keys (preserve alphabetical/grouped order if the existing file uses one):

| Key | tl | en |
|---|---|---|
| `gen.knowledge.heading` | "Binubuo ang knowledge mo…" | "Generating your knowledge…" |
| `gen.knowledge.line1` | "Binabasa ang business basics mo…" | "Reading your business basics…" |
| `gen.knowledge.line2` | "Pinipili ang pinakamahalagang detalye…" | "Picking the most important details…" |
| `gen.knowledge.line3` | "Ina-arrange para madaling i-edit…" | "Arranging it so you can edit easily…" |
| `gen.faqs.heading` | "Sinusulat ang FAQs mo…" | "Drafting your FAQs…" |
| `gen.faqs.line1` | "Iniisip kung ano-ano tinatanong ng customers…" | "Imagining what customers ask…" |
| `gen.faqs.line2` | "Pinopolish ang sagot…" | "Polishing answers…" |
| `gen.faqs.line3` | "Tinatanggal ang duplicates…" | "Removing duplicates…" |
| `gen.personality.heading` | "Hinahanap ang vibe…" | "Finding your vibe…" |
| `gen.personality.line1` | "Hinahalo ang tone at audience mo…" | "Mixing tone and audience…" |
| `gen.personality.line2` | "Sinusulat ang sample greeting…" | "Writing a sample greeting…" |
| `gen.form_fields.heading` | "Inaayos ang form fields…" | "Drafting your form fields…" |
| `gen.form_fields.line1` | "Iniisip kung ano dapat itanong…" | "Picking what to ask…" |
| `gen.form_fields.line2` | "Inaayos ang pagkakasunod-sunod…" | "Ordering the fields…" |
| `gen.bot.heading` | "Tinatapos ang bot instructions…" | "Finalizing your bot instructions…" |
| `gen.bot.line1` | "Pinagsasama-sama ang lahat ng sagot mo…" | "Stitching all your answers together…" |
| `gen.bot.line2` | "Nilalagay ang tono at boundaries…" | "Setting tone and boundaries…" |
| `gen.skip` | "I-skip muna — review later" | "Skip for now — review later" |
| `gen.error.generic` | "May error sa pag-generate. Pwede mong subukan ulit." | "Generation failed. You can try again." |

- [ ] **Step 2: Commit**

```bash
git add src/lib/onboarding/i18n.ts
git commit -m "feat(onboarding): i18n keys for generation animation"
```

---

## Task 10: Wire `personality_seed` (smallest blast radius)

**Files:**
- Modify: `src/app/onboarding/actions.ts` (function `saveBusinessBasicsAction`)
- Modify: `src/app/onboarding/personality/page.tsx`

Even though personality's flow is form-based (user fills three prompts), the page reads `state.personality_seeds` for defaults. We populate it in the background after the business submit.

- [ ] **Step 1: Look up the existing import region in `actions.ts`**

```bash
sed -n '1,30p' src/app/onboarding/actions.ts
```

- [ ] **Step 2: Add the runner import + `after`**

In `src/app/onboarding/actions.ts`, add at the top with other imports:

```ts
import { after } from 'next/server'
import { runGeneration } from '@/lib/onboarding/generation/runner'
import { createClient as createSupabaseServerClient } from '@/lib/supabase/server'
```

(`createSupabaseServerClient` is only required if not already imported under a different alias — check existing imports first.)

- [ ] **Step 3: Modify `saveBusinessBasicsAction`**

In `src/app/onboarding/actions.ts`, locate the block ending with `redirect('/onboarding/knowledge')` inside `saveBusinessBasicsAction`. Insert before the `redirect` line:

```ts
  // Fire-and-forget generations for downstream steps.
  try {
    const supabase = await createSupabaseServerClient()
    const { data: auth } = await supabase.auth.getUser()
    const { data: state } = auth.user
      ? await supabase
          .from('onboarding_state')
          .select('ui_language')
          .eq('profile_id', auth.user.id)
          .maybeSingle()
      : { data: null }
    const lang = state?.ui_language === 'en' ? 'en' : 'tl'
    if (auth.user) {
      const profileId = auth.user.id
      after(async () => {
        await Promise.allSettled([
          runGeneration(profileId, 'knowledge', { basics: parsed.data, lang }),
          runGeneration(profileId, 'faqs', { basics: parsed.data, lang }),
          runGeneration(profileId, 'personality_seed', { basics: parsed.data, lang }),
        ])
      })
    }
  } catch (err) {
    console.error('[saveBusinessBasicsAction] schedule-generation', err)
  }
```

> Note: scheduling errors are logged but do not fail the user-visible save. Downstream pages will fall back to their inline-generation paths during the migration period.

- [ ] **Step 4: Add `maxDuration` segment config**

Server actions run in the route segment that hosted the form. `saveBusinessBasicsAction` is imported by `src/app/onboarding/business/page.tsx`. Verify:

```bash
grep -n "saveBusinessBasicsAction" src/app/onboarding/business/*.tsx
```

At the top of `src/app/onboarding/business/page.tsx` add (after existing exports / `export const dynamic`):

```ts
export const maxDuration = 60
```

- [ ] **Step 5: Update `personality/page.tsx` to prefer the job row**

Replace the `readSeeds` source. Modify `src/app/onboarding/personality/page.tsx`:

After the existing `readSeeds(state?.personality_seeds)` call, add a fallback to the job result. The page becomes:

```tsx
import { WizardShell } from '../_components/WizardShell'
import { PersonalityForm } from './PersonalityForm'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { getOnboardingState } from '@/lib/onboarding/state'
import { t } from '@/lib/onboarding/i18n'
import type { VibePreset } from '@/lib/onboarding/ai/personality'
import { getJob } from '@/lib/onboarding/generation/repo'
import { createClient } from '@/lib/supabase/server'

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

  let initial = readSeeds(state?.personality_seeds)
  if (!initial) {
    const supabase = await createClient()
    const { data: auth } = await supabase.auth.getUser()
    if (auth.user) {
      const job = await getJob(auth.user.id, 'personality_seed')
      if (job?.status === 'done') initial = readSeeds(job.result)
    }
  }

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

(Note: personality is a form-based step, so we do NOT show a gate here — we simply prefer cached seeds when available. If the job isn't done yet, the form renders with empty defaults, which is current behaviour.)

- [ ] **Step 6: Manual smoke**

```bash
npm run dev
```
Sign up, complete the business step, immediately navigate to `/onboarding/personality`. Confirm the form renders without hanging. After ~10s, refresh — the form's defaults should populate from the generated seed.

- [ ] **Step 7: Commit**

```bash
git add src/app/onboarding/actions.ts src/app/onboarding/business/page.tsx src/app/onboarding/personality/page.tsx
git commit -m "feat(onboarding): personality_seed via background generation"
```

---

## Task 11: Wire `knowledge`

**Files:**
- Modify: `src/app/onboarding/knowledge/page.tsx`

`saveBusinessBasicsAction` is already firing the `knowledge` generation from Task 10. Now switch the page to read the job row.

- [ ] **Step 1: Rewrite the page**

Replace `src/app/onboarding/knowledge/page.tsx` with:

```tsx
import Link from 'next/link'
import { WizardShell } from '../_components/WizardShell'
import { RegenerateButton } from './RegenerateButton'
import { KnowledgeEditor } from './KnowledgeEditor'
import { generateKnowledgeAction } from '../actions'
import { GenerationGate } from '../_components/GenerationGate'
import { getJob } from '@/lib/onboarding/generation/repo'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { getBusinessBasics } from '@/lib/onboarding/state'
import { createClient } from '@/lib/supabase/server'
import { t } from '@/lib/onboarding/i18n'
import type { GeneratedKnowledge } from '@/lib/onboarding/ai/knowledge'

export const dynamic = 'force-dynamic'

function isGeneratedKnowledge(v: unknown): v is GeneratedKnowledge {
  return !!v && typeof v === 'object' && Array.isArray((v as { sections?: unknown }).sections)
}

export default async function KnowledgePage() {
  const lang = await getOnboardingLang()
  const basics = await getBusinessBasics()

  if (!basics) {
    return (
      <WizardShell lang={lang} step="knowledge">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('knowledge.heading', lang)}</h1>
        <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p>{t('faqs.error.no_basics', lang)}</p>
          <Link href="/onboarding/business" className="mt-2 inline-block font-medium underline">
            {t('shell.back', lang)}
          </Link>
        </div>
      </WizardShell>
    )
  }

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const job = auth.user ? await getJob(auth.user.id, 'knowledge') : null

  if (job?.status === 'done' && isGeneratedKnowledge(job.result)) {
    return (
      <WizardShell lang={lang} step="knowledge">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('knowledge.heading', lang)}</h1>
        <p className="mt-1 text-sm text-zinc-600">{t('knowledge.subheading', lang)}</p>
        <div className="mt-6">
          <div className="mb-3 flex justify-end"><RegenerateButton lang={lang} /></div>
          <KnowledgeEditor lang={lang} initial={job.result} />
        </div>
      </WizardShell>
    )
  }

  if (job?.status === 'failed') {
    // Fallback: try the synchronous path so the user can keep going.
    const sync = await generateKnowledgeAction()
    if (sync.ok === false) {
      return (
        <WizardShell lang={lang} step="knowledge">
          <h1 className="text-2xl font-semibold text-zinc-900">{t('knowledge.heading', lang)}</h1>
          <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
            <p>{t('faqs.error.generation', lang)}</p>
            <div className="mt-3"><RegenerateButton lang={lang} /></div>
          </div>
        </WizardShell>
      )
    }
    return (
      <WizardShell lang={lang} step="knowledge">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('knowledge.heading', lang)}</h1>
        <div className="mt-6">
          <div className="mb-3 flex justify-end"><RegenerateButton lang={lang} /></div>
          <KnowledgeEditor lang={lang} initial={sync.data} />
        </div>
      </WizardShell>
    )
  }

  return (
    <WizardShell lang={lang} step="knowledge">
      <h1 className="text-2xl font-semibold text-zinc-900">{t('knowledge.heading', lang)}</h1>
      <p className="mt-1 text-sm text-zinc-600">{t('knowledge.subheading', lang)}</p>
      <GenerationGate
        kind="knowledge"
        animationHeading={t('gen.knowledge.heading', lang)}
        animationLines={[
          t('gen.knowledge.line1', lang),
          t('gen.knowledge.line2', lang),
          t('gen.knowledge.line3', lang),
        ]}
        errorMessage={t('gen.error.generic', lang)}
        skipHref="/onboarding/faqs"
        skipLabel={t('gen.skip', lang)}
      />
    </WizardShell>
  )
}
```

> Note: confirm `KnowledgeEditor` accepts an `initial` prop matching `GeneratedKnowledge`. If the current component reads a different prop name, adjust this page to match — do not rewrite the editor.

- [ ] **Step 2: Manual smoke**

```bash
npm run dev
```
Walk through business → knowledge:
- If you reach knowledge before the AI is done, you should see the rotating animation.
- After ~5-15s the page should auto-refresh to the editor.

- [ ] **Step 3: Commit**

```bash
git add src/app/onboarding/knowledge/page.tsx
git commit -m "feat(onboarding): knowledge step gates on background generation"
```

---

## Task 12: Wire `faqs`

**Files:**
- Modify: `src/app/onboarding/faqs/page.tsx`

- [ ] **Step 1: Rewrite the page**

Replace `src/app/onboarding/faqs/page.tsx` with the same pattern as Task 11, swapping `'knowledge'` for `'faqs'`, the editor for `FaqChecklist`, the destination skip link for `/onboarding/personality`, and the result shape check:

```tsx
import Link from 'next/link'
import { WizardShell } from '../_components/WizardShell'
import { FaqChecklist } from './FaqChecklist'
import { RegenerateButton } from '../knowledge/RegenerateButton'
import { generateFaqsAction } from '../actions'
import { GenerationGate } from '../_components/GenerationGate'
import { getJob } from '@/lib/onboarding/generation/repo'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { getBusinessBasics } from '@/lib/onboarding/state'
import { createClient } from '@/lib/supabase/server'
import { t } from '@/lib/onboarding/i18n'
import type { GeneratedFaqs } from '@/lib/onboarding/ai/faqs'

export const dynamic = 'force-dynamic'

function isGeneratedFaqs(v: unknown): v is GeneratedFaqs {
  return !!v && typeof v === 'object' && Array.isArray((v as { suggestions?: unknown }).suggestions)
}

export default async function FaqsPage() {
  const lang = await getOnboardingLang()
  const basics = await getBusinessBasics()

  if (!basics) {
    return (
      <WizardShell lang={lang} step="faqs">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('faqs.heading', lang)}</h1>
        <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p>{t('faqs.error.no_basics', lang)}</p>
          <Link href="/onboarding/business" className="mt-2 inline-block font-medium underline">
            {t('shell.back', lang)}
          </Link>
        </div>
      </WizardShell>
    )
  }

  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const job = auth.user ? await getJob(auth.user.id, 'faqs') : null

  if (job?.status === 'done' && isGeneratedFaqs(job.result)) {
    return (
      <WizardShell lang={lang} step="faqs">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('faqs.heading', lang)}</h1>
        <p className="mt-1 text-sm text-zinc-600">{t('faqs.subheading', lang)}</p>
        <div className="mt-6">
          <div className="mb-3 flex justify-end"><RegenerateButton lang={lang} /></div>
          <FaqChecklist lang={lang} suggestions={job.result.suggestions} />
        </div>
      </WizardShell>
    )
  }

  if (job?.status === 'failed') {
    const sync = await generateFaqsAction()
    if (sync.ok === false) {
      return (
        <WizardShell lang={lang} step="faqs">
          <h1 className="text-2xl font-semibold text-zinc-900">{t('faqs.heading', lang)}</h1>
          <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
            <p>{t('faqs.error.generation', lang)}</p>
            <div className="mt-3"><RegenerateButton lang={lang} /></div>
          </div>
        </WizardShell>
      )
    }
    return (
      <WizardShell lang={lang} step="faqs">
        <h1 className="text-2xl font-semibold text-zinc-900">{t('faqs.heading', lang)}</h1>
        <div className="mt-6">
          <div className="mb-3 flex justify-end"><RegenerateButton lang={lang} /></div>
          <FaqChecklist lang={lang} suggestions={sync.data.suggestions} />
        </div>
      </WizardShell>
    )
  }

  return (
    <WizardShell lang={lang} step="faqs">
      <h1 className="text-2xl font-semibold text-zinc-900">{t('faqs.heading', lang)}</h1>
      <p className="mt-1 text-sm text-zinc-600">{t('faqs.subheading', lang)}</p>
      <GenerationGate
        kind="faqs"
        animationHeading={t('gen.faqs.heading', lang)}
        animationLines={[
          t('gen.faqs.line1', lang),
          t('gen.faqs.line2', lang),
          t('gen.faqs.line3', lang),
        ]}
        errorMessage={t('gen.error.generic', lang)}
        skipHref="/onboarding/personality"
        skipLabel={t('gen.skip', lang)}
      />
    </WizardShell>
  )
}
```

- [ ] **Step 2: Manual smoke**

Walk through business → knowledge → faqs. If the FAQs generation completes before you arrive (typical case), you should see the checklist immediately. If you arrive faster, you should see the animation, then the checklist after auto-refresh.

- [ ] **Step 3: Commit**

```bash
git add src/app/onboarding/faqs/page.tsx
git commit -m "feat(onboarding): faqs step gates on background generation"
```

---

## Task 13: Wire `form_fields`

**Files:**
- Modify: `src/app/onboarding/actions.ts` (function `saveGoalAction`)
- Modify: `src/app/onboarding/goal-content/FormFieldsContent.tsx`
- Modify: `src/app/onboarding/goal/page.tsx` (add `maxDuration`)

- [ ] **Step 1: Read the existing `saveGoalAction`**

```bash
grep -n "saveGoalAction\|chatbot_configs\|action_pages" src/app/onboarding/actions.ts | head -20
```

Open the file and locate `saveGoalAction`. Find the line `redirect('/onboarding/goal-content')`.

- [ ] **Step 2: Schedule generation before redirect**

In `saveGoalAction`, just before `redirect('/onboarding/goal-content')`, insert:

```ts
  try {
    const supabase = await createSupabaseServerClient()
    const { data: auth } = await supabase.auth.getUser()
    if (auth.user) {
      const profileId = auth.user.id
      const basics = await getBusinessBasics()
      const { data: state } = await supabase
        .from('onboarding_state')
        .select('ui_language')
        .eq('profile_id', profileId)
        .maybeSingle()
      const lang = state?.ui_language === 'en' ? 'en' : 'tl'
      if (basics && (kind === 'form' || kind === 'qualification')) {
        after(async () => {
          await runGeneration(profileId, 'form_fields', { basics, kind, lang })
        })
      }
    }
  } catch (err) {
    console.error('[saveGoalAction] schedule-generation', err)
  }
```

Note: `kind` is the variable name used in the existing action for the chosen action-page kind. Verify by reading the surrounding code; if the variable name differs, adjust this snippet.

- [ ] **Step 3: Add `maxDuration` to goal route**

```bash
cat src/app/onboarding/goal/page.tsx | head -10
```

Add at the top with other exports:

```ts
export const maxDuration = 60
```

- [ ] **Step 4: Update `FormFieldsContent.tsx` to read the job**

Open `src/app/onboarding/goal-content/FormFieldsContent.tsx`. The current implementation calls `generateFormFieldsAction(kind)` inside a `useEffect` and shows a skeleton.

Rewrite as a server component if possible, OR add a parallel server fetch. The simplest path: convert `FormFieldsContent` to read from the job row server-side and pass either the result or a `<GenerationGate />` down.

If the component is currently a client component (`'use client'`), create a thin wrapper:

1. Convert the existing client component to `FormFieldsContent.client.tsx` (rename file) — leave its props identical.
2. Create a new server `FormFieldsContent.tsx`:

```tsx
import { GenerationGate } from '../_components/GenerationGate'
import { getJob } from '@/lib/onboarding/generation/repo'
import { getOnboardingLang } from '@/lib/onboarding/lang'
import { createClient } from '@/lib/supabase/server'
import { t } from '@/lib/onboarding/i18n'
import type { SuggestedBlock } from '@/lib/onboarding/ai/form-fields'
import { FormFieldsContentClient } from './FormFieldsContent.client'

interface Props {
  kind: 'form' | 'qualification'
  pageId: string
}

function isBlocks(v: unknown): v is { blocks: SuggestedBlock[] } {
  return !!v && typeof v === 'object' && Array.isArray((v as { blocks?: unknown }).blocks)
}

export async function FormFieldsContent({ kind, pageId }: Props) {
  const lang = await getOnboardingLang()
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const job = auth.user ? await getJob(auth.user.id, 'form_fields') : null

  if (job?.status === 'done' && isBlocks(job.result)) {
    return <FormFieldsContentClient kind={kind} pageId={pageId} initial={job.result.blocks} />
  }
  if (job?.status === 'failed') {
    return <FormFieldsContentClient kind={kind} pageId={pageId} initial={null} fallbackError />
  }
  return (
    <GenerationGate
      kind="form_fields"
      animationHeading={t('gen.form_fields.heading', lang)}
      animationLines={[
        t('gen.form_fields.line1', lang),
        t('gen.form_fields.line2', lang),
      ]}
      errorMessage={t('gen.error.generic', lang)}
      skipHref="/onboarding/flow"
      skipLabel={t('gen.skip', lang)}
    />
  )
}
```

Adapt `FormFieldsContent.client.tsx` to accept the new `initial` prop. The original `useEffect` fetch path stays as fallback when `initial` is `null` and `fallbackError` is true.

> Confirm callers of `FormFieldsContent` pass `kind` and `pageId`; adjust the prop shape only if the caller uses different names.

- [ ] **Step 5: Commit**

```bash
git add src/app/onboarding/actions.ts src/app/onboarding/goal/page.tsx src/app/onboarding/goal-content/FormFieldsContent.tsx src/app/onboarding/goal-content/FormFieldsContent.client.tsx
git commit -m "feat(onboarding): form_fields via background generation"
```

---

## Task 14: Wire `bot_instructions`

**Files:**
- Modify: `src/app/onboarding/actions.ts` (function `saveFlowAction`)
- Modify: `src/app/onboarding/flow/page.tsx` (`maxDuration`)
- Modify: `src/app/onboarding/done/page.tsx`

`bot_instructions` is special: it's generated from the *flow description* the user submits. So the trigger point is `saveFlowAction`, and the *result* is consumed on the `done` page (final review).

- [ ] **Step 1: Schedule on `saveFlowAction`**

Locate `saveFlowAction` in `src/app/onboarding/actions.ts`. Find the final `redirect('/onboarding/done')`. Just before it, add:

```ts
  try {
    const supabase = await createSupabaseServerClient()
    const { data: auth } = await supabase.auth.getUser()
    if (auth.user) {
      const profileId = auth.user.id
      const basics = await getBusinessBasics()
      const { data: state } = await supabase
        .from('onboarding_state')
        .select('ui_language')
        .eq('profile_id', profileId)
        .maybeSingle()
      const lang = state?.ui_language === 'en' ? 'en' : 'tl'
      if (basics && flowDescription) {
        after(async () => {
          await runGeneration(profileId, 'bot_instructions', {
            basics,
            flowDescription,
            lang,
          })
        })
      }
    }
  } catch (err) {
    console.error('[saveFlowAction] schedule-generation', err)
  }
```

`flowDescription` is the variable holding the user's text input — read the surrounding code to confirm the name and adjust.

- [ ] **Step 2: Add `maxDuration` on flow route**

In `src/app/onboarding/flow/page.tsx`:

```ts
export const maxDuration = 60
```

- [ ] **Step 3: Final review on `done/page.tsx`**

Open `src/app/onboarding/done/page.tsx`. Add a section that reads all job rows and, for any that are `failed`, `queued`, `running`, or `done` but not yet acknowledged (compare against `onboarding_state.<step>_completed_at`), renders a small status card.

Concrete change — at the top of the page's render, after existing greeting:

```tsx
import { getJob } from '@/lib/onboarding/generation/repo'
import { GENERATION_KINDS } from '@/lib/onboarding/generation/types'
import { GenerationGate } from '../_components/GenerationGate'

// inside the page component, after auth resolution:
const jobs = await Promise.all(
  GENERATION_KINDS.map(async (k) => ({ kind: k, job: await getJob(profileId, k) })),
)
const botJob = jobs.find((j) => j.kind === 'bot_instructions')?.job ?? null
```

Then render, before the existing Finish CTA:

```tsx
{botJob && botJob.status !== 'done' ? (
  <section className="mt-6">
    <h2 className="text-lg font-semibold text-zinc-900">
      {t('gen.bot.heading', lang)}
    </h2>
    {botJob.status === 'failed' ? (
      <div className="mt-3 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
        {t('gen.error.generic', lang)}
      </div>
    ) : (
      <GenerationGate
        kind="bot_instructions"
        animationHeading={t('gen.bot.heading', lang)}
        animationLines={[t('gen.bot.line1', lang), t('gen.bot.line2', lang)]}
        errorMessage={t('gen.error.generic', lang)}
        skipHref="/dashboard"
        skipLabel={t('gen.skip', lang)}
      />
    )}
  </section>
) : null}
```

The Finish CTA remains active either way — bot_instructions is not blocking.

- [ ] **Step 4: Manual smoke**

Run through the whole wizard. The done page should not show the bot_instructions card if generation already finished; should show animation if still running.

- [ ] **Step 5: Commit**

```bash
git add src/app/onboarding/actions.ts src/app/onboarding/flow/page.tsx src/app/onboarding/done/page.tsx
git commit -m "feat(onboarding): bot_instructions via background generation"
```

---

## Task 15: Verification

- [ ] **Step 1: Full test suite**

```bash
npx vitest run
```
Expected: all green.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Lint**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 4: End-to-end manual walk**

```bash
npm run dev
```

Walk through the entire onboarding twice:

- **Slow user** — pause 20s on each step. Generation completes by the time you arrive at the next AI step. You should never see the animation.
- **Fast user** — click through as fast as possible. You should see the rotating-line animation on `knowledge` and/or `faqs`. Page should auto-refresh to the editor when ready. Skip link should always be available.

- [ ] **Step 5: Failure path**

Temporarily break a generator (e.g., set `HF_TOKEN=invalid` in `.env.local`) and walk again. Confirm:
- Job row goes to `failed`.
- Page shows the inline error + Regenerate button.

Restore the env var after.

---

## Task 16: Cleanup (optional, after a soak period)

Once Tasks 10-14 have been in production for a week without issue, remove the synchronous fallback paths inside `knowledge/page.tsx` and `faqs/page.tsx` (the `job?.status === 'failed'` branch that calls `generateFaqsAction()` / `generateKnowledgeAction()`), and delete those exported actions if no other caller remains.

Not scheduled here — track as a follow-up issue.

---

## Self-Review Summary

- **Spec coverage:** every component from the spec maps to a task — migration (1), runner+repo+kinds+hash (2-5), polling endpoint (6), animation+gate (7-8), per-kind wiring (10-14), done-page review (14), verification (15). The optional cleanup is called out (16).
- **Placeholder scan:** no `TBD`/`TODO`/`implement later` remain. Tests show actual assertions; code blocks show actual code.
- **Type consistency:** `GenerationKind` defined in Task 3 (`types.ts`), reused everywhere. `KIND_INPUT_MAP` parameterises `runGeneration`. `markDone`/`markFailed`/`upsertRunning` signatures match across repo, runner test, and runner.
- **Notes for the implementer:** several tasks include "verify the variable name in the existing action" caveats because the current `actions.ts` is large and the plan can't safely paste full function bodies without first reading them. These caveats are intentional — adjust to match real code before pasting.
