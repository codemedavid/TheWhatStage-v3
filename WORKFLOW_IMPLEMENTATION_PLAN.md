# Workflow & Automation — Implementation Plan

Status: draft for review · Owner: David · Last updated: 2026-05-05

This plan layers a workflow/automation engine on top of the existing **leads → stages → action pages → messenger** stack. It includes the prerequisite fixes that the audit surfaced — without those, the engine will misbehave on day one.

---

## 1. Goals

1. Build automations triggered by **stage events**, **inactivity**, **action-page submissions**, **bookings**, and (later) **abandoned carts**.
2. Branch on **whether the customer replied**, **current stage**, **submission outcome**, and **AI classification**.
3. Send messages safely under **Meta's post-April-2026 messaging rules** (no dead tags).
4. Coordinate with the existing chatbot so they never fight over the same thread.
5. Provide a visual builder, dry-run/test mode, and per-step audit logs./ting leads via email/phone — orphans accumulate.
- **A5.** When `outcome` matches no `pipeline_rule`, the code silently does nothing. No audit row.
- **A6.** Two concurrent submissions can read the same `max(position)` and produce duplicate stage positions.

### Pipeline stages
- **S1.** Stage transitions are read-modify-write across separate queries — no `FOR UPDATE` lock. AI classifier, action page, UI, and (soon) workflow can interleave and cause skips/ping-pong.
- **S2.** `lead_stage_events` has no `idempotency_key` — a retried classifier or webhook will double-log.
- **S3.** Submission handler never validates `to_stage_id` belongs to the user.
- **S4.** No `leads.version` / `updated_at` optimistic-lock column.

### Messenger coupling
- **M1.** `last_inbound_at` is not tracked on `messenger_threads`; only `last_message_at` (any direction). The 24-hour window cannot be computed correctly.
- **M2.** Outbound sends are scattered across at least three files (`process/route.ts`, `submit/route.ts`, `comments.ts`). No central gate, no shared rate-limit, no shared logging.
- **M3.** All sends assume `messaging_type=RESPONSE`. No support for `MESSAGE_TAG` (HUMAN_AGENT only — see §3), Marketing Messages, OTN, or Utility Messages.
- **M4.** `auto_reply_enabled` is per-thread only — no per-lead, per-campaign, or per-run override. Workflows have no way to claim a thread.
- **M5.** No opt-in / OTN-token / utility-template registries.ok

These are **prerequisite work**, not nice-to-haves. The engine inherits them.

---

## 3. Messaging policy (post April 27, 2026)

Three Message Tags returned **error 100** as of 2026-04-27: `CONFIRMED_EVENT_UPDATE`, `ACCOUNT_UPDATE`, `POST_PURCHASE_UPDATE`. Surviving paths:

| Path | When usable | Use case |
| --- | --- | --- |
| Standard `RESPONSE` / `UPDATE` | Inside 24h of last user inbound | Any reply, including promo |
| `MESSAGE_TAG = HUMAN_AGENT` | 7 days, **manual human send only** | Operator inbox, not automation |
| **Utility Message** (template) | Anytime, pre-approved | Order / account / appointment updates (booking ladder lives here) |
| **Marketing Message** | After explicit opt-in | Promo re-engagement, cart abandonment |
| **One-Time Notification** | After per-topic opt-in, single send | "Notify me when…" one-shot |
| Sponsored Message | Paid | Outside scope of this plan |
| Private Reply | 7d after a comment / visitor post | Comment automation (already partially built) |

**Implication:** the booking 3d/2h/10m ladder requires an approved Messenger Utility template. The cart-abandonment flow requires Marketing-Message opt-in (collected on the action page or in-thread).

---

## 4. Mental model

```
Events ──┬─► Trigger Dispatcher ──► workflow_runs (one row per active run)
         │
Inbound ─┴─► Interrupt Router ─────► wakes runs waiting on this thread
                                          │
                                          ▼
                              ┌──── Executor (tick + event-driven) ────┐
                              │  classify_and_route  (reuses LLM)       │
                              │  send                (channel policy)   │
                              │  set_stage           (atomic, audited)  │
                              │  request_marketing_optin                │
                              │  request_otn                            │
                              │  wait / wait_for_reply / if / stop      │
                              └─────────────────────────────────────────┘
                                          │
                              workflow_run_steps (per-node audit log)
```

