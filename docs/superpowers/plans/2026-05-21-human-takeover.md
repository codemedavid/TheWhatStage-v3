# Human Takeover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-pause the reactive chatbot when the operator sends a reply in the Conversation panel; auto-resume after configurable inactivity (default 60 min) or on manual override.

**Architecture:** Two new fields — `messenger_threads.bot_paused_until` (timestamp, set on operator send) and `chatbot_configs.human_takeover_minutes` (integer, default 60). The webhook and worker treat `bot_paused_until > now()` as equivalent to `auto_reply_enabled = false` for the purpose of the reactive bot (classification still runs). The existing manual "Bot off" toggle is preserved as a separate sticky state.

**Spec:** `docs/superpowers/specs/2026-05-21-human-takeover-design.md`

**Tech Stack:** Next.js App Router, Supabase (Postgres + PostgREST), Vitest, TypeScript, Tailwind.

---

## File Structure

**Create:**
- `supabase/migrations/20260604000000_human_takeover.sql` — migration adding two columns
- `src/lib/chatbot/takeover.ts` — pure `isBotPaused` helper, single source of truth for the rule
- `src/lib/chatbot/takeover.test.ts` — unit tests for the helper
- `src/app/api/chatbot/takeover-settings/route.ts` — GET/PUT for `human_takeover_minutes`
- `src/app/api/chatbot/takeover-settings/route.test.ts` — route tests
- `src/app/(app)/dashboard/chatbot/_components/HumanTakeoverForm.tsx` — settings UI on chatbot dashboard

**Modify:**
- `src/app/(app)/dashboard/leads/actions/messenger.ts` — stamp pause in `replyAsOperator`, clear in `setAutoReply(true)`, new `resumeBot` action, surface `bot_paused_until` in `loadConversation`
- `src/app/api/webhooks/facebook/route.ts:255-316` — include `bot_paused_until` in thread select, gate on `isBotPaused`
- `src/app/api/messenger/process/route.ts:128-141, 440-520, 1380-1410` — add `bot_paused_until` to `ThreadRow`/select, gate the reply step on `isBotPaused`
- `src/app/(app)/dashboard/leads/_components/ConversationPanel.tsx` — three-state pill, footnote, countdown
- `src/app/(app)/dashboard/chatbot/page.tsx` — render `HumanTakeoverForm`

