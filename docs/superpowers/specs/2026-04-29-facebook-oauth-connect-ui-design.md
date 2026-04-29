# Facebook OAuth Flow + Connect UI

**Date:** 2026-04-29
**Status:** Approved
**Depends on:** `2026-04-29-facebook-connections-per-user-design.md` (schema)

## Background

The per-user Facebook schema (`facebook_connections`, `facebook_pages`,
`page_health_logs`) is in place. This spec covers the user-facing flow that
populates it: OAuth handshake with Facebook, a page-picker after consent, and a
minimal settings UI to view connected pages and disconnect.

The complementary background health-check job is a separate, later spec.

## Goals

- A signed-in user can click **Connect Facebook**, complete OAuth, pick which of
  their managed pages to track, and see the resulting list.
- They can disconnect, which removes their connection and all related pages
  cleanly via cascade.
- Tokens (`long_lived_token`, `page_access_token`) are encrypted at the
  application layer before insert and decrypted only when needed for outbound
  Graph API calls.
- The OAuth handshake is CSRF-safe via a signed `state` parameter.

## Non-Goals

- Token refresh / re-auth when long-lived tokens approach expiry — handled by
  the health-check spec.
- Webhook subscriptions, page messaging, posting, comment reply, or any other
  page interaction beyond listing.
- Admin-facing UI to view another user's connection (RLS already permits it; UI
  added later).

## Configuration

New / existing env vars used:

| Var                          | Source     | Notes                                                       |
| ---------------------------- | ---------- | ----------------------------------------------------------- |
| `FB_APP_ID`                  | existing   | Public — used in client-side redirect URL.                  |
| `FB_APP_SECRET`              | existing   | Server-only — used for token exchange and HMAC state sig.   |
| `FB_TOKEN_ENCRYPTION_KEY`    | **new**    | Server-only. 32 raw bytes, base64-encoded. Fail fast on miss/wrong length. |
| `NEXT_PUBLIC_APP_URL`        | existing   | Used to build the OAuth `redirect_uri`.                     |

OAuth `redirect_uri` is `${NEXT_PUBLIC_APP_URL}/api/auth/facebook/callback`.

OAuth scopes requested:

```
pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,pages_manage_engagement
```

## File Structure

```
src/lib/facebook/
  crypto.ts          encryptToken / decryptToken (AES-256-GCM)
  oauth.ts           buildAuthUrl, exchangeCodeForToken, exchangeForLongLived,
                     fetchMe, fetchUserPages
  state.ts           signState / verifyState (HMAC over user_id|nonce|ts)
src/app/api/auth/facebook/
  start/route.ts     GET — sets state cookie, redirects to FB consent
  callback/route.ts  GET — verifies state, exchanges code, saves connection,
                     redirects back to settings
src/app/(app)/dashboard/settings/facebook/
  page.tsx                          server component, renders one of 3 states
  actions.ts                        'use server' — saveSelectedPages, disconnect
  _components/connect-button.tsx
  _components/page-picker.tsx
  _components/connected-view.tsx
  _components/error-banner.tsx      reads ?error=... query param, renders alert
```

Each module has one clear responsibility. `oauth.ts` is the only file that
constructs Graph API URLs; `crypto.ts` is the only file that does AES;
`state.ts` is the only file that does HMAC. UI components are presentational
plus a single server-action call.

## Encryption (`src/lib/facebook/crypto.ts`)

- AES-256-GCM via Node `crypto`.
- Key loaded once at module load from `FB_TOKEN_ENCRYPTION_KEY`. Throw if
  missing or not 32 bytes after base64 decode.
- `encryptToken(plaintext: string): string` — generates random 12-byte IV,
  returns `base64(iv ‖ authTag(16) ‖ ciphertext)`.
- `decryptToken(envelope: string): string` — reverse. Throws on tag mismatch.
- DB columns remain `text`; the base64 envelope fits.
- Every insert path uses `encryptToken`; every code path that needs to call FB
  uses `decryptToken`. No raw token ever leaves these helpers.

## State / CSRF (`src/lib/facebook/state.ts`)

- `signState(userId: string): string` — `base64url(JSON.stringify({u,n,t}))
  + '.' + hmacSha256(payload, FB_APP_SECRET)`. `n` is a 16-byte random nonce,
  `t` is `Date.now()`.
- `verifyState(raw: string, expectedUserId: string): boolean` — recomputes
  HMAC, checks `u === expectedUserId`, rejects if `Date.now() - t > 10 min`.
- The signed value is also set as a cookie (`fb_oauth_state`) at `/start`:
  `httpOnly`, `sameSite=lax`, `secure` (in production), `maxAge=600`. The
  callback compares the FB-returned `state` query param against the cookie
  value byte-for-byte before signature verification.

## OAuth Flow

1. **Start** — `GET /api/auth/facebook/start`
   - Require authenticated session; redirect to `/login` if missing.
   - Generate `state = signState(session.user.id)`. Set `fb_oauth_state` cookie.
   - Redirect (302) to:
     ```
     https://www.facebook.com/v19.0/dialog/oauth
       ?client_id=$FB_APP_ID
       &redirect_uri=$APP/api/auth/facebook/callback
       &state=$state
       &scope=pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,pages_manage_engagement
       &response_type=code
     ```

