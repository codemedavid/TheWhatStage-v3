# Admin usage tracking — fix & TDD notes

**Date:** 2026-06-19 · **Branch:** main

## Symptom
Superadmin console showed **zero AI usage** despite heavy spend.

## Root cause (confirmed against live DB)
Metering itself was healthy — the ledger held 3,666 events / 22.9M tokens / ~$2.10
across 3 tenants, and the hourly `usage_daily` rollup was current. The admin
just couldn't read it:

- The admin **page** authorizes from `profiles.role` (DB) → superadmin sees the page.
- The admin **usage RPCs** (`admin_usage_totals/trend/by_scope_model/by_tenant`)
  gated on `public.current_role()`, which read `auth.jwt() → app_metadata.role`.
- That JWT claim is **never set anywhere** in the app → resolved to `'user'` →
  every RPC raised `forbidden: superadmin only`.
- `src/lib/billing/admin-usage.ts` **discarded the RPC error** (`const { data } = …`)
  → the dashboard rendered zeros instead of an error.

Same gate also backed superadmin RLS on ~15 tables; all were silently denying via
the JWT path (only service-role access kept the app working).

## Fixes
1. **`supabase/migrations/20260619100000_current_role_from_profiles.sql`** —
   rewrite `current_role()` as `SECURITY DEFINER` reading `profiles.role` for
   `auth.uid()`. Single source of truth; demotions take effect immediately;
   `SECURITY DEFINER` + pinned `search_path` avoids RLS recursion on `profiles`.
   Applied via MCP; `schema_migrations` version reconciled to the file version.
2. **`admin-usage.ts`** — `unwrapRpc()` now logs + throws on RPC error (no silent
   zeros). `SuperadminDashboard` isolates usage fetches in try/catch and renders
   an inline error banner instead of crashing the whole page.
3. **`format-usage.ts`** — `usdFromMicros()` / `formatUsd()` for admin cost display.
4. **Admin UI** — USD cost KPI + per-tenant cost column + drill-down cost +
   `cost_usd` CSV column. Tenant-facing views remain tokens-only.

## TDD
- RED: simulated the superadmin JWT → `current_role()` = `'user'`, RPC forbidden.
- `admin-usage.test.ts` — RED proved wrappers swallowed errors; GREEN after fix.
- `format-usage.test.ts` — formatter cases.

## Verification
- `npx tsc --noEmit` → clean.
- `npx vitest run --dir src/lib/billing` → 28 passed.
- `npx vitest run --dir src` → 1355 passed; 2 pre-existing CAPI failures
  (`action-pages/submit/route.test.ts`) unrelated to this change.
- Live RPCs as superadmin: totals 1, trend 11, by_scope_model 4, by_tenant 3.

## Manual check
Log in as `whatstageofficial@gmail.com` → `/dashboard` → AI usage panel shows
tokens + Est. cost; users table shows per-tenant Usage + Cost columns.
