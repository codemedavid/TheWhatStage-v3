# Superadmin User Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the superadmin (a) see every signup, (b) approve pending signups before they can use the app, and (c) pause / resume an active user — where "pause" means the user can't log in *and* their Messenger bot stops replying. One switch.

**Architecture:** Single source of truth is `profiles.status` (enum: `pending` | `active` | `paused`). The auth gate runs in `getSession()` (so every authed page already enforces it) and in the Facebook webhook handler (so the bot goes silent for paused users). The superadmin UI uses server actions calling the existing `createAdminClient()`. The dashboard list query is already fixed (commit prior to this plan); this plan adds the status column, action buttons, and the underlying state machine.

**Tech Stack:** Next.js App Router (Server Components + server actions), Supabase Postgres + RLS, zod 4 for validation, Vitest for tests, TypeScript strict.

**Open assumption (confirmed in chat):** "Pause account" = "pause bot." A single `profiles.status = 'paused'` blocks both surfaces. No separate `chatbot_configs.is_paused` flag.

---

## File Structure

**New files:**
- `supabase/migrations/20260519010000_account_status.sql` — enum + column + backfill + trigger update
- `src/lib/auth/account-status.ts` — status type, sign-out helper, gate helpers
- `src/lib/auth/account-status.test.ts` — unit tests
- `src/app/(auth)/account-paused/page.tsx` — landing page shown to paused users after sign-out
- `src/app/(auth)/account-pending/page.tsx` — landing page shown to pending users after sign-out
- `src/app/api/superadmin/users/[id]/status/route.ts` — POST endpoint for approve/pause/resume
- `src/app/api/superadmin/users/[id]/status/route.test.ts` — API tests (gating + transitions)
- `src/app/(app)/dashboard/_components/UserRowActions.tsx` — client component with action buttons

**Modified files:**
- `src/lib/auth/get-session.ts` — return `status` on session; nothing else
- `src/app/(auth)/actions.ts` — after sign-in, if `status !== 'active'`, sign back out and redirect
- `src/app/api/webhooks/facebook/route.ts` — early-return for paused users (look up by page → user)
- `src/app/(app)/dashboard/_components/SuperadminDashboard.tsx` — render status badge + actions column

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260519010000_account_status.sql`

- [ ] **Step 1: Write the migration**

```sql
-- =========================================================================
-- Account status: superadmin-controlled lifecycle for user accounts.
-- New signups land as 'pending'. Superadmin flips to 'active' to grant
-- access. 'paused' blocks login AND the Messenger bot (webhook checks).
-- =========================================================================

create type public.account_status as enum ('pending', 'active', 'paused');

alter table public.profiles
  add column status public.account_status not null default 'pending';

-- Backfill: every existing user is already trusted.
update public.profiles set status = 'active' where status = 'pending';

-- Index for the webhook hot path (lookup by page → user → status).
create index if not exists profiles_status_idx on public.profiles (status);

-- New signups should land as 'pending', not auto-active.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, status)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'New user'),
    'user',
    'pending'
  );
  return new;
end;
$$;
```

- [ ] **Step 2: Verify locally** — run the migration, check that all 29 existing users are `active` and the superadmin is `active`.

---

## Task 2: Status type + session extension

**Files:**
- Create: `src/lib/auth/account-status.ts`
- Modify: `src/lib/auth/get-session.ts`

- [ ] **Step 1:** Export `AccountStatus = 'pending' | 'active' | 'paused'` and a `zAccountStatus` zod enum from `account-status.ts`.

- [ ] **Step 2:** In `get-session.ts`, add `status` to the profile select and to `SessionContext`. Default to `'active'` if missing (back-compat for the first request after migration).

- [ ] **Step 3:** Write tests covering pending/active/paused branches.

---

## Task 3: Block login for non-active users

**Files:**
- Modify: `src/app/(auth)/actions.ts`
- Create: `src/app/(auth)/account-paused/page.tsx`, `src/app/(auth)/account-pending/page.tsx`

- [ ] **Step 1:** After a successful `signInWithPassword`, read `profiles.status`. If `pending`, call `signOut()` and redirect to `/account-pending`. If `paused`, sign out and redirect to `/account-paused`.

- [ ] **Step 2:** Build the two landing pages — short copy, no auth required, no link back to the app. Match the existing `(auth)` layout.

- [ ] **Step 3:** Belt-and-braces: in `getSession()`, if status is not `active`, return null. Any authed page will then bounce to login. (Prevents an active session from continuing if the superadmin pauses mid-session — the next request fails the auth gate.)

- [ ] **Step 4:** Tests: assert that a paused user calling a server action gets bounced.

---

## Task 4: Pause the bot

**Files:**
- Modify: `src/app/api/webhooks/facebook/route.ts`

- [ ] **Step 1:** Inside the message handler, after resolving `user_id` from the Facebook page ID, query `profiles.status`. If `!== 'active'`, log and `return` (no reply, no DB writes that would create a lead). Use `createAdminClient()` since the webhook has no user session.

- [ ] **Step 2:** Add a test that simulates an incoming Messenger event for a paused user and asserts the handler short-circuits.

---

## Task 5: Status API route

**Files:**
- Create: `src/app/api/superadmin/users/[id]/status/route.ts`

- [ ] **Step 1:** POST handler. Body: `{ status: 'active' | 'paused' }`. Auth: require `getSession()?.role === 'superadmin'`. Forbid self-modification (superadmin can't pause themselves). Forbid demoting another superadmin's status — narrow blast radius.

- [ ] **Step 2:** Use `createAdminClient()` to update `profiles.status`. Return the updated row.

- [ ] **Step 3:** Tests: 401 for non-superadmin, 400 for invalid status, 403 for self-pause, 200 + state change for the happy path.

**Transitions allowed:** `pending → active`, `active → paused`, `paused → active`. (No "unapprove" — once active, you only pause/resume.)

---

## Task 6: Superadmin UI

**Files:**
- Modify: `src/app/(app)/dashboard/_components/SuperadminDashboard.tsx`
- Create: `src/app/(app)/dashboard/_components/UserRowActions.tsx`

- [ ] **Step 1:** Add a `Status` column to the table with colored badges (`pending` amber, `active` green, `paused` neutral/gray). Sort: `pending` rows first, then `active`, then `paused`.

- [ ] **Step 2:** `UserRowActions` is a client component. Renders the right button based on current status: "Approve" for pending, "Pause" for active, "Resume" for paused. Confirms via native `confirm()` (skip a modal for now). On click, calls `POST /api/superadmin/users/:id/status` then `router.refresh()`.

- [ ] **Step 3:** Hide the action column for the superadmin's own row.

---

## Verification checklist

- [ ] New signup lands as `pending`; can't log in; sees `/account-pending` page.
- [ ] Superadmin approves → user can log in normally.
- [ ] Superadmin pauses an active user → user's next request signs them out; bot stops replying to messages on their Facebook page.
- [ ] Superadmin resumes → both surfaces work again.
- [ ] Existing 29 users are unaffected (all `active`).
- [ ] Superadmin can't pause themselves.
- [ ] Non-superadmin hitting the status route gets 401.

---

## Out of scope (deliberate)

- Email notifications on approve/pause. Add when needed.
- Audit log of status changes. Add when needed.
- Soft-delete / hard-delete. Pause is enough for now.
- Self-service signup reactivation flows. Superadmin-driven only.
