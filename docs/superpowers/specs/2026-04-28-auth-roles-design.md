# Auth & Role-Based Access — Design

**Date:** 2026-04-28
**Scope:** User-facing email/password signup + login, `profiles` table with role enum, RLS, JWT role claim, gated dashboard shell. Admin/superadmin UI is explicitly **out of scope** for this iteration.

---

## 1. Goals

- Users can sign up with full name + email + password and are immediately logged in (no email confirmation).
- Users can log in and be routed to `/dashboard`, which renders the DESIGN.md sidebar/topbar shell with empty panels.
- Users can sign out.
- Every account has a role (`user`, `admin`, `superadmin`); default is `user`.
- Role is stored server-side and **cannot** be modified by the user. Future admin features can authorize off the JWT claim with no extra query.
- Built to SaaS security standards: no user enumeration, no client-writable role, server-only service-role key, RLS on by default.

## 2. Non-goals (explicit)

- Email confirmation flow.
- Forgot password / reset password flow.
- OAuth providers, magic links, MFA.
- Admin and superadmin dashboards or any UI gated to those roles.
- Profile editing UI beyond what auth needs.
- Account deletion.

## 3. Stack & existing context

- Next.js **16.2.4** (App Router, with `proxy.ts` — the renamed Next 16 middleware).
- React 19.2.4, Tailwind v4.
- Supabase: `@supabase/ssr` 0.10.2, `@supabase/supabase-js` 2.105.0. Helpers already present: `src/lib/supabase/{client,server,proxy,admin}.ts`.
- Design system already documented in `DESIGN.md` (emerald accent, system fonts, `ss03`, full-pill primary buttons, etc.).

## 4. Database design

### 4.1 Enum

```sql
create type public.user_role as enum ('user', 'admin', 'superadmin');
```

### 4.2 `public.profiles` table

| column | type | notes |
|---|---|---|
| `id` | `uuid` | PK, FK → `auth.users(id) on delete cascade` |
| `email` | `text` | not null, mirrors `auth.users.email` for convenience |
| `full_name` | `text` | not null, 1–80 chars (check constraint) |
| `role` | `public.user_role` | not null, default `'user'` |
| `created_at` | `timestamptz` | default `now()` |
| `updated_at` | `timestamptz` | default `now()`, updated via trigger |

Indexes: PK on `id`. No additional indexes needed at this stage.

### 4.3 RLS

```sql
alter table public.profiles enable row level security;
```

Policies:

- **`profiles_select_self_or_superadmin`** — `for select using ( id = auth.uid() or public.current_role() = 'superadmin' )`
- **`profiles_update_self_no_role`** — `for update using ( id = auth.uid() ) with check ( id = auth.uid() and role = (select role from public.profiles where id = auth.uid()) )`. Effectively pins `role` to its existing value when the row's owner updates.
- **`profiles_update_superadmin`** — `for update using ( public.current_role() = 'superadmin' ) with check ( public.current_role() = 'superadmin' )`. Allows changing role.
- **No INSERT or DELETE policies** for the `authenticated` role. Inserts happen only via the auth-trigger (security definer); deletes happen via cascade from `auth.users`.

### 4.4 Helper function

```sql
create or replace function public.current_role()
returns public.user_role
language sql stable
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role')::public.user_role,
    'user'::public.user_role
  );
$$;
```

Used by RLS policies on `profiles` and reusable for future tables.

### 4.5 Auto-create profile on signup (trigger)

```sql
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
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'user'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
```

`security definer` is required because the trigger writes into `public.profiles` which has RLS; the function runs as the function owner (the migration role), not the inserting role.

### 4.6 `updated_at` trigger

Standard `before update` trigger setting `new.updated_at = now()`.

### 4.7 Custom access token hook

A Postgres function that Supabase Auth invokes on every token issue/refresh. It reads the user's role from `profiles` and merges it into the JWT's `app_metadata.role` claim.

```sql
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb := event -> 'claims';
  user_role public.user_role;
begin
  select role into user_role from public.profiles where id = (event ->> 'user_id')::uuid;
  if user_role is null then
    user_role := 'user';
  end if;

  claims := jsonb_set(claims, '{app_metadata}', coalesce(claims -> 'app_metadata', '{}'::jsonb));
  claims := jsonb_set(claims, '{app_metadata,role}', to_jsonb(user_role::text));

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
```

Then registered in Supabase Auth settings (dashboard or `config.toml`):

```
[auth.hook.custom_access_token]
enabled = true
uri = "pg-functions://postgres/public/custom_access_token_hook"
```

This is the documented Supabase pattern for surfacing role to the JWT without an extra query on every request.

### 4.8 Migrations layout

Single migration file under `supabase/migrations/<timestamp>_auth_profiles.sql` containing all of the above in dependency order. The hook registration goes into `supabase/config.toml` (committed).

## 5. Frontend (Next.js App Router)

### 5.1 Route structure

```
src/app/
├── (auth)/
│   ├── layout.tsx          # centered card; redirects to /dashboard if session exists
│   ├── login/page.tsx
│   ├── signup/page.tsx
│   └── actions.ts          # 'use server' — signUp, signIn, signOut
├── (app)/
│   ├── layout.tsx          # sidebar + topbar shell; redirects to /login if no session
│   └── dashboard/page.tsx  # empty content panels
└── auth/
    └── signout/route.ts    # POST handler (form-action friendly)
```

