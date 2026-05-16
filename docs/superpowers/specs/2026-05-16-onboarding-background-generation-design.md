# Onboarding Background Generation — Design

**Date:** 2026-05-16
**Status:** Approved for planning
**Owner:** Onboarding

## Problem

Onboarding pages are slow because AI-generated steps (`knowledge`, `faqs`, and on-step generations for `form_fields` and `bot_instructions`) `await` the AI call during server render. The user stares at a skeleton for the full generation latency on every such step. We want:

1. Generation triggered on step submit, running in the background.
2. The user proceeds immediately to the next step without waiting.
3. If the user reaches a step whose generation isn't ready yet, show a branded "generating" animation — not a skeleton.
4. Anything not reviewed during the flow is surfaced for review on the final step.

## Goals

- Decouple navigation from AI generation latency entirely.
- Durable, idempotent generation state survives reloads, multi-tab use, and back-navigation.
- Per-step pages render the real edit UI when the result is ready, the generating animation when it isn't.
- Failure is surfaced inline with a Regenerate action.

## Non-Goals (YAGNI)

- Realtime channel (polling is sufficient at current scale).
- A dedicated worker process / queue table beyond a status row.
- Progress percentages (animation is honest-indeterminate).
- Explicit cancellation API (re-submitting covers it).

---

## Architecture

Three new pieces, plus a wrapper change to existing step-submit server actions.

### 1. `generation_jobs` table

Durable status + result per `(profile_id, kind)`. Status transitions: `queued → running → done | failed`.

```sql
create type onboarding_generation_kind as enum
  ('knowledge','faqs','personality_seed','form_fields','bot_instructions');
create type onboarding_generation_status as enum
  ('queued','running','done','failed');

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind onboarding_generation_kind not null,
  status onboarding_generation_status not null default 'queued',
  input_hash text not null,
  result jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, kind)
);

create index on public.generation_jobs (profile_id, status);

alter table public.generation_jobs enable row level security;
create policy "owner_read" on public.generation_jobs
  for select using (profile_id = auth.uid());
-- Writes go through the admin client from server actions only.

create trigger set_updated_at before update on public.generation_jobs
  for each row execute function public.tg_set_updated_at();
```

### 2. Generation runner

`src/lib/onboarding/generation/runner.ts`

```ts
type GenerationKind =
  | 'knowledge' | 'faqs' | 'personality_seed' | 'form_fields' | 'bot_instructions'

runGeneration(kind: GenerationKind, input: unknown): Promise<void>
```

Algorithm:

1. `hash = canonicalHash(input)`
2. `existing = getJob(profile_id, kind)`
3. If `existing?.status === 'done' && existing.input_hash === hash` → return (idempotent).
4. `upsertJob({ status: 'running', input_hash: hash, started_at: now, result: null, error: null })`
5. `try { result = await KINDS[kind].run(input); markDone(profile_id, kind, hash, result) }`
   `catch (e) { markFailed(profile_id, kind, hash, e.message) }`
6. **Never throws.** `after()` cannot surface errors to the user; the row carries the error instead.

`markDone` / `markFailed` include a `WHERE input_hash = $hash` guard so a later submit that re-queued the job with a new hash wins; the older in-flight run's terminal write is dropped.

`KINDS` registry maps each kind to its existing generator from `src/lib/onboarding/ai/*.ts` plus the input-canonicalisation strategy.

### 3. Trigger pattern in step-submit actions

```ts
'use server'
import { after } from 'next/server'

export async function submitBusinessAction(input: BusinessInput) {
  await saveBusinessBasics(input)
  after(async () => {
    await Promise.allSettled([
      runGeneration('knowledge', { businessBasics: input }),
      runGeneration('faqs',       { businessBasics: input }),
      runGeneration('personality_seed', { businessBasics: input }),
    ])
  })
  redirect('/onboarding/knowledge')
}
```

`after()` from `next/server` (Next 16 GA) ships the redirect immediately and runs the callback on Fluid Compute after the response is sent.

### 4. Polling endpoint

`GET /api/onboarding/generation/[kind]`

```ts
// 200
{ status: 'queued'|'running'|'done'|'failed',
  result?: unknown,        // present iff status==='done'
  error?: string,          // present iff status==='failed'
  updatedAt: string }
// 404 if job row missing for this user/kind
// 401 if no session
// Cache-Control: no-store
```

Auth via existing Supabase server client; the `owner_read` RLS policy enforces ownership.

---

## Trigger map

| Submit of step | Fires (in `after()`) | Inputs (hashed) | Used by step |
|---|---|---|---|
| `business` | `knowledge`, `faqs`, `personality_seed` (parallel via `Promise.allSettled`) | business basics | knowledge / faqs / personality |
| `goal` | `form_fields` (only if kind needs it) | business basics + goal kind | goal-content |
| `flow` (description submit) | `bot_instructions` | everything prior | flow review / done |

Editing an upstream step changes the relevant `input_hash` → runner upserts → downstream pages see non-`done` and re-gate automatically.

---

## UI pattern

### Page rendering rule (server component)

```
1. Read job row for this step's kind.
2. status === 'done'   → render edit UI with result (existing behaviour).
3. status === 'failed' → render error + <RegenerateButton />.
4. otherwise           → render <GenerationGate kind="..." />.
```

### `<GenerationGate />` (client component)

