# Auth & Role-Based Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship email/password signup + login for end-users, backed by a `profiles` table with a role enum (`user`/`admin`/`superadmin`), RLS, a JWT custom-claim hook, and a gated dashboard shell. No admin/superadmin UI in this iteration.

**Architecture:** Supabase Auth (email/password, no email confirmation) + Postgres `profiles` table created automatically via trigger on `auth.users` insert. Role is non-writable by clients (RLS) and surfaced into the JWT via a custom access token hook. Next.js 16 App Router with `(auth)` and `(app)` route groups; `proxy.ts` (Next 16's renamed middleware) gates routes. All forms use Server Actions with shared Zod schemas.

**Tech Stack:** Next.js 16.2.4 (App Router, `proxy.ts`), React 19.2.4, Tailwind v4, `@supabase/ssr` 0.10.2, `@supabase/supabase-js` 2.105.0, Zod, Supabase CLI for migrations.

**Spec:** `docs/superpowers/specs/2026-04-28-auth-roles-design.md`

---

## File Structure

**Create:**
- `supabase/config.toml` — Supabase local config + access-token hook registration
- `supabase/migrations/20260428000000_auth_profiles.sql` — schema, RLS, triggers, hook fn
- `src/lib/auth/schemas.ts` — Zod schemas for email/password/full_name
- `src/lib/auth/get-session.ts` — server helper returning `{ user, profile }` or `null`
- `src/app/(auth)/layout.tsx` — centered auth card; redirects if already signed in
- `src/app/(auth)/login/page.tsx`
- `src/app/(auth)/signup/page.tsx`
- `src/app/(auth)/actions.ts` — `signUpAction`, `signInAction`
- `src/app/(auth)/_components/auth-form.tsx` — shared form primitives
- `src/app/(app)/layout.tsx` — sidebar + topbar shell
- `src/app/(app)/dashboard/page.tsx` — empty content panels
- `src/app/(app)/_components/sidebar.tsx`
- `src/app/(app)/_components/topbar.tsx`
- `src/app/auth/signout/route.ts` — POST handler
- `src/lib/auth/__tests__/schemas.test.ts` — Zod unit tests

**Modify:**
- `package.json` — add `zod`, `vitest`, `@vitejs/plugin-react`, `jsdom`, `@types/node`, test script
- `src/lib/supabase/proxy.ts` — add gated-route + auth-route redirects
- `src/app/page.tsx` — redirect to `/dashboard` (signed in) or `/login` (anonymous)
- `src/app/layout.tsx` — keep root simple; ensure body uses design-system background
- `src/app/globals.css` — add DESIGN.md color/typography tokens

**Delete (cleanup of starter):** none — `src/app/page.tsx` is rewritten in place.

---

## Task 1: Add dependencies and test runner

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install runtime dep**

Run: `npm install zod`

- [ ] **Step 2: Install dev deps for tests**

Run: `npm install -D vitest @vitejs/plugin-react jsdom`

- [ ] **Step 3: Add test script**

Edit `package.json`'s `scripts` to add:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 4: Create `vitest.config.ts` at repo root**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
```

- [ ] **Step 5: Verify it runs**

Run: `npx vitest run --reporter=verbose`
Expected: exits 0 with "No test files found" (or similar). No errors.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add zod and vitest"
```

---

## Task 2: Zod auth schemas (TDD)

**Files:**
- Create: `src/lib/auth/schemas.ts`
- Test: `src/lib/auth/__tests__/schemas.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/lib/auth/__tests__/schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { signUpSchema, signInSchema } from '../schemas'

describe('signUpSchema', () => {
  it('accepts valid input and lowercases email', () => {
    const out = signUpSchema.parse({
      full_name: '  Ada Lovelace  ',
      email: 'Ada@Example.COM',
      password: 'hunter12a',
    })
    expect(out).toEqual({
      full_name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'hunter12a',
    })
  })

  it('rejects password without a digit', () => {
    const r = signUpSchema.safeParse({
      full_name: 'A',
      email: 'a@b.co',
      password: 'abcdefgh',
    })
    expect(r.success).toBe(false)
  })

  it('rejects password without a letter', () => {
    const r = signUpSchema.safeParse({
      full_name: 'A',
      email: 'a@b.co',
      password: '12345678',
    })
    expect(r.success).toBe(false)
  })

  it('rejects password under 8 chars', () => {
    const r = signUpSchema.safeParse({
      full_name: 'A',
      email: 'a@b.co',
      password: 'abc1',
    })
    expect(r.success).toBe(false)
  })

  it('rejects empty full_name after trim', () => {
    const r = signUpSchema.safeParse({
      full_name: '   ',
      email: 'a@b.co',
      password: 'abcdefg1',
    })
    expect(r.success).toBe(false)
  })

  it('rejects full_name over 80 chars', () => {
    const r = signUpSchema.safeParse({
      full_name: 'a'.repeat(81),
      email: 'a@b.co',
      password: 'abcdefg1',
    })
    expect(r.success).toBe(false)
  })

  it('rejects bad email', () => {
    const r = signUpSchema.safeParse({
      full_name: 'A',
      email: 'not-an-email',
      password: 'abcdefg1',
    })
    expect(r.success).toBe(false)
  })
})

describe('signInSchema', () => {
  it('accepts and lowercases email', () => {
    const out = signInSchema.parse({ email: 'A@B.CO', password: 'whatever1' })
    expect(out).toEqual({ email: 'a@b.co', password: 'whatever1' })
  })

  it('rejects empty password', () => {
    const r = signInSchema.safeParse({ email: 'a@b.co', password: '' })
    expect(r.success).toBe(false)
  })
})
```

- [ ] **Step 2: Verify they fail**

Run: `npm test`
Expected: fails with "Cannot find module '../schemas'".

- [ ] **Step 3: Implement schemas**

Create `src/lib/auth/schemas.ts`:

```ts
import { z } from 'zod'

const email = z.string().trim().toLowerCase().email('Enter a valid email address.')

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .regex(/[A-Za-z]/, 'Password must contain a letter.')
  .regex(/[0-9]/, 'Password must contain a number.')

const fullName = z
  .string()
  .trim()
  .min(1, 'Full name is required.')
  .max(80, 'Full name must be 80 characters or fewer.')

export const signUpSchema = z.object({
  full_name: fullName,
  email,
  password,
})

export const signInSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required.'),
})

export type SignUpInput = z.infer<typeof signUpSchema>
export type SignInInput = z.infer<typeof signInSchema>
```

- [ ] **Step 4: Verify tests pass**

Run: `npm test`
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/schemas.ts src/lib/auth/__tests__/schemas.test.ts
git commit -m "feat(auth): add zod schemas for signup and signin"
```

---

## Task 3: Database migration — enum, profiles, RLS, triggers, hook

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/20260428000000_auth_profiles.sql`

- [ ] **Step 1: Initialize Supabase config (only if `supabase/` does not yet exist)**

Run: `npx supabase init` if `supabase/config.toml` does not exist. If `supabase init` complains the project is already linked to a remote, skip. Either way, the next step ensures the file content is correct.

- [ ] **Step 2: Write `supabase/config.toml`**

Overwrite (or create) `supabase/config.toml` with at minimum these sections (preserve any other keys `supabase init` produced):

```toml
project_id = "whatstage"

[auth]
enable_signup = true
enable_confirmations = false
minimum_password_length = 8

[auth.email]
enable_signup = true
double_confirm_changes = true
enable_confirmations = false

[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/public/custom_access_token_hook"
```

- [ ] **Step 3: Create the migration file**

Create `supabase/migrations/20260428000000_auth_profiles.sql`:

```sql
-- =========================================================================
-- Auth & roles foundation
-- =========================================================================

create type public.user_role as enum ('user', 'admin', 'superadmin');

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null check (char_length(full_name) between 1 and 80),
  role        public.user_role not null default 'user',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Helper: current_role() reads role from JWT claim
-- ---------------------------------------------------------------------------
create or replace function public.current_role()
returns public.user_role
language sql
stable
as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'role', '')::public.user_role,
    'user'::public.user_role
  );
$$;

-- ---------------------------------------------------------------------------
-- Auto-create profile when a user signs up
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'New user'),
    'user'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Custom access token hook — injects role into JWT app_metadata.role
-- ---------------------------------------------------------------------------
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims    jsonb := event -> 'claims';
  meta      jsonb;
  user_role public.user_role;
begin
  select role into user_role
  from public.profiles
  where id = (event ->> 'user_id')::uuid;

  if user_role is null then
    user_role := 'user';
  end if;

  meta := coalesce(claims -> 'app_metadata', '{}'::jsonb);
  meta := jsonb_set(meta, '{role}', to_jsonb(user_role::text));
  claims := jsonb_set(claims, '{app_metadata}', meta);

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

-- Read: self, or anyone if you are a superadmin.
create policy profiles_select_self_or_superadmin
on public.profiles
for select
to authenticated
using ( id = auth.uid() or public.current_role() = 'superadmin' );

-- Update: a user may update their own row but role must remain unchanged.
create policy profiles_update_self_no_role_change
on public.profiles
for update
to authenticated
using ( id = auth.uid() )
with check (
  id = auth.uid()
  and role = (select role from public.profiles where id = auth.uid())
);

-- Update: superadmins may update any row including role.
create policy profiles_update_superadmin
on public.profiles
for update
to authenticated
using ( public.current_role() = 'superadmin' )
with check ( public.current_role() = 'superadmin' );

-- No INSERT or DELETE policies → blocked for authenticated/anon.
-- INSERT happens via security-definer trigger; DELETE via on-delete cascade.
```

- [ ] **Step 4: Apply the migration locally**

Run: `npx supabase db reset` (or `npx supabase migration up` if already linked to local).
Expected: migration applies cleanly. Verify with:

Run: `npx supabase db diff --schema public`
Expected: empty diff.

- [ ] **Step 5: Smoke-test the trigger and RLS via psql**

Run:
```
npx supabase db query "select column_name, data_type from information_schema.columns where table_schema='public' and table_name='profiles' order by ordinal_position;"
```
Expected: lists `id, email, full_name, role, created_at, updated_at`.

Run:
```
npx supabase db query "select polname, polcmd from pg_policies where schemaname='public' and tablename='profiles';"
```
Expected: three rows: `profiles_select_self_or_superadmin`, `profiles_update_self_no_role_change`, `profiles_update_superadmin`.

- [ ] **Step 6: Apply to remote (skip if not yet linked)**

If the project is linked to a remote Supabase project: `npx supabase db push`.
Otherwise document this as a manual step and continue.

- [ ] **Step 7: Commit**

```bash
git add supabase/
git commit -m "feat(db): add profiles table, role enum, RLS, signup trigger, jwt hook"
```

---

## Task 4: Server-side session helper

**Files:**
- Create: `src/lib/auth/get-session.ts`

- [ ] **Step 1: Implement the helper**

Create `src/lib/auth/get-session.ts`:

```ts
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

export type Role = 'user' | 'admin' | 'superadmin'

export type SessionContext = {
  userId: string
  email: string
  fullName: string
  role: Role
}

export const getSession = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const role: Role =
    (user.app_metadata?.role as Role | undefined) ?? 'user'

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .single()

  return {
    userId: user.id,
    email: user.email ?? '',
    fullName: profile?.full_name ?? '',
    role,
  }
})
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If `profiles` types are unknown, that's fine — `.from('profiles')` returns `any` until generated types are added; that's outside this task.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/auth/get-session.ts
git commit -m "feat(auth): add cached server-side session helper"
```

---

## Task 5: Server actions for signup/signin/signout

**Files:**
- Create: `src/app/(auth)/actions.ts`
- Create: `src/app/auth/signout/route.ts`

- [ ] **Step 1: Implement auth actions**

Create `src/app/(auth)/actions.ts`:

```ts
'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { signUpSchema, signInSchema } from '@/lib/auth/schemas'

export type AuthFormState = {
  formError?: string
  fieldErrors?: Record<string, string>
}

function flattenFieldErrors(
  err: import('zod').ZodError,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of err.issues) {
    const key = issue.path[0]?.toString() ?? '_'
    if (!out[key]) out[key] = issue.message
  }
  return out
}

export async function signUpAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    full_name: formData.get('full_name'),
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { fieldErrors: flattenFieldErrors(parsed.error) }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.full_name } },
  })

  if (error) {
    // Generic error to avoid email enumeration
    return { formError: 'Could not create account. Please try again.' }
  }

  redirect('/dashboard')
}

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return { fieldErrors: flattenFieldErrors(parsed.error) }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (error) {
    return { formError: 'Invalid email or password.' }
  }

  redirect('/dashboard')
}
```

- [ ] **Step 2: Implement signout route**

Create `src/app/auth/signout/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/login', request.url), { status: 303 })
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/\(auth\)/actions.ts src/app/auth/signout/route.ts
git commit -m "feat(auth): add server actions for signup/signin and signout route"
```

---

## Task 6: Auth route group, layout, login & signup pages

**Files:**
- Create: `src/app/(auth)/layout.tsx`
- Create: `src/app/(auth)/_components/auth-form.tsx`
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/app/(auth)/signup/page.tsx`

- [ ] **Step 1: Auth layout — redirect signed-in users away**

Create `src/app/(auth)/layout.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  if (session) redirect('/dashboard')

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F9FAFB] px-4">
      <div className="w-full max-w-md rounded-xl border border-[#E5E7EB] bg-white p-8 shadow-sm">
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Shared form primitives**