The `(auth)` and `(app)` route groups let the layouts diverge cleanly without affecting URLs.

### 5.2 Server actions

`src/app/(auth)/actions.ts`:

- `signUpAction(prevState, formData)` — Zod-validates `{ full_name, email, password }`, calls `supabase.auth.signUp({ email, password, options: { data: { full_name } } })`. On success: `redirect('/dashboard')`. On failure: returns `{ fieldErrors, formError }` for `useActionState`.
- `signInAction(prevState, formData)` — Zod-validates `{ email, password }`, calls `signInWithPassword`. On failure returns the **generic** message `"Invalid email or password."` regardless of cause (no user enumeration).
- `signOutAction()` — calls `signOut`, then `redirect('/login')`.

All actions use the **server** Supabase client (`src/lib/supabase/server.ts`) so cookies are written through Next's cookie API.

### 5.3 Validation (Zod)

Shared schemas in `src/lib/auth/schemas.ts`:

- `email`: `z.string().trim().toLowerCase().email()`
- `password`: `z.string().min(8).regex(/[A-Za-z]/).regex(/[0-9]/)`
- `full_name`: `z.string().trim().min(1).max(80)`

Used by both client form state (for inline errors) and server actions (truth).

### 5.4 Forms

Client components rendering native `<form action={action}>` with `useActionState` for error state. Inline field errors below each input. Submit button uses the DESIGN.md emerald-fill full-pill style.

### 5.5 Dashboard shell `(app)/layout.tsx`

Per DESIGN.md:

- Sidebar (`#FFFFFF`, 240px) with placeholder nav links: "Overview", "Activity", "Settings". Active state styling per spec.
- Topbar with user's full name + a sign-out button (POSTs to `/auth/signout`).
- Content area on `#F9FAFB` background. Dashboard page renders 2–3 empty card placeholders.

User's `full_name` and `role` are fetched once in the layout via `supabase.auth.getUser()` + a `profiles` row read (or just from JWT for `role`).

### 5.6 `proxy.ts` enhancements

Existing `updateSession` keeps cookies fresh. Extended logic (after session refresh):

- If pathname starts with `/dashboard` (or any future `(app)` route) **and** no user → `NextResponse.redirect('/login')`.
- If pathname is `/login` or `/signup` **and** user is present → `NextResponse.redirect('/dashboard')`.
- Other paths pass through.

Path matching uses an explicit allowlist (constants at top of `src/lib/supabase/proxy.ts`) rather than scanning route groups.

## 6. Security checklist

- `role` is never settable by the client. RLS prevents `update profiles set role = ...` from `authenticated`.
- Service-role key only used in `src/lib/supabase/admin.ts`; that file is server-only and not imported from any client component. A short README note documents this.
- Login error messages are generic; signup errors for "already registered" are also generic ("Could not create account") to avoid email enumeration.
- Supabase project settings (documented in spec, configured in Supabase dashboard):
  - `password_min_length = 8`
  - Rate limits enabled on `signup`, `token`, and `verify` endpoints (Supabase defaults are sensible; document the values used).
- Cookies: `HttpOnly`, `Secure` in production, `SameSite=Lax` — handled by `@supabase/ssr` defaults.
- CSRF: Next.js server actions enforce origin check; Supabase auth cookies are `SameSite=Lax`.
- No secrets in client bundle. Required env vars:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (server-only)

## 7. Testing

- **Unit:** Zod schemas — happy path + each rejection branch.
- **Integration (Supabase local):**
  - Sign up → row exists in `profiles` with `role = 'user'`, `full_name` populated.
  - Authed user cannot `update profiles set role = 'superadmin' where id = auth.uid()` (must fail).
  - Anon user cannot `select * from profiles`.
  - JWT after login contains `app_metadata.role`.
- **E2E (manual or Playwright, optional):** signup → land on `/dashboard`, logout → land on `/login`, login → `/dashboard`, hitting `/dashboard` while logged out redirects.

## 8. File-by-file deliverables

New files:

- `supabase/migrations/<ts>_auth_profiles.sql`
- `supabase/config.toml` (or update existing) — register access token hook
- `src/lib/auth/schemas.ts`
- `src/app/(auth)/layout.tsx`
- `src/app/(auth)/login/page.tsx`
- `src/app/(auth)/signup/page.tsx`
- `src/app/(auth)/actions.ts`
- `src/app/(auth)/_components/auth-form.tsx` (shared form primitives)
- `src/app/(app)/layout.tsx`
- `src/app/(app)/dashboard/page.tsx`
- `src/app/(app)/_components/sidebar.tsx`
- `src/app/(app)/_components/topbar.tsx`
- `src/app/auth/signout/route.ts`

Modified files:

- `src/lib/supabase/proxy.ts` — add gated-route + auth-route redirects.
- `src/app/page.tsx` — redirect to `/dashboard` if authed, else `/login`.
- `src/app/globals.css` / Tailwind theme — ensure DESIGN.md tokens are available.

## 9. Open questions for follow-up work (not blocking)

- When admin/superadmin dashboards are designed, decide whether they live under `(app)` with role gates or a separate `(admin)` route group.
- Email confirmation, forgot password, and rate-limit tuning are deferred and tracked separately.

---