- Polls `/api/onboarding/generation/[kind]` every 1.5s, backing off to 5s after 10s elapsed.
- Gives up after 60s with a "Taking longer than usual — keep going?" CTA that links to the next step (deferred flag set so `done` page surfaces it).
- On `done` → `router.refresh()` so the server component re-renders with the real edit UI.
- On `failed` → inline error + Regenerate.
- Always renders a secondary "Skip and review later" link that simply navigates to the next step. No marker is stored — the final `done` page derives "needs review" from any job whose result the user has not yet acknowledged (see below).

### `<GenerationAnimation />`

`src/app/onboarding/_components/GenerationAnimation.tsx`

Three layers, all CSS (no Lottie):

1. **Animated gradient orb** — blurred conic gradient with slow rotation.
2. **Rotating status copy** — cycles through 3-4 step-specific lines every 2s (i18n via existing `t()`).
3. **Indeterminate shimmer bar** — no fake percentage.

Accessibility:

- `role="status"`, `aria-live="polite"`; current status copy announced.
- `prefers-reduced-motion` → orb pulse only, copy rotation disabled.

### Wizard navigation

Generation status never disables "Next." Navigation and generation are fully orthogonal.

### Final review (`/onboarding/done`)

Scans all job rows. For "needs review" we use the corresponding `<step>_completed_at` column on `onboarding_state` — if it's null and a job row exists, the user skipped review for that kind. The page renders any `failed`, still `running`/`queued`, or unreviewed-but-`done` items inline using the same edit UI as their per-step pages, followed by a single "Finish" CTA that sets `completed_at`.

---

## File layout

**New:**

```
supabase/migrations/<ts>_generation_jobs.sql
src/lib/onboarding/generation/
  runner.ts            # runGeneration(kind, input)
  kinds.ts             # KINDS registry + input canonicalisation
  hash.ts              # canonicalHash(input)
  repo.ts              # getJob / upsertJob / markRunning / markDone / markFailed
  stale.ts             # sweepStale() helper
src/app/api/onboarding/generation/[kind]/route.ts
src/app/onboarding/_components/
  GenerationAnimation.tsx
  GenerationGate.tsx
```

**Modified:**

```
src/app/onboarding/actions.ts                         # wrap step submits with after(runGeneration(...))
src/app/onboarding/knowledge/page.tsx                 # branch on job status; no inline await
src/app/onboarding/faqs/page.tsx                      # branch on job status; no inline await
src/app/onboarding/goal-content/FormFieldsContent.tsx # use gate instead of inline generate
src/app/onboarding/flow/FlowForm.tsx                  # fire bot_instructions via after; gate result
src/app/onboarding/done/page.tsx                      # final review of unready/failed/deferred jobs
src/lib/onboarding/i18n.ts                            # add generation.* keys
src/lib/onboarding/state.ts                           # helpers to read job status alongside step completion
```

---

## Testing strategy

- **Unit (Vitest, alongside existing `lib/onboarding/ai/*.test.ts`):**
  - `hash.test.ts` — canonical hash is stable across key order and whitespace.
  - `runner.test.ts` — happy path writes `done` with result; thrown generator → `failed` with error; same-hash short-circuit; never throws.
  - `repo.test.ts` — upsert resets status when `input_hash` changes; `markDone` guard rejects stale hash.
  - `stale.test.ts` — rows in `running` older than 90s are swept to `failed`.
- **Integration** for each step action: state saved, job row enqueued with correct kind + hash, redirect fired. Mock `after()` to execute synchronously.
- **Component** for `GenerationGate`: renders animation on `queued`/`running`, calls `router.refresh()` on `done` transition, shows error + Regenerate on `failed`, "Skip and review later" sets deferred flag and navigates.
- **Manual smoke:** full onboarding under throttled network; verify navigation never blocks on generation; verify a fast user hits the animation on `knowledge`.

---

## Rollout

Each step migrates in its own PR so individual reverts are cheap. During transition, each converted page reads the job row first and falls back to direct generation if no row exists — the old path keeps working until cleanup.

1. Migration `generation_jobs` (additive — zero risk).
2. Runner + kinds registry + polling route + animation + gate (unused).
3. Convert `personality_seed`.
4. Convert `form_fields`.
5. Convert `knowledge`.
6. Convert `faqs`.
7. Convert `bot_instructions`.
8. `done` page review-of-unreviewed list.
9. Cleanup PR: remove fallback direct-generation paths.

No feature flag needed.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| `after()` exceeds function `maxDuration` mid-generation. | `export const maxDuration = 60` on submit route segments. AI calls are 5-15s today. |
| User closes tab before `after()` finishes. | Stale-sweep: rows in `running` with `started_at` older than 90s are marked `failed` on next read, prompting Regenerate. |
| Two concurrent submits race for the same kind. | DB unique `(profile_id, kind)` + upsert; `markDone`/`markFailed` carry `WHERE input_hash = $current` so the loser's terminal write is dropped. |
| Polling load. | 1.5s → 5s backoff after 10s; auto-stops at 60s. Single indexed row read per poll. |
| Same input generated twice (cost). | Idempotent short-circuit on `input_hash` + `status='done'`. |
| Stale downstream result after upstream edit. | Hash changes → runner upserts → downstream page re-gates. |
| `after()` behaviour on `next dev`. | Works in 16.x; document in code comment for future maintainers. |
| RLS / service role boundary. | Writes through existing admin client in server actions. `owner_read` policy permits the poll endpoint. |

---

## Open items explicitly out of scope

- Supabase realtime instead of polling.
- A dedicated worker / job queue table outside the function lifetime.
- Progress percentages.
- Cancellation endpoint.