Create `src/app/(auth)/_components/auth-form.tsx`:

```tsx
'use client'

import { useFormStatus } from 'react-dom'

export function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  error,
  defaultValue,
}: {
  label: string
  name: string
  type?: string
  autoComplete?: string
  error?: string
  defaultValue?: string
}) {
  return (
    <label className="block">
      <span className="block text-[14px] font-medium text-[#111827] mb-1.5">
        {label}
      </span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        required
        aria-invalid={error ? 'true' : 'false'}
        className="block w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-[14px] text-[#111827] placeholder:text-[#9CA3AF] focus:border-[#34D399] focus:outline-none focus:ring-2 focus:ring-[#34D399]/30"
      />
      {error ? (
        <span className="mt-1 block text-[12px] text-[#DC2626]">{error}</span>
      ) : null}
    </label>
  )
}

export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-full bg-[#059669] px-5 py-2.5 text-[14px] font-medium text-white transition-colors hover:bg-[#047857] disabled:opacity-60"
    >
      {pending ? 'Please wait…' : children}
    </button>
  )
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="rounded-md border border-[#FEE2E2] bg-[#FEE2E2]/40 px-3 py-2 text-[13px] text-[#DC2626]"
    >
      {message}
    </div>
  )
}
```

- [ ] **Step 3: Login page**