**One coordinator** decides who owns the thread (bot vs run vs operator). **One channel-policy resolver** picks Standard / Utility / Marketing / OTN / pause. **One trigger dispatcher** with idempotency keys. **One executor** that's both tick-driven AND event-driven so wait-for-reply branches resolve instantly.

---

## 5. Schema changes

### 5.1 Prerequisites (audit fixes)

```sql
-- A1, A2: structured booking events
create table booking_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  submission_id uuid not null references action_page_submissions(id) on delete cascade,
  lead_id uuid references leads(id),
  event_at timestamptz not null,           -- always UTC
  timezone text not null,                  -- IANA, for display
  duration_minutes int,
  status text not null default 'scheduled' -- scheduled|cancelled|completed
);
create index on booking_events (event_at) where status = 'scheduled';

-- A3: opt-in capture on submission
alter table action_page_submissions
  add column marketing_optin boolean default false,
  add column reminder_optin  boolean default false;

-- S1, S4: optimistic lock on leads
alter table leads add column version int not null default 0;

-- S2: idempotent stage-event audit
alter table lead_stage_events add column idempotency_key text;
create unique index on lead_stage_events (idempotency_key) where idempotency_key is not null;

-- M1: real 24h-window tracking
alter table messenger_threads
  add column last_inbound_at timestamptz,
  add column last_outbound_at timestamptz,
  add column controlled_by_run_id uuid;       -- M4: thread ownership

-- M5: opt-in / token / template registries
create table messenger_marketing_optins (
  thread_id uuid primary key references messenger_threads(id) on delete cascade,
  user_id uuid not null,
  opted_in_at timestamptz not null default now(),
  opted_out_at timestamptz,
  source text
);

create table messenger_otn_tokens (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references messenger_threads(id) on delete cascade,
  user_id uuid not null,
  topic text not null,
  token text not null,
  requested_at timestamptz not null default now(),
  consumed_at timestamptz,
  expires_at timestamptz
);
create index on messenger_otn_tokens (thread_id, topic) where consumed_at is null;

create table messenger_utility_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  category text not null check (category in ('appointment','order','account')),
  language text not null default 'en_US',
  body text not null,
  variables jsonb not null default '[]',
  buttons jsonb not null default '[]',
  meta_template_id text,
  status text not null default 'pending' -- pending|approved|rejected
);
create unique index on messenger_utility_templates (user_id, name, language);
```

### 5.2 Workflow engine

```sql
create table workflows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  status text not null default 'draft', -- draft|active|paused|archived
  trigger jsonb not null,               -- {kind, config}
  graph   jsonb not null,               -- {nodes:[...], edges:[...]}
  version int  not null default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows(id),
  workflow_version int not null,        -- pinned at start; edits don't break in-flight runs
  user_id uuid not null,
  lead_id uuid references leads(id),
  thread_id uuid references messenger_threads(id),
  current_node_id text,
  state jsonb not null default '{}',
  status text not null default 'running', -- running|waiting|done|cancelled|failed
  next_run_at timestamptz,
  dedup_key text not null,              -- e.g. wf:{id}:lead:{id}:stage_entry:{event_id}
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create unique index on workflow_runs (dedup_key);
create index on workflow_runs (status, next_run_at);
create index on workflow_runs (thread_id) where status in ('running','waiting');

create table workflow_run_steps (
  id bigserial primary key,
  run_id uuid not null references workflow_runs(id) on delete cascade,
  node_id text not null,
  node_type text not null,
  entered_at timestamptz not null default now(),
  exited_at timestamptz,
  decision text,    -- which edge was taken
  payload jsonb,
  error text
);
create index on workflow_run_steps (run_id, entered_at);

create table workflow_jobs (   -- worker queue, mirrors messenger_jobs pattern
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references workflow_runs(id) on delete cascade,
  scheduled_at timestamptz not null default now(),
  status text not null default 'queued',
  attempts int not null default 0,
  last_error text,
  created_at timestamptz default now()
);
create index on workflow_jobs (status, scheduled_at);
```

---

## 6. Trigger types (v1)