**Test:**
- `src/lib/chatbot/takeover.test.ts`
- `src/app/(app)/dashboard/leads/actions/messenger.test.ts` (new — actions don't have a test file today, so this one creates it)
- Extend `src/app/api/webhooks/facebook/route.test.ts`
- Extend `src/app/api/messenger/process/route.test.ts`
- `src/app/api/chatbot/takeover-settings/route.test.ts`

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260604000000_human_takeover.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- =========================================================================
-- Human takeover: auto-pause the reactive bot when the operator replies in
-- the Conversation panel. Resumes after configurable operator inactivity.
-- =========================================================================

-- Per-thread pause stamp. NULL = not auto-paused. Past timestamp = pause
-- expired (treated as NULL by the gating check). Independent from the
-- existing sticky auto_reply_enabled flag — both can be set, and the manual
-- toggle wins.
alter table public.messenger_threads
  add column bot_paused_until timestamptz;

-- Per-user pause duration in minutes. 0 disables auto-takeover entirely.
-- Default 60 = one hour, matches the design discussion.
alter table public.chatbot_configs
  add column human_takeover_minutes integer not null default 60
    check (human_takeover_minutes >= 0 and human_takeover_minutes <= 1440);

-- Partial index on the hot read: webhook gates every inbound message on this.
-- Only paused-future rows are interesting; we don't index NULL or past values.
create index if not exists messenger_threads_bot_paused_until_idx
  on public.messenger_threads (bot_paused_until)
  where bot_paused_until is not null;
```

- [ ] **Step 2: Apply via Supabase MCP**

Apply with the `mcp__supabase__apply_migration` tool, name `human_takeover`. After it succeeds, run `mcp__supabase__list_tables` filtered to `public.messenger_threads` and `public.chatbot_configs` to confirm the columns exist.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260604000000_human_takeover.sql
git commit -m "feat(db): add bot_paused_until and human_takeover_minutes for human takeover"
```

---

## Task 2: `isBotPaused` helper

**Files:**
- Create: `src/lib/chatbot/takeover.ts`
- Test: `src/lib/chatbot/takeover.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/chatbot/takeover.test.ts
import { describe, it, expect } from 'vitest'
import { isBotPaused } from './takeover'

describe('isBotPaused', () => {
  const now = new Date('2026-05-21T12:00:00Z')

  it('returns false when bot_paused_until is null', () => {
    expect(isBotPaused(null, now)).toBe(false)
  })

  it('returns false when bot_paused_until is in the past', () => {
    expect(isBotPaused('2026-05-21T11:00:00Z', now)).toBe(false)
  })

  it('returns false when bot_paused_until equals now', () => {
    expect(isBotPaused('2026-05-21T12:00:00Z', now)).toBe(false)
  })

  it('returns true when bot_paused_until is in the future', () => {
    expect(isBotPaused('2026-05-21T12:30:00Z', now)).toBe(true)
  })

  it('returns false on malformed timestamp', () => {
    expect(isBotPaused('not-a-date', now)).toBe(false)
  })

  it('uses Date.now() when no `now` argument passed', () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    expect(isBotPaused(future)).toBe(true)
    const past = new Date(Date.now() - 60_000).toISOString()
    expect(isBotPaused(past)).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run src/lib/chatbot/takeover.test.ts
```

Expected: FAIL — `takeover` module not found.

- [ ] **Step 3: Implement the helper**

```ts
// src/lib/chatbot/takeover.ts

/**
 * True iff the operator-takeover pause is still in effect for this thread.
 * Returns false for NULL, past timestamps, and malformed input — the bot
 * should reply normally in all those cases.
 */
export function isBotPaused(
  bot_paused_until: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!bot_paused_until) return false
  const ts = Date.parse(bot_paused_until)
  if (Number.isNaN(ts)) return false
  return ts > now.getTime()
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run src/lib/chatbot/takeover.test.ts
```

Expected: PASS — all 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chatbot/takeover.ts src/lib/chatbot/takeover.test.ts
git commit -m "feat(chatbot): isBotPaused helper for human takeover"
```

---

## Task 3: Stamp `bot_paused_until` in `replyAsOperator`

The existing `replyAsOperator` in `src/app/(app)/dashboard/leads/actions/messenger.ts:357-456` inserts an outbound message row, then on send success updates the thread tail. We extend it so the stamp happens **regardless of FB send outcome** — per the spec, the operator's *intent* counts, and letting the bot reply on top of a failed-to-send operator message is worse than honoring the pause. The stamp is done as its own dedicated thread update *after* the message-row insert and *before* the existing tail-update branch, so the failure path still gets stamped.

**Files:**
- Modify: `src/app/(app)/dashboard/leads/actions/messenger.ts:347-456`
- Test: `src/app/(app)/dashboard/leads/actions/messenger.test.ts` (new file)

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/(app)/dashboard/leads/actions/messenger.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getUserMock, supabaseFromMock, adminFromMock, sendOutboundMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  supabaseFromMock: vi.fn(),
  adminFromMock: vi.fn(),
  sendOutboundMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: supabaseFromMock,
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: adminFromMock }),
}))
vi.mock('@/lib/messenger/outbound', () => ({
  sendOutbound: sendOutboundMock,
}))
vi.mock('@/lib/facebook/crypto', () => ({
  decryptToken: (s: string) => `decrypted:${s}`,
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

import { replyAsOperator, setAutoReply } from './messenger'

beforeEach(() => {
  getUserMock.mockReset()
  supabaseFromMock.mockReset()
  adminFromMock.mockReset()
  sendOutboundMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  sendOutboundMock.mockResolvedValue({ sent: true, messageId: 'fb-mid-1' })
})

function makeSupabaseStub(opts: {
  thread: Record<string, unknown> | null
  threadUpdateSpy?: (patch: Record<string, unknown>) => void
  messageInsertSpy?: (row: Record<string, unknown>) => void
  takeoverMinutes?: number
}) {
  return (table: string) => {
    if (table === 'messenger_threads') {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: opts.thread, error: null }) }),
        }),
        update: (patch: Record<string, unknown>) => {
          opts.threadUpdateSpy?.(patch)
          return { eq: async () => ({ error: null }) }
        },
      }
    }
    if (table === 'messenger_messages') {
      return {
        insert: async (row: Record<string, unknown>) => {
          opts.messageInsertSpy?.(row)
          return { error: null }
        },
      }
    }
    if (table === 'chatbot_configs') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { human_takeover_minutes: opts.takeoverMinutes ?? 60 },
              error: null,
            }),
          }),
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  }
}

describe('replyAsOperator — bot_paused_until stamp', () => {
  it('stamps bot_paused_until ≈ now + N minutes when human_takeover_minutes > 0', async () => {
    const patches: Record<string, unknown>[] = []
    supabaseFromMock.mockImplementation(makeSupabaseStub({
      thread: {
        id: 't1', psid: 'psid', page_id: 'p1', last_inbound_at: null,
        controlled_by_run_id: null,
        facebook_pages: { page_access_token: 'enc' },
      },
      threadUpdateSpy: (p) => { patches.push(p) },
    }))

    const t0 = Date.now()
    await replyAsOperator('lead-1', 'hello')
    const t1 = Date.now()

    const stampPatch = patches.find((p) => 'bot_paused_until' in p)
    expect(stampPatch?.bot_paused_until).toBeTypeOf('string')
    const stampedAt = Date.parse(stampPatch?.bot_paused_until as string)
    expect(stampedAt).toBeGreaterThanOrEqual(t0 + 60 * 60_000 - 50)
    expect(stampedAt).toBeLessThanOrEqual(t1 + 60 * 60_000 + 50)
  })

  it('does NOT stamp when human_takeover_minutes = 0', async () => {
    const patches: Record<string, unknown>[] = []
    supabaseFromMock.mockImplementation(makeSupabaseStub({
      thread: {
        id: 't1', psid: 'psid', page_id: 'p1', last_inbound_at: null,
        controlled_by_run_id: null,
        facebook_pages: { page_access_token: 'enc' },
      },
      threadUpdateSpy: (p) => { patches.push(p) },
      takeoverMinutes: 0,
    }))

    await replyAsOperator('lead-1', 'hello')

    expect(patches.some((p) => 'bot_paused_until' in p)).toBe(false)
  })

  it('does NOT stamp when chatbot_configs row is missing', async () => {
    const patches: Record<string, unknown>[] = []
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === 'chatbot_configs') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
        }
      }
      return makeSupabaseStub({
        thread: {
          id: 't1', psid: 'psid', page_id: 'p1', last_inbound_at: null,
          controlled_by_run_id: null,
          facebook_pages: { page_access_token: 'enc' },
        },
        threadUpdateSpy: (p) => { patches.push(p) },
      })(table)
    })

    await replyAsOperator('lead-1', 'hello')

    expect(patches.some((p) => 'bot_paused_until' in p)).toBe(false)
  })

  it('still stamps when the FB send fails (operator intent counted)', async () => {
    sendOutboundMock.mockResolvedValue({ sent: false, reason: 'rate_limited' })
    const patches: Record<string, unknown>[] = []
    supabaseFromMock.mockImplementation(makeSupabaseStub({
      thread: {
        id: 't1', psid: 'psid', page_id: 'p1', last_inbound_at: null,
        controlled_by_run_id: null,
        facebook_pages: { page_access_token: 'enc' },
      },
      threadUpdateSpy: (p) => { patches.push(p) },
    }))

    await expect(replyAsOperator('lead-1', 'hello')).rejects.toThrow()
    // The dedicated pause stamp runs regardless of send outcome.
    // The tail update (last_message_at) does NOT run on failure.
    const stampPatch = patches.find((p) => 'bot_paused_until' in p)
    expect(stampPatch).toBeDefined()
    expect(typeof stampPatch?.bot_paused_until).toBe('string')
    const tailPatch = patches.find((p) => 'last_message_at' in p)
    expect(tailPatch).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run src/app/\(app\)/dashboard/leads/actions/messenger.test.ts
```

Expected: FAIL — the `bot_paused_until` field is never written today.

- [ ] **Step 3: Modify `replyAsOperator`**

Insert a dedicated pause-stamp block *after* the `messenger_messages.insert` and *before* the existing `if (!sendError)` tail-update block, so the stamp runs in both success and failure paths.

Replace the existing block from `src/app/(app)/dashboard/leads/actions/messenger.ts` line 404 (the `await supabase.from('messenger_messages').insert({...})`) through line 452 (the closing `}` of the `if (!sendError)`) with:

```ts
  await supabase.from('messenger_messages').insert({
    thread_id: thread.id,
    user_id: userId,
    direction: 'outbound',
    sender: 'operator',
    fb_message_id: sentId,
    body,
    error: sendError,
  })

  // Human takeover: stamp bot_paused_until = now + N min so the reactive
  // bot stays silent for this thread until the operator goes quiet for N
  // minutes. Runs regardless of send outcome — the operator's *intent*
  // was to take over, and letting the bot reply on top of a failed-to-send
  // operator message is worse than honoring the pause. Skipped when the
  // user has set human_takeover_minutes to 0 or has no chatbot_configs row.
  const { data: cfg } = await supabase
    .from('chatbot_configs')
    .select('human_takeover_minutes')
    .eq('user_id', userId)
    .maybeSingle<{ human_takeover_minutes: number }>()
  const pauseMinutes = cfg?.human_takeover_minutes ?? 0
  if (pauseMinutes > 0) {
    await supabase
      .from('messenger_threads')
      .update({
        bot_paused_until: new Date(Date.now() + pauseMinutes * 60_000).toISOString(),
      })
      .eq('id', thread.id)
  }

  if (!sendError) {
    const threadUpdate: Record<string, unknown> = {
      last_message_at: new Date().toISOString(),
      last_message_preview: body.slice(0, 200),
    }

    // §9 operator override: clear the workflow run lock so the bot can resume
    // normal operation when the run's wait expires, and pause the active run
    // with a 24-hour auto-resume timer.
    const runId = (thread as { controlled_by_run_id?: string | null }).controlled_by_run_id ?? null
    if (runId) {
      threadUpdate.controlled_by_run_id = null
      const resumeAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

      const { data: runRow } = await admin
        .from('workflow_runs')
        .select('state')
        .eq('id', runId)
        .in('status', ['running', 'waiting'])
        .maybeSingle<{ state: Record<string, unknown> }>()
      if (runRow) {
        await admin
          .from('workflow_runs')
          .update({
            status: 'waiting',
            next_run_at: resumeAt,
            state: { ...runRow.state, waiting_for: 'operator_took_over' },
          })
          .eq('id', runId)
      }
    }

    await supabase
      .from('messenger_threads')
      .update(threadUpdate)
      .eq('id', thread.id)
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run src/app/\(app\)/dashboard/leads/actions/messenger.test.ts
```

Expected: PASS — all 4 tests in the new describe block.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/dashboard/leads/actions/messenger.ts src/app/\(app\)/dashboard/leads/actions/messenger.test.ts
git commit -m "feat(leads): stamp bot_paused_until in replyAsOperator"
```

---

## Task 4: `setAutoReply(true)` clears `bot_paused_until`

When the operator manually flips the bot back on via the existing toggle, any auto-pause should be cleared too. Otherwise toggling on while paused would feel broken (operator clicks "Bot on", nothing happens for 47 more minutes).

**Files:**
- Modify: `src/app/(app)/dashboard/leads/actions/messenger.ts:347-355`
- Test: `src/app/(app)/dashboard/leads/actions/messenger.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `messenger.test.ts`:

```ts
describe('setAutoReply', () => {
  it('clears bot_paused_until when enabling', async () => {
    let patch: Record<string, unknown> | undefined
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === 'messenger_threads') {
        return {
          update: (p: Record<string, unknown>) => {
            patch = p
            return { eq: async () => ({ error: null }) }
          },
        }
      }
      throw new Error(`unexpected ${table}`)
    })

    await setAutoReply('lead-1', true)

    expect(patch).toEqual({ auto_reply_enabled: true, bot_paused_until: null })
  })

  it('does NOT touch bot_paused_until when disabling', async () => {
    let patch: Record<string, unknown> | undefined
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === 'messenger_threads') {
        return {
          update: (p: Record<string, unknown>) => {
            patch = p
            return { eq: async () => ({ error: null }) }
          },
        }
      }
      throw new Error(`unexpected ${table}`)
    })

    await setAutoReply('lead-1', false)

    expect(patch).toEqual({ auto_reply_enabled: false })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run src/app/\(app\)/dashboard/leads/actions/messenger.test.ts -t 'setAutoReply'
```

Expected: FAIL on the "clears bot_paused_until when enabling" test.

- [ ] **Step 3: Modify `setAutoReply`**

Replace `src/app/(app)/dashboard/leads/actions/messenger.ts:347-355` with:

```ts
export async function setAutoReply(leadId: string, enabled: boolean): Promise<void> {
  const { supabase } = await requireUser()
  // Enabling clears any auto-pause stamp so the operator doesn't have to wait
  // out the timer after explicitly turning the bot back on. Disabling leaves
  // the stamp alone — the manual toggle and the pause are independent states.
  const patch: Record<string, unknown> = enabled
    ? { auto_reply_enabled: true, bot_paused_until: null }
    : { auto_reply_enabled: false }
  const { error } = await supabase
    .from('messenger_threads')
    .update(patch)
    .eq('lead_id', leadId)
  if (error) throw new Error(`setAutoReply: ${error.message}`)
  revalidatePath('/dashboard/leads', 'layout')
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run src/app/\(app\)/dashboard/leads/actions/messenger.test.ts -t 'setAutoReply'
```

Expected: PASS — both tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/dashboard/leads/actions/messenger.ts src/app/\(app\)/dashboard/leads/actions/messenger.test.ts
git commit -m "feat(leads): clear bot_paused_until when re-enabling auto-reply"
```

---

## Task 5: New `resumeBot` server action

Used by the UI when the pill is in "Paused" state and the operator clicks "Resume now". Clears `bot_paused_until` without otherwise changing `auto_reply_enabled`.

**Files:**
- Modify: `src/app/(app)/dashboard/leads/actions/messenger.ts` (append at end)
- Test: `src/app/(app)/dashboard/leads/actions/messenger.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `messenger.test.ts`:

```ts
import { resumeBot } from './messenger'

describe('resumeBot', () => {
  it('clears bot_paused_until without touching auto_reply_enabled', async () => {
    let patch: Record<string, unknown> | undefined
    supabaseFromMock.mockImplementation((table: string) => {
      if (table === 'messenger_threads') {
        return {
          update: (p: Record<string, unknown>) => {
            patch = p
            return { eq: async () => ({ error: null }) }
          },
        }
      }
      throw new Error(`unexpected ${table}`)
    })

    await resumeBot('lead-1')

    expect(patch).toEqual({ bot_paused_until: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run src/app/\(app\)/dashboard/leads/actions/messenger.test.ts -t 'resumeBot'
```

Expected: FAIL — `resumeBot` is not exported.

- [ ] **Step 3: Implement `resumeBot`**

Append to `src/app/(app)/dashboard/leads/actions/messenger.ts`:

```ts
export async function resumeBot(leadId: string): Promise<void> {
  const { supabase } = await requireUser()
  const { error } = await supabase
    .from('messenger_threads')
    .update({ bot_paused_until: null })
    .eq('lead_id', leadId)
  if (error) throw new Error(`resumeBot: ${error.message}`)
  revalidatePath('/dashboard/leads', 'layout')
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run src/app/\(app\)/dashboard/leads/actions/messenger.test.ts -t 'resumeBot'
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(app\)/dashboard/leads/actions/messenger.ts src/app/\(app\)/dashboard/leads/actions/messenger.test.ts
git commit -m "feat(leads): resumeBot server action for human takeover"
```

---

## Task 6: Surface `bot_paused_until` in `loadConversation`

The UI pill needs the current pause timestamp. `loadConversation` already returns the thread; add `bot_paused_until` to the select and the `ConversationData['thread']` type.

**Files:**
- Modify: `src/app/(app)/dashboard/leads/actions/messenger.ts:42-55, 70-147`

- [ ] **Step 1: Extend the `ConversationData['thread']` type**

In `src/app/(app)/dashboard/leads/actions/messenger.ts:42-55`, add `bot_paused_until: string | null` to the `thread` shape:

```ts
export interface ConversationData {
  thread: {
    id: string
    psid: string
    full_name: string | null
    picture_url: string | null
    auto_reply_enabled: boolean
    bot_paused_until: string | null
    last_message_at: string | null
    page_name: string | null
  }
  messages: ConversationMessage[]
  stageEvents: ConversationStageEvent[]
  comments: ConversationComment[]
}
```

- [ ] **Step 2: Extend the select and the return mapping**

Update the select string at `src/app/(app)/dashboard/leads/actions/messenger.ts:77-79`:

```ts
.select(
  'id, psid, full_name, picture_url, auto_reply_enabled, bot_paused_until, last_message_at, page_id, facebook_pages(name)',
)
```

And the return mapping at `src/app/(app)/dashboard/leads/actions/messenger.ts:133-142`:

```ts
return {
  thread: {
    id: thread.id,
    psid: thread.psid,
    full_name: thread.full_name,
    picture_url: thread.picture_url,
    auto_reply_enabled: thread.auto_reply_enabled,
    bot_paused_until: (thread as { bot_paused_until?: string | null }).bot_paused_until ?? null,
    last_message_at: thread.last_message_at,
    page_name: pageName,
  },
  // ...
}
```

- [ ] **Step 3: Type-check**

```bash
pnpm tsc --noEmit
```

Expected: PASS (no new type errors).

- [ ] **Step 4: Commit**

```bash
git add src/app/\(app\)/dashboard/leads/actions/messenger.ts
git commit -m "feat(leads): surface bot_paused_until in loadConversation"
```

---

## Task 7: Gate the webhook on `isBotPaused`

The webhook's reply-vs-classify decision currently keys off `auto_reply_enabled` alone. Add `bot_paused_until` to the select and treat `isBotPaused === true` the same way as `auto_reply_enabled === false`.

**Files:**
- Modify: `src/app/api/webhooks/facebook/route.ts:255-316`
- Test: `src/app/api/webhooks/facebook/route.test.ts`

- [ ] **Step 1: Read the existing test to find the right insertion point**

Read `src/app/api/webhooks/facebook/route.test.ts:80-200` to see how a thread row is stubbed. The existing tests stub a thread that has `auto_reply_enabled: true` and expect a job to be enqueued. We mirror that for the paused case.

- [ ] **Step 2: Write the failing tests**

Append two new test cases to `src/app/api/webhooks/facebook/route.test.ts`, inside the existing main `describe`:

```ts
it('takes the classify-only fallback when bot_paused_until is in the future', async () => {
  // Build a thread row stub identical to the happy-path test but with
  // bot_paused_until = now + 30m. Expectation: messenger_jobs INSERT is NOT
  // called (auto_classify_enabled defaults to off in the chatbot_configs stub).
  const future = new Date(Date.now() + 30 * 60_000).toISOString()
  // ... use the existing test harness's `setupHappyPath` / equivalent helper,
  // override the thread select to return:
  //   { id: 'thread-1', auto_reply_enabled: true, lead_id: null, bot_paused_until: future }
  // and assert that `jobInsertSpy` was never called.
})

it('enqueues normally when bot_paused_until is in the past', async () => {
  const past = new Date(Date.now() - 30 * 60_000).toISOString()
  // Same harness, thread row:
  //   { id: 'thread-1', auto_reply_enabled: true, lead_id: null, bot_paused_until: past }
  // Assert messenger_jobs INSERT WAS called.
})
```

(Use the existing test file's existing stub builders — don't invent a new harness. Read the file first; if it has e.g. a `makeAdminStub` factory, extend it to accept a `bot_paused_until` override.)

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm vitest run src/app/api/webhooks/facebook/route.test.ts
```

Expected: FAIL — the new "paused" test sees a job enqueued today.

- [ ] **Step 4: Modify the webhook gate**

In `src/app/api/webhooks/facebook/route.ts:261`, extend the select:

```ts
.select('id, auto_reply_enabled, bot_paused_until, lead_id')
```

In `src/app/api/webhooks/facebook/route.ts:309-316`, replace the gate:

```ts
// Reactive bot is gated by either the sticky manual toggle OR an active
// human-takeover pause. In either case, fall through to classify-only if
// the user has auto_classify enabled.
if (
  thread.auto_reply_enabled === false ||
  isBotPaused((thread as { bot_paused_until?: string | null }).bot_paused_until)
) {
  const { data: cfg } = await admin
    .from('chatbot_configs')
    .select('auto_classify_enabled')
    .eq('user_id', userId)
    .maybeSingle<{ auto_classify_enabled: boolean }>()
  if (!cfg?.auto_classify_enabled) return null
}
```

Add the import at the top of `src/app/api/webhooks/facebook/route.ts`:

```ts
import { isBotPaused } from '@/lib/chatbot/takeover'
```

Also extend the inline `single<...>()` generic at line 261-262:

```ts
.single<{ id: string; auto_reply_enabled: boolean; bot_paused_until: string | null; lead_id: string | null }>()
```

(Or however the existing select call is typed — match the existing pattern.)

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm vitest run src/app/api/webhooks/facebook/route.test.ts
```

Expected: PASS — including both new tests and all existing ones.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/webhooks/facebook/route.ts src/app/api/webhooks/facebook/route.test.ts
git commit -m "feat(webhook): gate reactive bot on bot_paused_until for human takeover"
```

---

## Task 8: Gate the worker on `isBotPaused`

The worker re-checks pause state because the timer may have expired between webhook enqueue and worker pickup. Per the spec, if the webhook took the classify-only path and the timer has since expired, the worker still honors that decision (classify-only). The next inbound message will get a full bot reply.

The worker reads `auto_reply_enabled` at multiple gates. Each one gets the equivalent `isBotPaused` check.

**Files:**
- Modify: `src/app/api/messenger/process/route.ts:128-141, 1380-1410, 451, 517, 1276, 1286`
- Test: `src/app/api/messenger/process/route.test.ts`

- [ ] **Step 1: Extend the `ThreadRow` type at `src/app/api/messenger/process/route.ts:128-141`**

Add `bot_paused_until: string | null` to the `ThreadRow` interface:

```ts
type ThreadRow = {
  id: string
  user_id: string
  page_id: string
  psid: string
  lead_id: string | null
  full_name: string | null
  auto_reply_enabled: boolean
  bot_paused_until: string | null
  inbound_since_classify: number
  conversation_summary: string | null
  last_inbound_at: string | null
  controlled_by_run_id: string | null
}
```

- [ ] **Step 2: Extend the select at `src/app/api/messenger/process/route.ts:1386`**

```ts
.select(
  'body, fb_message_id, messenger_threads!inner(id, user_id, page_id, psid, lead_id, full_name, auto_reply_enabled, bot_paused_until, inbound_since_classify, conversation_summary, last_inbound_at, controlled_by_run_id)',
)
```

- [ ] **Step 3: Write the failing tests**

Read `src/app/api/messenger/process/route.test.ts:200-260, 470-540` to find the existing thread-stub builder. Add two new test cases following that pattern:

```ts
it('skips the reply step when bot_paused_until is in the future', async () => {
  const future = new Date(Date.now() + 30 * 60_000).toISOString()
  // Build a job + thread stub with auto_reply_enabled: true and bot_paused_until: future.
  // Assert: sendMessengerSenderAction is NOT called, sendOutbound is NOT called,
  // but the classify path STILL runs (classify mock IS called) because the existing
  // semantics for the paused case match auto_reply_enabled = false.
})

it('replies normally when bot_paused_until is in the past', async () => {
  const past = new Date(Date.now() - 30 * 60_000).toISOString()
  // Build job + thread stub with auto_reply_enabled: true and bot_paused_until: past.
  // Assert: sendOutbound IS called.
})
```

(Match the existing test file's mocking idioms — it has its own table router and spies. Read it first.)

- [ ] **Step 4: Run tests to verify they fail**

```bash
pnpm vitest run src/app/api/messenger/process/route.test.ts
```

Expected: FAIL on the new "skips reply when paused" test.

- [ ] **Step 5: Gate the worker's reply path**

The worker has the reply step guarded at `src/app/api/messenger/process/route.ts:517` by:

```ts
if (thread.auto_reply_enabled && !thread.controlled_by_run_id) {
```

Change to:

```ts
if (
  thread.auto_reply_enabled
  && !isBotPaused(thread.bot_paused_until)
  && !thread.controlled_by_run_id
) {
```

Also check `src/app/api/messenger/process/route.ts:451, 1276, 1286` — wherever `thread.auto_reply_enabled` is read to decide whether the bot speaks, add `&& !isBotPaused(thread.bot_paused_until)` alongside.

(Read each site first; some of those gates may be about loading context — they should still run for classify-only. Only gate the actual *send-the-reply* decisions.)

Add the import at the top of `src/app/api/messenger/process/route.ts`:

```ts
import { isBotPaused } from '@/lib/chatbot/takeover'
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
pnpm vitest run src/app/api/messenger/process/route.test.ts
```

Expected: PASS — all tests including the two new ones.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/messenger/process/route.ts src/app/api/messenger/process/route.test.ts
git commit -m "feat(worker): gate reactive bot on bot_paused_until for human takeover"
```

---

## Task 9: `GET /PUT /api/chatbot/takeover-settings`

Mirrors the shape of `/api/chatbot/followup-settings`. Single integer field; validates with zod.

**Files:**
- Create: `src/app/api/chatbot/takeover-settings/route.ts`
- Test: `src/app/api/chatbot/takeover-settings/route.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/api/chatbot/takeover-settings/route.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { getUserMock, supabaseFromMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  supabaseFromMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: supabaseFromMock,
  }),
}))

import { GET, PUT } from './route'

beforeEach(() => {
  getUserMock.mockReset()
  supabaseFromMock.mockReset()
})

describe('GET /api/chatbot/takeover-settings', () => {
  it('returns 401 without a session', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it('returns default 60 when no chatbot_configs row exists', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
    }))
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ human_takeover_minutes: 60 })
  })

  it('returns saved value when present', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    supabaseFromMock.mockImplementation(() => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { human_takeover_minutes: 30 }, error: null }) }),
      }),
    }))
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ human_takeover_minutes: 30 })
  })
})

describe('PUT /api/chatbot/takeover-settings', () => {
  function makeReq(body: unknown): Request {
    return new Request('http://x/api/chatbot/takeover-settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  it('returns 401 without a session', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await PUT(makeReq({ human_takeover_minutes: 30 }))
    expect(res.status).toBe(401)
  })

  it('rejects negative values', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const res = await PUT(makeReq({ human_takeover_minutes: -1 }))
    expect(res.status).toBe(400)
  })

  it('rejects non-integer values', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const res = await PUT(makeReq({ human_takeover_minutes: 12.5 }))
    expect(res.status).toBe(400)
  })

  it('rejects values above 1440', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const res = await PUT(makeReq({ human_takeover_minutes: 1441 }))
    expect(res.status).toBe(400)
  })

  it('upserts on valid input', async () => {
    let upsertedRow: Record<string, unknown> | undefined
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    supabaseFromMock.mockImplementation(() => ({
      upsert: async (row: Record<string, unknown>) => {
        upsertedRow = row
        return { error: null }
      },
    }))
    const res = await PUT(makeReq({ human_takeover_minutes: 30 }))
    expect(res.status).toBe(200)
    expect(upsertedRow).toEqual({ user_id: 'u1', human_takeover_minutes: 30 })
  })

  it('accepts 0 (disables auto-takeover)', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    supabaseFromMock.mockImplementation(() => ({
      upsert: async () => ({ error: null }),
    }))
    const res = await PUT(makeReq({ human_takeover_minutes: 0 }))
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run src/app/api/chatbot/takeover-settings/route.test.ts
```

Expected: FAIL — route module not found.

- [ ] **Step 3: Implement the route**

```ts
// src/app/api/chatbot/takeover-settings/route.ts
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BODY_SCHEMA = z.object({
  human_takeover_minutes: z
    .number()
    .int('must be an integer')
    .min(0, 'must be ≥ 0')
    .max(1440, 'must be ≤ 1440 (24h)'),
})

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('chatbot_configs')
    .select('human_takeover_minutes')
    .eq('user_id', user.id)
    .maybeSingle<{ human_takeover_minutes: number }>()

  return NextResponse.json({
    human_takeover_minutes: data?.human_takeover_minutes ?? 60,
  })
}

export async function PUT(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 })
  }

  const parsed = BODY_SCHEMA.safeParse(body)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return NextResponse.json(
      { error: first.message, path: first.path },
      { status: 400 },
    )
  }

  const { error } = await supabase.from('chatbot_configs').upsert(
    { user_id: user.id, human_takeover_minutes: parsed.data.human_takeover_minutes },
    { onConflict: 'user_id' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    human_takeover_minutes: parsed.data.human_takeover_minutes,
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run src/app/api/chatbot/takeover-settings/route.test.ts
```

Expected: PASS — all 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/chatbot/takeover-settings/route.ts src/app/api/chatbot/takeover-settings/route.test.ts
git commit -m "feat(api): GET/PUT /api/chatbot/takeover-settings"
```

---

## Task 10: Three-state pill in `ConversationPanel`

Replace the existing 2-state "Bot on / Bot off" button with a 3-state pill driven by both `auto_reply_enabled` and `bot_paused_until`. Add a 1-minute ticker for the countdown. Update the footnote.

**Files:**
- Modify: `src/app/(app)/dashboard/leads/_components/ConversationPanel.tsx`

- [ ] **Step 1: Import `resumeBot`**

In the existing import block at the top:

```ts
import {
  loadConversation,
  replyAsOperator,
  resumeBot,
  setAutoReply,
  undoStageEvent,
  type ConversationComment,
  type ConversationData,
  type ConversationMessage,
  type ConversationStageEvent,
} from '../actions/messenger'
```

- [ ] **Step 2: Add `onResume` and ticker state inside `ConversationPanel`**

After the existing `onToggleAuto`:

```ts
const onResume = () => {
  startToggle(async () => {
    try {
      await resumeBot(leadId)
      refresh()
    } catch (e) {
      setState({
        status: 'error',
        message: e instanceof Error ? e.message : 'Resume failed',
      })
    }
  })
}

// Force re-render every 60s so the pause countdown ticks down.
const [, setTick] = useState(0)
useEffect(() => {
  if (state.status !== 'ready') return
  const pausedUntil = state.data.thread.bot_paused_until
  if (!pausedUntil) return
  const id = setInterval(() => setTick((t) => t + 1), 60_000)
  return () => clearInterval(id)
}, [state])
```

- [ ] **Step 3: Replace the `Header` component to render the 3-state pill**

Replace the existing `Header` (~lines 193-259) with:

```tsx
function Header({
  thread,
  toggling,
  onToggleAuto,
  onResume,
}: {
  thread: ConversationData['thread']
  toggling: boolean
  onToggleAuto: () => void
  onResume: () => void
}) {
  const now = Date.now()
  const pausedUntilMs = thread.bot_paused_until
    ? Date.parse(thread.bot_paused_until)
    : null
  const isPaused =
    thread.auto_reply_enabled
    && pausedUntilMs !== null
    && !Number.isNaN(pausedUntilMs)
    && pausedUntilMs > now
  const minutesLeft = isPaused ? Math.max(1, Math.ceil((pausedUntilMs! - now) / 60_000)) : 0

  let label: string
  let title: string
  let onClick: () => void
  let pillStyle: React.CSSProperties

  if (!thread.auto_reply_enabled) {
    label = 'Bot off'
    title = 'Manually off — toggle to resume'
    onClick = onToggleAuto
    pillStyle = {
      color: 'var(--lead-body)',
      background: 'var(--lead-surface)',
      border: '1px solid var(--lead-line)',
    }
  } else if (isPaused) {
    label = `Paused · ${minutesLeft}m`
    title = `You're handling this — bot resumes in ${minutesLeft} min. Click to resume now.`
    onClick = onResume
    pillStyle = {
      color: 'var(--lead-warning, #92400e)',
      background: 'var(--lead-warning-soft, #fef3c7)',
      border: '1px solid var(--lead-warning, #f59e0b)',
    }
  } else {
    label = 'Bot on'
    title = 'Bot will reply to incoming messages'
    onClick = onToggleAuto
    pillStyle = {
      color: '#fff',
      background: 'var(--lead-accent)',
      border: '1px solid var(--lead-accent)',
    }
  }

  return (
    <div className="flex items-center gap-3">
      {thread.picture_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thread.picture_url}
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 rounded-full object-cover"
        />
      ) : (
        <div className="h-9 w-9 rounded-full" style={{ background: 'var(--lead-accent-soft)' }} />
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium" style={{ color: 'var(--lead-ink)' }}>
          {thread.full_name ?? 'Messenger user'}
        </div>
        <div className="truncate text-[11.5px]" style={{ color: 'var(--lead-muted)' }}>
          via {thread.page_name ?? 'Facebook page'}
        </div>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={toggling}
        title={title}
        aria-label={title}
        className="lead-focus inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium transition-colors disabled:opacity-50"
        style={pillStyle}
      >
        <span
          aria-hidden
          className="inline-block h-1.5 w-1.5 rounded-full"
          style={{
            background:
              !thread.auto_reply_enabled
                ? 'var(--lead-faint)'
                : isPaused
                  ? 'var(--lead-warning, #f59e0b)'
                  : '#fff',
          }}
        />
        {label}
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Pass `onResume` from `ConversationPanel` to `Header`**

```tsx
<Header
  thread={thread}
  toggling={toggling}
  onToggleAuto={onToggleAuto}
  onResume={onResume}
/>
```

- [ ] **Step 5: Update the footnote**

Replace the `<p>` at the bottom of `ConversationPanel` (~line 186-188):

```tsx
<p className="text-[11px]" style={{ color: 'var(--lead-faint)' }}>
  ⌘ + Enter to send. Sending pauses the bot until you stop chatting.
</p>
```

(Keep it simple — the precise duration is shown on the pill once it fires. Including the dynamic minute count here would require fetching `human_takeover_minutes`, which isn't worth the extra request for an explanatory line.)

- [ ] **Step 6: Type-check and run lint**

```bash
pnpm tsc --noEmit
pnpm lint
```

Expected: PASS.

- [ ] **Step 7: Manually exercise the UI**

Start the dev server (if not already running) and:
1. Open a lead with an existing Messenger thread.
2. Confirm the pill reads "Bot on".
3. Send a reply. After the panel refreshes, pill should read "Paused · 60m" (or whatever your `human_takeover_minutes` setting is).
4. Click the paused pill. Pill should flip back to "Bot on".
5. Click the pill again. Toggle to "Bot off". Confirm clicking once more clears any pause stamp (it should — verified by Task 4's logic).

If you can't dev-test interactively, say so explicitly in the commit message — type checks and unit tests verify code correctness, not feature correctness.

- [ ] **Step 8: Commit**

```bash
git add src/app/\(app\)/dashboard/leads/_components/ConversationPanel.tsx
git commit -m "feat(leads): three-state bot pill with auto-pause countdown"
```

---

## Task 11: `HumanTakeoverForm` settings UI

Small form on the chatbot dashboard page that GETs `/api/chatbot/takeover-settings`, lets the operator change the number, and PUTs.

**Files:**
- Create: `src/app/(app)/dashboard/chatbot/_components/HumanTakeoverForm.tsx`
- Modify: `src/app/(app)/dashboard/chatbot/page.tsx`

- [ ] **Step 1: Look at the existing `AutoFollowupForm` for the pattern**

Read `src/app/(app)/dashboard/chatbot/_components/AutoFollowupForm.tsx` to copy its load-on-mount + save-on-blur pattern. Match the same Tailwind classes and CSS variables.

- [ ] **Step 2: Implement the component**

```tsx
// src/app/(app)/dashboard/chatbot/_components/HumanTakeoverForm.tsx
'use client'

import { useEffect, useState, useTransition } from 'react'

export function HumanTakeoverForm() {
  const [minutes, setMinutes] = useState<number | ''>('')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, startSave] = useTransition()
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/chatbot/takeover-settings')
      .then((r) => r.json())
      .then((data: { human_takeover_minutes?: number }) => {
        setMinutes(typeof data.human_takeover_minutes === 'number' ? data.human_takeover_minutes : 60)
        setLoaded(true)
      })
      .catch(() => {
        setMinutes(60)
        setLoaded(true)
      })
  }, [])

  const save = (value: number) => {
    setError(null)
    startSave(async () => {
      const res = await fetch('/api/chatbot/takeover-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ human_takeover_minutes: value }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setError(data.error ?? 'Save failed')
        return
      }
      setSavedAt(Date.now())
    })
  }

  if (!loaded) {
    return <div className="text-[12.5px] text-neutral-500">Loading…</div>
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-[13px] font-medium">
        Pause bot after I reply to a customer
      </label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          max={1440}
          step={1}
          value={minutes}
          onChange={(e) => {
            const v = e.target.value === '' ? '' : Math.floor(Number(e.target.value))
            setMinutes(v)
          }}
          onBlur={() => {
            if (minutes === '' || Number.isNaN(minutes)) return
            save(minutes)
          }}
          className="w-24 rounded-md border border-neutral-300 px-2 py-1 text-[13px]"
          disabled={saving}
        />
        <span className="text-[12.5px] text-neutral-600">minutes</span>
        {saving && <span className="text-[11.5px] text-neutral-500">Saving…</span>}
        {!saving && savedAt && <span className="text-[11.5px] text-green-700">Saved</span>}
      </div>
      <p className="text-[11.5px] text-neutral-500">
        When you reply in the lead conversation panel, the bot pauses for this many minutes. Set to 0 to disable auto-pause.
      </p>
      {error && <p className="text-[11.5px] text-red-600">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Render it on the chatbot dashboard page**

In `src/app/(app)/dashboard/chatbot/page.tsx`, import and render `<HumanTakeoverForm />` in a sensible spot (near the `AutoFollowupForm`, or wherever the personality/classification settings live). Wrap it in whatever section/heading style the existing settings on that page use:

```tsx
import { HumanTakeoverForm } from './_components/HumanTakeoverForm'

// ...inside the existing JSX, near other settings:
<section className="...">
  <h2 className="...">Human takeover</h2>
  <HumanTakeoverForm />
</section>
```

(Match the heading/section conventions you see in the existing page — don't invent new ones.)

- [ ] **Step 4: Type-check and lint**

```bash
pnpm tsc --noEmit
pnpm lint
```

Expected: PASS.

- [ ] **Step 5: Manually exercise**

Load `/dashboard/chatbot` in the browser. Confirm:
1. The form loads with `60` (default).
2. Changing to `30` and blurring shows "Saving…" then "Saved".
3. Reloading the page shows the saved value.
4. Setting `-1` or `2000` shows an inline error.
5. Setting `0` saves successfully.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)/dashboard/chatbot/_components/HumanTakeoverForm.tsx src/app/\(app\)/dashboard/chatbot/page.tsx
git commit -m "feat(chatbot): HumanTakeoverForm settings UI for pause duration"
```

---

## Task 12: Final verification

- [ ] **Step 1: Run the full test suite**

```bash
pnpm vitest run
```

Expected: PASS — all tests, including the new ones and all pre-existing.

- [ ] **Step 2: Run type-check and lint over the whole repo**

```bash
pnpm tsc --noEmit
pnpm lint
```

Expected: clean.

- [ ] **Step 3: End-to-end manual check**

Spin up the dev server. In a real Messenger conversation (or your dev page if you have one):

1. Send an inbound message to a connected page → confirm the bot replies normally.
2. Use the Conversation panel to send an operator reply → confirm the panel refreshes with "Paused · Nm".
3. Send another inbound message during the pause → confirm the bot does NOT reply (check `messenger_messages` rows / FB inbox).
4. Wait out the timer (or manually edit `bot_paused_until` in DB to a past timestamp) → send another inbound → confirm the bot DOES reply.
5. Toggle the pill to "Bot off" → confirm sticky behavior unchanged.
6. Toggle back to "Bot on" while paused → confirm pause clears immediately.

If steps 1-6 all behave as expected, the feature is done.

- [ ] **Step 4: Final commit (only if any cleanup needed)**

If verification surfaced any small fixes, commit them individually. If everything works, no extra commit needed — the task is complete.

---

## Self-Review (writer's notes)

**Spec coverage check:**
- Data model (2 columns) → Task 1 ✓
- `replyAsOperator` stamping logic → Task 3 ✓
- `setAutoReply(true)` clears pause → Task 4 ✓
- `resumeBot` action → Task 5 ✓
- `loadConversation` exposes pause field → Task 6 ✓
- Webhook gate → Task 7 ✓
- Worker re-check → Task 8 ✓
- `human_takeover_minutes` config endpoint → Task 9 ✓
- 3-state pill UI → Task 10 ✓
- Settings form UI → Task 11 ✓
- Edge cases (rapid sends, FB failure, race) → covered by tests in Tasks 3, 4, 7, 8

**Placeholder scan:** No "TBD"/"TODO". Test stubs in Tasks 7 and 8 reference the existing test harnesses by name and tell the implementer to read them first — they describe the assertion clearly without re-implementing the harness inside the plan.

**Type consistency:** `bot_paused_until: string | null` in DB, `loadConversation` return, `ThreadRow` (worker), webhook select. `isBotPaused(string | null | undefined, Date?)` signature consistent across helper, webhook, worker. `human_takeover_minutes: number` (integer) in DB, route schema, and `replyAsOperator` read.

**Spec fidelity:** Task 3 places the pause stamp outside the `if (!sendError)` block so it runs in both success and failure paths, matching the spec's "stamp on failure too" rule. Two thread updates on the success path (one for the stamp, one for the tail) — acceptable given the operator-action volume is low.
