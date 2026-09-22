# WhatStage Mobile (Expo)

Messenger-style companion app for the WhatStage dashboard: live chats, a lead
stage board, lead and project details, saved messages, and one-tap action-page sends.

## Run it

```bash
cd mobile
cp .env.example .env          # fill in the Supabase URL/anon key and your API URL
npm install
npx expo start                # press i for iOS simulator, a for Android, or scan with Expo Go
```

The Next.js app must be running for sends and stage moves (`npm run dev` at the
repo root). On a physical phone set `EXPO_PUBLIC_API_URL` to your machine's LAN
address (for example `http://192.168.1.10:3000`), not `localhost`.

Sign in with the same email and password as the dashboard.

## How it talks to the backend

| Concern | Path |
| --- | --- |
| Reads (threads, messages, leads, stages, projects, saved messages) | Supabase directly with the user's session. RLS scopes every table to `auth.uid()`. |
| Live updates | Supabase Realtime on `messenger_messages`, `messenger_threads`, `leads` (publication added by migration `20260922000000`). |
| Send a reply / action page | `POST /api/mobile/messages/send`, `POST /api/mobile/action-pages/send` (Bearer = Supabase access token). The Page token is decrypted server-side. |
| Move a lead / project | `POST /api/mobile/leads/move` (audited via `set_lead_stage`), `POST /api/mobile/projects/move`. |
| Push notifications | `POST /api/mobile/push/register` · `/unregister` · `/toggle`. Rows live in `push_devices` (migration `20260922130000`); the Facebook webhook fans out through `src/lib/push/notify.ts`. |

## Layout

```
src/app/            Expo Router screens
  (auth)/           sign-in, blocked (pending/paused accounts)
  (tabs)/           Chats · Leads · Projects · Me
  chat/[threadId]   conversation + composer
  lead/[leadId]     lead details, fields, projects, timeline
  projects/[id]     workspace board / list
  project/[id]      project details
  saved-messages    manage canned replies
src/data/           react-query hooks per domain (+ realtime subscriptions)
src/components/     ui kit (avatar, sheet, button, segmented, board view, ...)
src/lib/            supabase client, API client, push tokens, formatting helpers
src/providers/      auth session, push registration + notification routing
src/theme/tokens.ts design tokens (mirrors DESIGN.md)
```

## Push notifications

New inbound Messenger messages arrive as a push. The Facebook webhook defers a
call to `src/lib/push/notify.ts`, which looks up every enabled row in
`push_devices` for that operator and posts to Expo's push service. Tapping the
notification deep-links to `/chat/<threadId>`; the app-icon badge mirrors the
unread thread count.

**Expo Go cannot receive remote push** (removed in SDK 53), and neither can a
simulator. The Me screen shows *"Needs a development build on a physical
device"* in that case — everything else in the app still works.

To turn it on for real:

```bash
npx eas-cli@latest init         # writes extra.eas.projectId into app.json
npx eas-cli@latest credentials  # APNs key (iOS) / FCM v1 service account (Android)
npx eas-cli@latest build --profile development --platform ios   # or android
```

Install that build on a physical device and sign in — the app registers its
token on launch. Without `extra.eas.projectId` the Me screen reads *"No EAS
project configured for this build"* and no token is requested.

Optional server env var: `EXPO_ACCESS_TOKEN`, required only if the Expo account
has enhanced security for push enabled.

The Me screen's Push switch is a **per-device** mute — it keeps the row (and the
OS permission) so unmuting needs no re-registration. Signing out deletes the
row, so the next operator on that handset never inherits the previous one's
conversations.

## Checks

```bash
npx tsc --noEmit
npx expo lint
```