| Kind | Source | Dedup key | Notes |
| --- | --- | --- | --- |
| `stage_entered` | INSERT on `lead_stage_events` | `wf:{id}:lse:{event_id}` | Filter by `to_stage_id` |
| `stage_idle` | cron sweep (every 1 min) | `wf:{id}:lead:{id}:idle:{stage_id}:{bucket}` | "in stage X for ≥ N min with no inbound" |
| `submission_received` | INSERT on `action_page_submissions` | `wf:{id}:sub:{submission_id}` | Filter by action_page_id and/or outcome |
| `booking_offset` | INSERT/UPDATE on `booking_events` | `wf:{id}:bk:{event_id}:{offset}` | Each offset (-3d, -2h, -10m) gets its own run |
| `cart_abandoned` | cron sweep (every 1 min) | `wf:{id}:cart:{cart_id}` | Active cart idle ≥ N min; Messenger opt-in required for out-of-window sends |

All triggers go through one dispatcher. Adding a trigger kind = registering a `(detector, dedup_key_fn, run_seed_fn)`.

---

## 7. Node types (v1)

| Type | Purpose | Edges |
| --- | --- | --- |
| `send` | Send message via channel policy | `success`, `policy_blocked`, `error` |
| `set_stage` | Atomic stage move, audited | `then` |
| `wait` | Until a duration OR an absolute time, with optional `interrupt_on: [inbound_message, stage_changed, submission_received]` | `timeout`, `interrupted_*` (one per interrupt) |
| `wait_for_reply` | Sugar for `wait(interrupt_on=inbound_message)` | `on_reply`, `on_timeout` |
| `if` | Typed conditions (`in_stage`, `replied_within(t)`, `submission_outcome_is`, `custom_field_eq`) with AND/OR | `then`, `else` |
| `classify_and_route` | Calls existing `answerWithClassification` | `stage_changed`, `action_page_recommended`, `continue` |
| `request_marketing_optin` | Sends opt-in card; writes row on accept | `accepted`, `declined`, `timeout` |
| `request_otn` | Sends OTN request; stores token on grant | `granted`, `declined`, `timeout` |
| `stop` | Terminates run | — |

Free-form expression builders are explicitly **out of scope** for v1. Add primitives only as real workflows demand them.

---

## 8. Channel-policy resolver (the lock-in piece)

`resolveSendPolicy(thread, lead, node) → { mode, payload | reason_paused }`:

1. Inside 24h of `last_inbound_at` → `RESPONSE` (or `UPDATE` for proactive).
2. Out of 24h **and** node references an approved utility template **and** lead has the required variables → `UTILITY_TEMPLATE`.
3. Out of 24h **and** node is promotional **and** thread has active `messenger_marketing_optins` → `MARKETING_MESSAGE`.
4. Out of 24h **and** unconsumed OTN token matches node's `topic` → `OTN` (consumes token).
5. Operator UI only (never workflow) → `MESSAGE_TAG=HUMAN_AGENT`.
6. Otherwise → run pauses with `status='waiting', state.waiting_for='window|optin|otn'`. Resume on next inbound or consent acquisition.

All outbound sends go through one helper `sendOutbound(threadId, node, payload)` that calls the resolver. Existing scattered `fetch('graph.facebook.com')` calls (M2) get refactored behind it. The chatbot, action-page echo reply, and workflow `send` node all share the same path.

---

## 9. Coordination: bot vs workflow vs operator

`messenger_threads.controlled_by_run_id` is the lock.

- When a workflow run reaches a `wait_for_reply` (or any node that yields), it sets `controlled_by_run_id = run.id`.
- The chatbot worker (`/api/messenger/process`) checks: if `controlled_by_run_id` is set, it **classifies** the inbound (so stage moves still happen) but **does not auto-reply** — it instead enqueues an interrupt event for the run.
- Operators in the inbox can always send manually (HUMAN_AGENT tag), which clears `controlled_by_run_id` and pauses any active run with reason `operator_took_over`.
- On run completion, lock is cleared.

This prevents the bot/workflow double-send and the AI-vs-workflow stage ping-pong.

---

## 10. Atomic stage moves (fixes S1–S4)

Single SQL function used by classifier, submission handler, workflow executor, and UI:

```sql
create or replace function set_lead_stage(
  p_lead_id uuid, p_to_stage uuid, p_source text,
  p_reason text, p_idempotency_key text, p_expected_version int default null
) returns boolean ...
```

- Locks the lead row with `FOR UPDATE`.
- If `p_expected_version` provided and mismatched, returns false (caller decides).
- Inserts `lead_stage_events` with `idempotency_key`; conflict on key = no-op success.
- Validates `to_stage_id` belongs to the lead's user.
- Bumps `leads.version`.

All four call sites (`classify.ts:applyStageChange`, `submit/route.ts:applyStageMove`, workflow `set_stage` node, dashboard UI) replace their hand-rolled logic with this function.