Create `src/app/(auth)/login/page.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { signInAction, type AuthFormState } from '../actions'
import { Field, FormError, SubmitButton } from '../_components/auth-form'

const initialState: AuthFormState = {}

export default function LoginPage() {
  const [state, formAction] = useActionState(signInAction, initialState)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[24px] font-semibold text-[#111827]">Sign in</h1>
        <p className="text-[14px] text-[#6B7280] mt-1">
          Welcome back. Enter your details to continue.
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        <FormError message={state.formError} />
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          error={state.fieldErrors?.email}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          error={state.fieldErrors?.password}
        />
        <SubmitButton>Sign in</SubmitButton>
      </form>

      <p className="text-[13px] text-[#6B7280]">
        Don&apos;t have an account?{' '}
        <Link href="/signup" className="font-medium text-[#059669] hover:underline">
          Create one
        </Link>
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Signup page**

Create `src/app/(auth)/signup/page.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { signUpAction, type AuthFormState } from '../actions'
import { Field, FormError, SubmitButton } from '../_components/auth-form'

const initialState: AuthFormState = {}

export default function SignupPage() {
  const [state, formAction] = useActionState(signUpAction, initialState)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[24px] font-semibold text-[#111827]">Create your account</h1>
        <p className="text-[14px] text-[#6B7280] mt-1">
          It only takes a minute.
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        <FormError message={state.formError} />
        <Field
          label="Full name"
          name="full_name"
          autoComplete="name"
          error={state.fieldErrors?.full_name}
        />
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          error={state.fieldErrors?.email}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          error={state.fieldErrors?.password}
        />
        <p className="text-[12px] text-[#6B7280]">
          At least 8 characters, with a letter and a number.
        </p>
        <SubmitButton>Create account</SubmitButton>
      </form>

      <p className="text-[13px] text-[#6B7280]">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-[#059669] hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
```

- [ ] **Step 5: Type-check & lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(auth\)
git commit -m "feat(auth): add login and signup pages with shared form primitives"
```

---

## Task 7: App route group, dashboard shell

**Files:**
- Create: `src/app/(app)/layout.tsx`
- Create: `src/app/(app)/dashboard/page.tsx`
- Create: `src/app/(app)/_components/sidebar.tsx`
- Create: `src/app/(app)/_components/topbar.tsx`

- [ ] **Step 1: Sidebar component**

Create `src/app/(app)/_components/sidebar.tsx`:

```tsx
import Link from 'next/link'

const items = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/activity', label: 'Activity' },
  { href: '/dashboard/settings', label: 'Settings' },
]

export function Sidebar({ activeHref }: { activeHref: string }) {
  return (
    <aside className="w-60 shrink-0 border-r border-[#E5E7EB] bg-white px-4 py-6">
      <div className="px-2 mb-6 text-[14px] font-semibold text-[#111827]">
        WhatStage
      </div>
      <nav className="space-y-1">
        {items.map((item) => {
          const active = item.href === activeHref
          return (
            <Link
              key={item.href}
              href={item.href}
              className={
                'block rounded-md px-3 py-2 text-[14px] ' +
                (active
                  ? 'font-semibold text-[#059669] bg-[rgba(5,150,105,0.08)]'
                  : 'font-medium text-[#374151] hover:bg-[#F3F4F6]')
              }
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
```

- [ ] **Step 2: Topbar component**

Create `src/app/(app)/_components/topbar.tsx`:

```tsx
export function Topbar({ fullName }: { fullName: string }) {
  return (
    <header className="flex items-center justify-between border-b border-[#E5E7EB] bg-white px-6 py-3">
      <div className="text-[14px] text-[#6B7280]">Welcome back</div>
      <div className="flex items-center gap-4">
        <span className="text-[14px] font-medium text-[#111827]">
          {fullName || 'Account'}
        </span>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="rounded-full border border-[#E5E7EB] px-4 py-1.5 text-[13px] font-medium text-[#374151] hover:bg-[#F3F4F6]"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  )
}
```

- [ ] **Step 3: App layout — gate via session helper**

Create `src/app/(app)/layout.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { Sidebar } from './_components/sidebar'
import { Topbar } from './_components/topbar'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <div className="flex min-h-screen bg-[#F9FAFB]">
      <Sidebar activeHref="/dashboard" />
      <div className="flex flex-1 flex-col">
        <Topbar fullName={session.fullName} />
        <main className="flex-1 px-8 py-6">{children}</main>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Dashboard page with empty panels**

Create `src/app/(app)/dashboard/page.tsx`:

```tsx
import { getSession } from '@/lib/auth/get-session'

export default async function DashboardPage() {
  const session = await getSession()
  const name = session?.fullName ?? 'there'

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[24px] font-semibold text-[#111827]">Dashboard</h1>
        <p className="text-[14px] text-[#6B7280] mt-1">
          Hi {name}, this is your workspace overview.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {['Activity', 'Pipeline', 'Messages'].map((title) => (
          <section
            key={title}
            className="rounded-xl border border-[#E5E7EB] bg-white p-5 min-h-40"
          >
            <h2 className="text-[14px] font-medium text-[#6B7280]">{title}</h2>
            <p className="mt-2 text-[13px] text-[#9CA3AF]">No data yet.</p>
          </section>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Type-check & lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(app\)
git commit -m "feat(dashboard): add gated app layout with sidebar, topbar, and empty panels"
```

---

## Task 8: Proxy redirects for gated and auth-only routes

**Files:**
- Modify: `src/lib/supabase/proxy.ts`

- [ ] **Step 1: Replace `updateSession` with redirect-aware version**

Replace the entire content of `src/lib/supabase/proxy.ts` with:

```ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const AUTH_PATHS = new Set(['/login', '/signup'])
const APP_PATH_PREFIXES = ['/dashboard']

function isAppPath(pathname: string) {
  return APP_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  )
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // IMPORTANT: Do not run code between createServerClient and getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  if (!user && isAppPath(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    return NextResponse.redirect(url)
  }

  if (user && AUTH_PATHS.has(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase/proxy.ts
git commit -m "feat(proxy): gate /dashboard and bounce signed-in users from /login and /signup"
```

---

## Task 9: Root page redirect & globals cleanup

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Replace root page with redirect**

Replace the entire content of `src/app/page.tsx` with:

```tsx
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'

export default async function Home() {
  const session = await getSession()
  redirect(session ? '/dashboard' : '/login')
}
```

- [ ] **Step 2: Update root layout body background**

Edit `src/app/layout.tsx`. Replace the `<body>` line:

Old:
```tsx
      <body className="min-h-full flex flex-col">{children}</body>
```

New:
```tsx
      <body className="min-h-full flex flex-col bg-[#F9FAFB] text-[#111827]">{children}</body>
```

Also update `metadata`:

Old:
```tsx
export const metadata: Metadata = {
  title: "Create Next App",
  description: "Generated by create next app",
};
```

New:
```tsx
export const metadata: Metadata = {
  title: 'WhatStage',
  description: 'Your workspace for everything you launch.',
}
```

- [ ] **Step 3: Tidy globals.css**

Replace the contents of `src/app/globals.css` with:

```css
@import "tailwindcss";

:root {
  --color-page: #f9fafb;
  --color-card: #ffffff;
  --color-border: #e5e7eb;
  --color-ink: #111827;
  --color-body: #374151;
  --color-muted: #6b7280;
  --color-accent: #059669;
}

@theme inline {
  --color-page: var(--color-page);
  --color-card: var(--color-card);
  --color-border: var(--color-border);
  --color-ink: var(--color-ink);
  --color-body: var(--color-body);
  --color-muted: var(--color-muted);
  --color-accent: var(--color-accent);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

body {
  font-family: var(--font-geist-sans), -apple-system, BlinkMacSystemFont,
    "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-feature-settings: "ss03";
}
```

- [ ] **Step 4: Type-check, lint, build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/app/layout.tsx src/app/globals.css
git commit -m "feat(app): route root to /login or /dashboard and apply design tokens"
```

---

## Task 10: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Confirm `.env.local` has the required keys**

Run: `grep -E '^(NEXT_PUBLIC_SUPABASE_URL|NEXT_PUBLIC_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)=' .env.local`
Expected: all three keys printed (values redacted).

- [ ] **Step 2: Start dev server**

Run: `npm run dev` (in a separate shell). Wait for "Ready".

- [ ] **Step 3: Anonymous redirect works**

Open `http://localhost:3000/dashboard`.
Expected: redirected to `/login`.

- [ ] **Step 4: Signup**

Open `http://localhost:3000/signup`. Submit:
- full_name: `QA User`
- email: `qa+<timestamp>@example.com`
- password: `password1`

Expected: lands on `/dashboard`. Topbar shows `QA User`. Three empty panels render.

- [ ] **Step 5: JWT contains role**

In the browser dev tools → Application → Cookies, find the Supabase access token cookie (name starts with `sb-`). Decode the JWT (e.g. paste into jwt.io). Verify `app_metadata.role === 'user'`.

- [ ] **Step 6: Cannot escalate role**

In the browser console:
```js
const { createClient } = await import('@supabase/supabase-js')
const c = createClient(
  '<NEXT_PUBLIC_SUPABASE_URL>',
  '<NEXT_PUBLIC_SUPABASE_ANON_KEY>',
)
// Use the access_token from the sb- cookie
await c.auth.setSession({ access_token: '<paste>', refresh_token: '<paste>' })
const r = await c.from('profiles').update({ role: 'superadmin' }).eq('id', '<your uid>').select()
console.log(r)
```
Expected: `data` is empty (zero rows updated) — RLS blocks the role change.

- [ ] **Step 7: Sign out**

Click Sign out in the topbar.
Expected: redirected to `/login`.

- [ ] **Step 8: Sign back in**

On `/login`, enter the same credentials.
Expected: lands on `/dashboard`.

- [ ] **Step 9: Auth-route bounce**

While signed in, navigate to `/login`.
Expected: immediately redirected to `/dashboard`.

- [ ] **Step 10: Generic error on bad password**

Sign out. On `/login`, submit valid email + wrong password.
Expected: form shows "Invalid email or password."

- [ ] **Step 11: Generic error on duplicate signup**

Sign out. On `/signup`, submit the same email used in step 4.
Expected: form shows "Could not create account. Please try again." (no enumeration leak).

- [ ] **Step 12: Stop dev server, run full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 13: Final commit (if any tweaks needed)**

If any tweaks were made during verification:

```bash
git add -A
git commit -m "fix(auth): address issues found during e2e verification"
```

---

## Notes for the implementer

- **Next 16 specifics:** `proxy.ts` is the new name for what used to be `middleware.ts`. APIs are the same except for the file name and exported function name. The repo already uses this convention.
- **Supabase SSR:** Never run code between `createServerClient(...)` and `supabase.auth.getUser()` inside the proxy — doing so can cause silent session-refresh failures. The supplied `updateSession` keeps that constraint.
- **Service role key:** must never be imported from a client component. `src/lib/supabase/admin.ts` is server-only. There is no need to call it for this work.
- **Email confirmation:** disabled in `supabase/config.toml`. If your remote project has it enabled in the dashboard, also flip it off there or signup-then-redirect won't work (user has no session until they confirm).
- **Tailwind v4:** color tokens are inlined in components for clarity. They match DESIGN.md exactly. Refactor into a token system later if desired.