2. **Callback** — `GET /api/auth/facebook/callback`
   - If FB returned `?error=...`, redirect to
     `/dashboard/settings/facebook?error=denied`. No DB write.
   - Read `state` query and `fb_oauth_state` cookie. They must match
     byte-for-byte. Then `verifyState(state, session.user.id)`. Clear cookie.
   - On any state failure → redirect with `?error=invalid_state`.
   - Exchange `code` for short-lived token via
     `GET /v19.0/oauth/access_token?client_id=…&client_secret=…&redirect_uri=…&code=…`.
   - Exchange short-lived for long-lived via
     `GET /v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=…&client_secret=…&fb_exchange_token=…`.
     Capture `expires_in` to compute `token_expires_at`.
   - `GET /v19.0/me?fields=id` to capture `fb_user_id`.
   - Insert into `facebook_connections` with encrypted `long_lived_token`,
     `token_expires_at`, `fb_user_id`, `user_id = session.user.id`.
     The unique constraint on `user_id` means a re-OAuth needs to upsert (on
     conflict do update) — preserve existing `id` so any pages already linked
     stay linked, and refresh the token + expiry.
   - Redirect to `/dashboard/settings/facebook`.
   - On any token-exchange or `/me` failure: delete the freshly inserted
     connection row (if any) and redirect with `?error=exchange_failed`.

3. **Picker render** — `/dashboard/settings/facebook` server component
   - Loads connection row for current user.
   - If none → `<ConnectButton/>`.
   - If connection but zero pages → call `fetchUserPages(decryptToken(token))`
     server-side, render `<PagePicker pages={...} />`.
   - If connection + ≥1 page → `<ConnectedView pages={...} />`.

4. **Save selection** — server action `saveSelectedPages(pageIds: string[])`
   - Re-fetch `/me/accounts` server-side using the user's connection token (do
     not trust client-supplied access tokens).
   - Filter to the selected `pageIds`.
   - For each, insert a `facebook_pages` row with **encrypted**
     `page_access_token`, `name`, `category`, `connection_id`. Empty selection
     → form-level error, no DB write.
   - `revalidatePath('/dashboard/settings/facebook')`.

5. **Disconnect** — server action `disconnect()`
   - `delete from facebook_connections where user_id = auth.uid()`. RLS
     enforces auth; cascade deletes pages + health logs.
   - `revalidatePath('/dashboard/settings/facebook')`.

## UI States

| State           | Condition                                       | Render                              |
| --------------- | ----------------------------------------------- | ----------------------------------- |
| Not connected   | no `facebook_connections` row for user          | `<ConnectButton/>` linking to start |
| Picking pages   | connection exists, zero `facebook_pages` rows   | `<PagePicker/>` form with checkboxes |
| Connected       | connection + ≥1 `facebook_pages` row            | `<ConnectedView/>` list + Disconnect |

`<ErrorBanner/>` renders above whichever state is active when `?error=...` is
present in the URL. Recognized codes: `denied`, `invalid_state`,
`exchange_failed`.

The picker form posts via a server action; checkboxes are uncontrolled, the
action receives `FormData` and reads selected `page_id` entries.

If the user lands in the picker state but has zero managed pages on Facebook,
the picker shows an explanatory empty state with a Disconnect link (so they
aren't stuck in picking state forever).

## RLS Interaction

All DB writes go through the user's session-bound Supabase client; existing RLS
policies (`fb_connections_owner_all`, `fb_pages_owner_all`) cover them. The
service-role client is **not** used in this flow — only owner policies.

## Sidebar / Navigation

Add a new sub-route under existing settings. The sidebar is unchanged
(`Settings` already exists). The settings page itself gets a sub-link or tab
to "Facebook" — exact placement to be matched to the existing settings layout
during implementation.

## Errors and Edge Cases

- **User denies consent on FB** → `?error=denied`. Banner: "Facebook connection
  cancelled."
- **State mismatch (CSRF or expired)** → `?error=invalid_state`. Banner:
  "Authentication state expired or invalid. Please try again."
- **Token exchange or `/me` failure** → `?error=exchange_failed`. Banner:
  "Couldn't complete Facebook connection. Please try again." Connection row is
  rolled back.
- **`/me/accounts` failure inside picker render** → render the picker as an
  error state with a "Try again" link (re-renders the page) and a Disconnect
  link. Connection row is **not** automatically deleted here — likely a
  transient FB outage.
- **Empty selection on submit** → form-level error inside the picker, no DB
  write.
- **User re-OAuths (already has a connection)** → callback upserts
  `facebook_connections` (refresh token + expiry, preserve `id`). Existing
  page rows stay; user can pick new ones from the picker if they had none, or
  disconnect first to start clean.
- **Token decryption fails (key rotated, corrupted envelope)** → settings page
  surfaces an error state asking the user to disconnect and reconnect.

## Tests

- `crypto.ts`: round-trip; throws on tampered envelope; throws at module load
  if env key missing/wrong length.
- `state.ts`: round-trip; rejects expired `t`; rejects mismatched `userId`;
  rejects bad signature.
- `oauth.ts`: mock `fetch`; assert exact URL/query for each Graph API call;
  parse-error path.
- Server actions (`saveSelectedPages`, `disconnect`): integration test against
  a real Supabase test project, using a fixture connection row, asserting RLS
  forbids writes on behalf of other users.
- Route handlers (`start`, `callback`): unit-style with mocked `fetch` +
  cookies. Cover happy path, denied, invalid state, exchange failure.

## Open Questions

None.