---

## 11. Execution loop

- **Cron** (`/api/cron/workflow-tick`, every 1 min): claim `workflow_jobs` where `scheduled_at <= now()`, run the executor.
- **Event-driven**: stage events, inbound messages, submission inserts, opt-in/OTN grants → `triggerWorkflowWorker()` (mirrors `triggerWorker()` in messenger path) so reply-driven branches don't wait for the next tick.
- Per-run advisory lock so the same run never runs twice in parallel.
- Executor runs nodes synchronously until it hits a `wait*`, persists `current_node_id` + `state`, schedules next `workflow_jobs` row.
- Failure: 3 retries with exponential backoff, then `status='failed'` and a `workflow_run_steps` row with the error. Surfaced in UI.

---

## 12. UI

- `/dashboard/workflows` — list, status, last-run-at, success/failure counts.
- `/dashboard/workflows/[id]` — React Flow canvas, right-rail node config, trigger picker at top.
- **Test mode**: pick a real lead → dry-run (no sends, no stage writes) → see `workflow_run_steps` rendered inline on the canvas with decisions and timings.
- **Health surface**: workflow detail shows pending utility-template approvals, missing opt-ins, and any `policy_blocked` / `failed` runs in the last 7 days.

---

## 13. Build order

| Step | Scope | Unblocks |
| --- | --- | --- |
| **0. Audit fixes** — schema migrations from §5.1, atomic `set_lead_stage`, `last_inbound_at` tracking, opt-in fields on submissions, structured `booking_events` | Everything below |
| **1. Outbound coordinator + channel policy** — single `sendOutbound` helper; refactor scattered Graph calls; thread-ownership lock; chatbot defers when `controlled_by_run_id` set | Workflow `send` node, safe automation |
| **2. Workflow schema + executor skeleton** — tables from §5.2; cron + event-driven loop; nodes: `wait` (with `interrupt_on`), `send`, `set_stage`, `if`, `classify_and_route`, `stop` | Stage-based automations |
| **3. Triggers** — `stage_entered`, `stage_idle`, `submission_received`, `booking_offset` | Real customer flows |
| **4. Opt-in / OTN nodes + utility-template registry** — `request_marketing_optin`, `request_otn`, template CRUD + Meta approval workflow | Outside-24h sends, booking ladder |
| **5. UI canvas + test mode + health surface** — | User-visible feature |
| **6. Cart-abandoned trigger** — `carts` + `cart_items` schema; `dispatchCartAbandoned` + `sweepCartAbandonedTriggers` cron sweep; re-engagement via Messenger channel policy (Marketing opt-in required for out-of-window sends) | E-comm re-engagement |

Each step is independently shippable. Step 0 should land on its own branch and be QA'd before step 1, because everything downstream assumes those invariants.

---

## 14. Open questions for review

1. **Opt-in collection point.** Default proposal: capture `marketing_optin` and `reminder_optin` checkboxes on the action page submission form. Alternative: a dedicated in-thread `request_marketing_optin` node only. Recommend both, with action-page checkbox as the primary source.
2. **Booking timezones.** Store `event_at` UTC + `timezone` IANA on `booking_events`. Reminders compute offsets in UTC; display strings render in the lead's TZ if known, else the page's TZ. OK?
3. **Chatbot deference.** When a run owns the thread, should the classifier still run on inbound (for stage moves and interrupt routing) but suppress the auto-reply? Recommended: yes. Confirm.
4. **Operator override semantics.** When an operator manually replies, do active runs `pause` (resumable) or `cancel`? Recommend pause with a 24h auto-resume timer, surfaced in the UI.
5. **Versioning.** Edits to an active workflow create a new `version`; in-flight runs finish on their pinned version. New triggers fire the latest. Confirm we want this vs. cancel-and-restart.
6. **Cart-abandoned channel.** This project is **Messenger-only** — WhatsApp is out of scope. Cart abandonment re-engagement runs over Messenger and uses the existing Marketing-Message opt-in path. Users without opt-in will have the run pause until the lead messages again.

---

## 15. Out of scope (for v1)

- Free-form condition expression builder
- Multi-channel fan-out in a single node (one channel per send)
- A/B testing on workflow branches
- Per-node analytics dashboards beyond run/step audit
- **WhatsApp / any channel other than Messenger** — this project is Messenger-only
- Workflow import/export, marketplace
