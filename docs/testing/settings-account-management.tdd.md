# TDD Evidence: Settings → Account Management

**Source plan:** Inline plan from `/ecc:plan` ("add account management on the settings"), confirmed scope: change password, change email, sign out everywhere.

## User Journeys
- As a signed-in user, I want to change my password (after proving I know the current one) so my account stays secure.
- As a signed-in user, I want to change my login email so I can sign in with a new address.
- As a signed-in user, I want to sign out of all devices so a lost/shared device can't keep my session.

## Task Report
- **Schemas** (`src/lib/auth/account-schemas.ts`): zod validation mirroring signup password policy + cross-field match/difference. Validated RED (module missing) → GREEN.
- **Actions** (`settings/account/actions.ts`): `changePasswordAction` re-authenticates via `signInWithPassword` before `updateUser`; `changeEmailAction` uses admin `updateUserById({ email_confirm: true })` (consistent with signup, which has no confirmation route); `signOutEverywhereAction` calls `signOut({ scope: 'global' })` then redirects.
- **UI** (`account/_components/account-forms.tsx`, `account/page.tsx`): `useActionState` + `useFormStatus` forms mirroring the CAPI form pattern.

Validation command: `npx vitest run src/lib/auth/account-schemas.test.ts "src/app/(app)/dashboard/settings/account/actions.test.ts"`
- RED: `Failed to resolve import "./actions"` (modules absent) — 2 files failed.
- GREEN: `Test Files 2 passed (2) · Tests 19 passed (19)`.
- `npx tsc --noEmit`: clean. `npx eslint <account dir + schemas>`: clean.

## Test Specification
| # | What is guaranteed | Test | Type | Result |
|---|--------------------|------|------|--------|
| 1 | Strong, matching new password passes validation | `account-schemas.test.ts` | unit | PASS |
| 2 | Empty current / short / no-number / mismatch / same-as-current rejected with correct field path | `account-schemas.test.ts` | unit | PASS |
| 3 | Email is validated and lowercased; bad email rejected | `account-schemas.test.ts` | unit | PASS |
| 4 | Change password verifies current pw then updates | `actions.test.ts` | integration | PASS |
| 5 | Wrong current password → error, no `updateUser` call | `actions.test.ts` | integration | PASS |
| 6 | Confirmation mismatch / no session short-circuits before Supabase | `actions.test.ts` | integration | PASS |
| 7 | `updateUser` failure surfaced as error | `actions.test.ts` | integration | PASS |
| 8 | Change email calls admin `updateUserById(userId, {email, email_confirm:true})` | `actions.test.ts` | integration | PASS |
| 9 | Invalid / unchanged email rejected without admin call; admin failure surfaced | `actions.test.ts` | integration | PASS |
| 10 | Sign out everywhere uses `scope:'global'` and redirects to `/login` | `actions.test.ts` | integration | PASS |

## Coverage & Known Gaps
- 19 unit/integration tests cover all action branches and schema rules.
- No E2E (Playwright) added — manual flow below covers the browser path.
- Email change uses instant admin update (no ownership verification). Documented trade-off; a confirmation-link flow would require a new `/auth/confirm` verifyOtp route + email template config.

## Manual Verification
1. Change password → sign out → log in with new password.
2. Change email → log in with new email.
3. Sign out everywhere → other device's session is invalidated.
