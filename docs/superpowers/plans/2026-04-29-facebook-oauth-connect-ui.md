# Facebook OAuth + Connect UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a signed-in user connect their Facebook account, pick which managed pages to track, view them, and disconnect — with tokens encrypted at the application layer and CSRF-safe OAuth.

**Architecture:** Three pure helper modules (`crypto`, `state`, `oauth`) with mocked unit tests. Two route handlers (`/api/auth/facebook/start`, `/api/auth/facebook/callback`) implement the OAuth dance. One server-component page at `/dashboard/settings/facebook` branches between three UI states (not connected → picking → connected) backed by two server actions (`saveSelectedPages`, `disconnect`).

**Tech Stack:** Next.js 16 App Router, React 19, `@supabase/ssr`, Vitest + jsdom, Node `crypto`. Tailwind for styling, matching the existing leads pages.

**Spec:** `docs/superpowers/specs/2026-04-29-facebook-oauth-connect-ui-design.md`

---

## File Structure

**Create:**

```
src/lib/facebook/
  crypto.ts           encryptToken(plain) / decryptToken(envelope)
  crypto.test.ts
  state.ts            signState(userId) / verifyState(raw, userId)
  state.test.ts
  oauth.ts            buildAuthUrl, exchangeCodeForToken, exchangeForLongLived,
                      fetchMe, fetchUserPages, FacebookPage type
  oauth.test.ts
src/app/api/auth/facebook/
  start/route.ts
  callback/route.ts
src/app/(app)/dashboard/settings/
  page.tsx                         simple settings index linking to /facebook
src/app/(app)/dashboard/settings/facebook/
  page.tsx                         server component, three-state branching
  actions.ts                       'use server' — saveSelectedPages, disconnect
  _components/
    connect-button.tsx
    page-picker.tsx                client form with checkboxes
    connected-view.tsx
    error-banner.tsx
```

**Modify:**

- `.env.local` — add `FB_TOKEN_ENCRYPTION_KEY`.
- `src/app/(app)/_components/sidebar.tsx` — already has Settings entry; no change unless missing (check at task time).

---

### Task 1: Token encryption helper (TDD)

**Files:**
- Create: `src/lib/facebook/crypto.ts`
- Create: `src/lib/facebook/crypto.test.ts`
- Modify: `.env.local` — add `FB_TOKEN_ENCRYPTION_KEY`

- [ ] **Step 1: Generate a 32-byte key and add to `.env.local`**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Append to `.env.local`:

```
FB_TOKEN_ENCRYPTION_KEY=<output_from_above>
```

- [ ] **Step 2: Write failing test — `src/lib/facebook/crypto.test.ts`**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { randomBytes } from 'node:crypto'

beforeAll(() => {
  process.env.FB_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64')
})

describe('facebook/crypto', () => {
  it('round-trips plaintext through encrypt/decrypt', async () => {
    const { encryptToken, decryptToken } = await import('./crypto')
    const plain = 'EAAB-fake-long-lived-token'
    const envelope = encryptToken(plain)
    expect(envelope).not.toContain(plain)
    expect(decryptToken(envelope)).toBe(plain)
  })

  it('throws when the envelope is tampered with', async () => {
    const { encryptToken, decryptToken } = await import('./crypto')
    const envelope = encryptToken('secret')
    const buf = Buffer.from(envelope, 'base64')
    buf[buf.length - 1] ^= 0x01
    const tampered = buf.toString('base64')
    expect(() => decryptToken(tampered)).toThrow()
  })
})
```

- [ ] **Step 3: Run test — expect FAIL (module does not exist)**

```bash
npx vitest run src/lib/facebook/crypto.test.ts
```

(Project uses npm — `package-lock.json` is present.)

- [ ] **Step 4: Implement `src/lib/facebook/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALG = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

function loadKey(): Buffer {
  const raw = process.env.FB_TOKEN_ENCRYPTION_KEY
  if (!raw) {
    throw new Error('FB_TOKEN_ENCRYPTION_KEY is required')
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error(
      `FB_TOKEN_ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}`,
    )
  }
  return key
}

const key = loadKey()

export function encryptToken(plain: string): string {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALG, key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString('base64')
}

export function decryptToken(envelope: string): string {
  const buf = Buffer.from(envelope, 'base64')
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new Error('envelope too short')
  }
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ct = buf.subarray(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv(ALG, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}
```

- [ ] **Step 5: Run test — expect PASS**

```bash
npx vitest run src/lib/facebook/crypto.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/facebook/crypto.ts src/lib/facebook/crypto.test.ts
git commit -m "$(cat <<'EOF'
feat(fb-oauth): add AES-256-GCM token encryption helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

(Do not commit `.env.local` — it should already be gitignored. Verify with `git status` shows no `.env.local`.)

---

### Task 2: Signed state helper (TDD)

**Files:**
- Create: `src/lib/facebook/state.ts`
- Create: `src/lib/facebook/state.test.ts`

- [ ] **Step 1: Write failing test — `src/lib/facebook/state.test.ts`**

```ts
import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest'

beforeAll(() => {
  process.env.FB_APP_SECRET = 'test-secret'
})

afterEach(() => {
  vi.useRealTimers()
})

describe('facebook/state', () => {
  it('round-trips sign/verify for the same userId', async () => {
    const { signState, verifyState } = await import('./state')
    const raw = signState('user-123')
    expect(verifyState(raw, 'user-123')).toBe(true)
  })

  it('rejects a different userId', async () => {
    const { signState, verifyState } = await import('./state')
    const raw = signState('user-123')
    expect(verifyState(raw, 'someone-else')).toBe(false)
  })

  it('rejects a tampered signature', async () => {
    const { signState, verifyState } = await import('./state')
    const raw = signState('user-123')
    const tampered = raw.slice(0, -2) + 'aa'
    expect(verifyState(tampered, 'user-123')).toBe(false)
  })

  it('rejects state older than 10 minutes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-29T00:00:00Z'))
    const { signState, verifyState } = await import('./state')
    const raw = signState('user-123')
    vi.setSystemTime(new Date('2026-04-29T00:11:00Z'))
    expect(verifyState(raw, 'user-123')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run src/lib/facebook/state.test.ts
```

- [ ] **Step 3: Implement `src/lib/facebook/state.ts`**

```ts
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const TEN_MINUTES_MS = 10 * 60 * 1000

type Payload = { u: string; n: string; t: number }

function secret(): string {
  const s = process.env.FB_APP_SECRET
  if (!s) throw new Error('FB_APP_SECRET is required')
  return s
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

function sign(body: string): string {
  return b64url(createHmac('sha256', secret()).update(body).digest())
}

export function signState(userId: string): string {
  const payload: Payload = { u: userId, n: b64url(randomBytes(16)), t: Date.now() }
  const body = b64url(Buffer.from(JSON.stringify(payload)))
  return `${body}.${sign(body)}`
}

export function verifyState(raw: string, expectedUserId: string): boolean {
  const dot = raw.indexOf('.')
  if (dot < 0) return false
  const body = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  const expected = sign(body)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false
  let payload: Payload
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8'))
  } catch {
    return false
  }
  if (payload.u !== expectedUserId) return false
  if (Date.now() - payload.t > TEN_MINUTES_MS) return false
  return true
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run src/lib/facebook/state.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/facebook/state.ts src/lib/facebook/state.test.ts
git commit -m "$(cat <<'EOF'
feat(fb-oauth): add HMAC-signed CSRF state helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Graph API helpers (TDD with mocked fetch)

**Files:**
- Create: `src/lib/facebook/oauth.ts`
- Create: `src/lib/facebook/oauth.test.ts`

- [ ] **Step 1: Write failing test — `src/lib/facebook/oauth.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest'

beforeAll(() => {
  process.env.FB_APP_ID = 'app-id'
  process.env.FB_APP_SECRET = 'app-secret'
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.example.com'
})

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('facebook/oauth', () => {
  it('builds a consent URL with the right scopes and redirect', async () => {
    const { buildAuthUrl } = await import('./oauth')
    const url = new URL(buildAuthUrl('signed-state'))
    expect(url.origin + url.pathname).toBe('https://www.facebook.com/v19.0/dialog/oauth')
    expect(url.searchParams.get('client_id')).toBe('app-id')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/api/auth/facebook/callback',
    )
    expect(url.searchParams.get('state')).toBe('signed-state')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('scope')).toBe(
      'pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,pages_manage_engagement',
    )
  })

  it('exchanges code → short-lived token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'short-1', token_type: 'bearer' }), {
        status: 200,
      }),
    ) as unknown as typeof fetch)
    const { exchangeCodeForToken } = await import('./oauth')
    const tok = await exchangeCodeForToken('the-code')
    expect(tok).toBe('short-1')
    const calledUrl = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain('https://graph.facebook.com/v19.0/oauth/access_token')
    expect(calledUrl).toContain('code=the-code')
    expect(calledUrl).toContain('client_id=app-id')
    expect(calledUrl).toContain('client_secret=app-secret')
  })

  it('exchanges short-lived → long-lived', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ access_token: 'long-1', expires_in: 5184000 }), {
        status: 200,
      }),
    ) as unknown as typeof fetch)
    const { exchangeForLongLived } = await import('./oauth')
    const out = await exchangeForLongLived('short-1')
    expect(out.token).toBe('long-1')
    expect(out.expiresAt instanceof Date).toBe(true)
    const url = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain('grant_type=fb_exchange_token')
    expect(url).toContain('fb_exchange_token=short-1')
  })

  it('fetches /me id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ id: '12345' }), { status: 200 }),
    ) as unknown as typeof fetch)
    const { fetchMe } = await import('./oauth')
    expect(await fetchMe('long-1')).toBe('12345')
  })

  it('fetches /me/accounts pages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        data: [
          { id: 'p1', name: 'Page One', category: 'Business', access_token: 'pt1' },
          { id: 'p2', name: 'Page Two', category: null, access_token: 'pt2' },
        ],
      }), { status: 200 }),
    ) as unknown as typeof fetch)
    const { fetchUserPages } = await import('./oauth')
    const pages = await fetchUserPages('long-1')
    expect(pages).toEqual([
      { id: 'p1', name: 'Page One', category: 'Business', accessToken: 'pt1' },
      { id: 'p2', name: 'Page Two', category: null, accessToken: 'pt2' },
    ])
  })

  it('throws on non-2xx Graph response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: 'bad code' } }), { status: 400 }),
    ) as unknown as typeof fetch)
    const { exchangeCodeForToken } = await import('./oauth')
    await expect(exchangeCodeForToken('bad')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
npx vitest run src/lib/facebook/oauth.test.ts
```

- [ ] **Step 3: Implement `src/lib/facebook/oauth.ts`**

```ts
const GRAPH = 'https://graph.facebook.com/v19.0'
const DIALOG = 'https://www.facebook.com/v19.0/dialog/oauth'
const SCOPES =
  'pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,pages_manage_engagement'

export type FacebookPage = {
  id: string
  name: string
  category: string | null
  accessToken: string
}

function appId(): string {
  const v = process.env.FB_APP_ID
  if (!v) throw new Error('FB_APP_ID is required')
  return v
}
function appSecret(): string {
  const v = process.env.FB_APP_SECRET
  if (!v) throw new Error('FB_APP_SECRET is required')
  return v
}
function redirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL
  if (!base) throw new Error('NEXT_PUBLIC_APP_URL is required')
  return `${base}/api/auth/facebook/callback`
}

export function buildAuthUrl(state: string): string {
  const u = new URL(DIALOG)
  u.searchParams.set('client_id', appId())
  u.searchParams.set('redirect_uri', redirectUri())
  u.searchParams.set('state', state)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('scope', SCOPES)
  return u.toString()
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Graph API ${res.status}: ${body}`)
  }
  return (await res.json()) as T
}

export async function exchangeCodeForToken(code: string): Promise<string> {
  const u = new URL(`${GRAPH}/oauth/access_token`)
  u.searchParams.set('client_id', appId())
  u.searchParams.set('client_secret', appSecret())
  u.searchParams.set('redirect_uri', redirectUri())
  u.searchParams.set('code', code)
  const data = await getJson<{ access_token: string }>(u.toString())
  return data.access_token
}

export async function exchangeForLongLived(
  shortLived: string,
): Promise<{ token: string; expiresAt: Date | null }> {
  const u = new URL(`${GRAPH}/oauth/access_token`)
  u.searchParams.set('grant_type', 'fb_exchange_token')
  u.searchParams.set('client_id', appId())
  u.searchParams.set('client_secret', appSecret())
  u.searchParams.set('fb_exchange_token', shortLived)
  const data = await getJson<{ access_token: string; expires_in?: number }>(u.toString())
  const expiresAt = data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null
  return { token: data.access_token, expiresAt }
}

export async function fetchMe(longLivedToken: string): Promise<string> {
  const u = new URL(`${GRAPH}/me`)
  u.searchParams.set('fields', 'id')
  u.searchParams.set('access_token', longLivedToken)
  const data = await getJson<{ id: string }>(u.toString())
  return data.id
}

export async function fetchUserPages(longLivedToken: string): Promise<FacebookPage[]> {
  const u = new URL(`${GRAPH}/me/accounts`)
  u.searchParams.set('fields', 'id,name,category,access_token')
  u.searchParams.set('access_token', longLivedToken)
  const data = await getJson<{
    data: Array<{ id: string; name: string; category?: string | null; access_token: string }>
  }>(u.toString())
  return data.data.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category ?? null,
    accessToken: p.access_token,
  }))
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
npx vitest run src/lib/facebook/oauth.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/facebook/oauth.ts src/lib/facebook/oauth.test.ts
git commit -m "$(cat <<'EOF'
feat(fb-oauth): add Graph API client helpers

buildAuthUrl, exchangeCodeForToken, exchangeForLongLived, fetchMe,
fetchUserPages — all v19.0, with mocked-fetch unit tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `/api/auth/facebook/start` route

**Files:**
- Create: `src/app/api/auth/facebook/start/route.ts`

- [ ] **Step 1: Implement the route**

```ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSession } from '@/lib/auth/get-session'
import { signState } from '@/lib/facebook/state'
import { buildAuthUrl } from '@/lib/facebook/oauth'

export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_APP_URL!))
  }

  const state = signState(session.userId)
  const cookieStore = await cookies()
  cookieStore.set('fb_oauth_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 600,
  })

  return NextResponse.redirect(buildAuthUrl(state))
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no errors involving `start/route.ts`. (Pre-existing errors elsewhere are out of scope — note them but don't fix.)

- [ ] **Step 3: Commit**

```bash
git add src/app/api/auth/facebook/start/route.ts
git commit -m "$(cat <<'EOF'
feat(fb-oauth): add /api/auth/facebook/start route

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `/api/auth/facebook/callback` route

**Files:**
- Create: `src/app/api/auth/facebook/callback/route.ts`

- [ ] **Step 1: Implement the route**

```ts
import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { getSession } from '@/lib/auth/get-session'
import { createClient } from '@/lib/supabase/server'
import { verifyState } from '@/lib/facebook/state'
import {
  exchangeCodeForToken,
  exchangeForLongLived,
  fetchMe,
} from '@/lib/facebook/oauth'
import { encryptToken } from '@/lib/facebook/crypto'

function settingsRedirect(error?: string): NextResponse {
  const url = new URL('/dashboard/settings/facebook', process.env.NEXT_PUBLIC_APP_URL!)
  if (error) url.searchParams.set('error', error)
  return NextResponse.redirect(url)
}

export async function GET(req: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_APP_URL!))
  }

  const url = new URL(req.url)
  if (url.searchParams.get('error')) {
    return settingsRedirect('denied')
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) {
    return settingsRedirect('invalid_state')
  }

  const cookieStore = await cookies()
  const cookieState = cookieStore.get('fb_oauth_state')?.value
  cookieStore.delete('fb_oauth_state')
  if (!cookieState || cookieState !== state || !verifyState(state, session.userId)) {
    return settingsRedirect('invalid_state')
  }

  const supabase = await createClient()
  let connectionId: string | null = null

  try {
    const shortLived = await exchangeCodeForToken(code)
    const { token: longLived, expiresAt } = await exchangeForLongLived(shortLived)
    const fbUserId = await fetchMe(longLived)

    const { data, error } = await supabase
      .from('facebook_connections')
      .upsert(
        {
          user_id: session.userId,
          fb_user_id: fbUserId,
          long_lived_token: encryptToken(longLived),
          token_expires_at: expiresAt ? expiresAt.toISOString() : null,
        },
        { onConflict: 'user_id' },
      )
      .select('id')
      .single()

    if (error) throw error
    connectionId = data.id
  } catch {
    if (connectionId) {
      await supabase.from('facebook_connections').delete().eq('id', connectionId)
    }
    return settingsRedirect('exchange_failed')
  }

  return settingsRedirect()
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/auth/facebook/callback/route.ts
git commit -m "$(cat <<'EOF'
feat(fb-oauth): add /api/auth/facebook/callback route

Verifies CSRF state, exchanges code for long-lived token, upserts the
facebook_connections row with the encrypted token, and redirects back
to settings. Rolls back on any token-exchange failure.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Settings index page

**Files:**
- Create: `src/app/(app)/dashboard/settings/page.tsx`

- [ ] **Step 1: Implement a minimal settings index**

```tsx
import Link from 'next/link'

export default function SettingsPage() {
  return (
    <div className="p-8">
      <h1 className="text-[20px] font-semibold text-[#111827] mb-4">Settings</h1>
      <ul className="space-y-2">
        <li>
          <Link
            href="/dashboard/settings/facebook"
            className="text-[14px] font-medium text-[#059669] hover:underline"
          >
            Facebook
          </Link>
        </li>
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add 'src/app/(app)/dashboard/settings/page.tsx'
git commit -m "$(cat <<'EOF'
feat(settings): add settings index with Facebook link

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Facebook settings page — components + actions + page

**Files:**
- Create: `src/app/(app)/dashboard/settings/facebook/_components/error-banner.tsx`
- Create: `src/app/(app)/dashboard/settings/facebook/_components/connect-button.tsx`
- Create: `src/app/(app)/dashboard/settings/facebook/_components/page-picker.tsx`
- Create: `src/app/(app)/dashboard/settings/facebook/_components/connected-view.tsx`
- Create: `src/app/(app)/dashboard/settings/facebook/actions.ts`
- Create: `src/app/(app)/dashboard/settings/facebook/page.tsx`

- [ ] **Step 1: ErrorBanner**

`src/app/(app)/dashboard/settings/facebook/_components/error-banner.tsx`

```tsx
const MESSAGES: Record<string, string> = {
  denied: 'Facebook connection cancelled.',
  invalid_state: 'Authentication state expired or invalid. Please try again.',
  exchange_failed: "Couldn't complete Facebook connection. Please try again.",
}

export function ErrorBanner({ code }: { code?: string }) {
  if (!code) return null
  const msg = MESSAGES[code] ?? 'Something went wrong. Please try again.'
  return (
    <div className="mb-4 rounded-md border border-[#FCA5A5] bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#991B1B]">
      {msg}
    </div>
  )
}
```

- [ ] **Step 2: ConnectButton**

`src/app/(app)/dashboard/settings/facebook/_components/connect-button.tsx`

```tsx
import Link from 'next/link'

export function ConnectButton() {
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-6">
      <h2 className="text-[16px] font-semibold text-[#111827] mb-1">
        Connect Facebook
      </h2>
      <p className="text-[13px] text-[#6B7280] mb-4">
        Connect your Facebook account to link the pages you manage.
      </p>
      <Link
        href="/api/auth/facebook/start"
        className="inline-flex items-center rounded-md bg-[#1877F2] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#0F65D6]"
      >
        Connect Facebook
      </Link>
    </div>
  )
}
```

- [ ] **Step 3: PagePicker**

`src/app/(app)/dashboard/settings/facebook/_components/page-picker.tsx`

```tsx
'use client'

import { useState, useTransition } from 'react'
import type { FacebookPage } from '@/lib/facebook/oauth'
import { saveSelectedPages, disconnect } from '../actions'

export function PagePicker({ pages }: { pages: FacebookPage[] }) {
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (pages.length === 0) {
    return (
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-6">
        <h2 className="text-[16px] font-semibold text-[#111827] mb-2">
          No pages found
        </h2>
        <p className="text-[13px] text-[#6B7280] mb-4">
          Your Facebook account doesn&apos;t manage any pages.
        </p>
        <form action={() => start(async () => { await disconnect() })}>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] font-medium text-[#374151] hover:bg-[#F3F4F6]"
          >
            Disconnect
          </button>
        </form>
      </div>
    )
  }

  return (
    <form
      action={(formData) =>
        start(async () => {
          const ids = formData.getAll('page_id') as string[]
          if (ids.length === 0) {
            setError('Pick at least one page.')
            return
          }
          setError(null)
          await saveSelectedPages(ids)
        })
      }
      className="rounded-lg border border-[#E5E7EB] bg-white p-6"
    >
      <h2 className="text-[16px] font-semibold text-[#111827] mb-1">
        Pick pages to track
      </h2>
      <p className="text-[13px] text-[#6B7280] mb-4">
        Select one or more pages to connect.
      </p>
      <ul className="space-y-2 mb-4">
        {pages.map((p) => (
          <li key={p.id} className="flex items-center gap-3">
            <input
              type="checkbox"
              name="page_id"
              value={p.id}
              id={`pg-${p.id}`}
              className="h-4 w-4 rounded border-[#D1D5DB]"
            />
            <label htmlFor={`pg-${p.id}`} className="text-[14px] text-[#111827]">
              {p.name}
              {p.category && (
                <span className="ml-2 text-[12px] text-[#6B7280]">{p.category}</span>
              )}
            </label>
          </li>
        ))}
      </ul>
      {error && (
        <p className="mb-3 text-[13px] text-[#991B1B]">{error}</p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center rounded-md bg-[#059669] px-4 py-2 text-[14px] font-medium text-white hover:bg-[#047857] disabled:opacity-50"
      >
        {pending ? 'Saving…' : 'Save pages'}
      </button>
    </form>
  )
}
```

- [ ] **Step 4: ConnectedView**

`src/app/(app)/dashboard/settings/facebook/_components/connected-view.tsx`

```tsx
'use client'

import { useTransition } from 'react'
import { disconnect } from '../actions'

type Page = {
  id: string
  fb_page_id: string
  name: string
  category: string | null
}

export function ConnectedView({ pages }: { pages: Page[] }) {
  const [pending, start] = useTransition()
  return (
    <div className="rounded-lg border border-[#E5E7EB] bg-white p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-[16px] font-semibold text-[#111827] mb-1">
            Connected Facebook pages
          </h2>
          <p className="text-[13px] text-[#6B7280]">
            {pages.length} page{pages.length === 1 ? '' : 's'} connected.
          </p>
        </div>
        <form action={() => start(async () => { await disconnect() })}>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center rounded-md border border-[#E5E7EB] px-3 py-1.5 text-[13px] font-medium text-[#374151] hover:bg-[#F3F4F6]"
          >
            {pending ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </form>
      </div>
      <ul className="divide-y divide-[#E5E7EB]">
        {pages.map((p) => (
          <li key={p.id} className="py-3">
            <div className="text-[14px] font-medium text-[#111827]">{p.name}</div>
            {p.category && (
              <div className="text-[12px] text-[#6B7280]">{p.category}</div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 5: Server actions**

`src/app/(app)/dashboard/settings/facebook/actions.ts`

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { createClient } from '@/lib/supabase/server'
import { decryptToken, encryptToken } from '@/lib/facebook/crypto'
import { fetchUserPages } from '@/lib/facebook/oauth'

const SETTINGS_PATH = '/dashboard/settings/facebook'

export async function saveSelectedPages(pageIds: string[]): Promise<void> {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!Array.isArray(pageIds) || pageIds.length === 0) return

  const supabase = await createClient()
  const { data: conn, error: cErr } = await supabase
    .from('facebook_connections')
    .select('id, long_lived_token')
    .eq('user_id', session.userId)
    .single()
  if (cErr || !conn) return

  const longLived = decryptToken(conn.long_lived_token)
  const allPages = await fetchUserPages(longLived)
  const selected = allPages.filter((p) => pageIds.includes(p.id))
  if (selected.length === 0) return

  const rows = selected.map((p) => ({
    connection_id: conn.id,
    fb_page_id: p.id,
    name: p.name,
    category: p.category,
    page_access_token: encryptToken(p.accessToken),
  }))

  await supabase.from('facebook_pages').insert(rows)
  revalidatePath(SETTINGS_PATH)
}

export async function disconnect(): Promise<void> {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = await createClient()
  await supabase.from('facebook_connections').delete().eq('user_id', session.userId)
  revalidatePath(SETTINGS_PATH)
}
```

- [ ] **Step 6: Settings page (server, three-state branching)**

`src/app/(app)/dashboard/settings/facebook/page.tsx`

```tsx
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { createClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/facebook/crypto'
import { fetchUserPages } from '@/lib/facebook/oauth'
import { ErrorBanner } from './_components/error-banner'
import { ConnectButton } from './_components/connect-button'
import { PagePicker } from './_components/page-picker'
import { ConnectedView } from './_components/connected-view'

type SearchParams = { error?: string }

export default async function FacebookSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  const { error } = await searchParams

  const supabase = await createClient()

  const { data: conn } = await supabase
    .from('facebook_connections')
    .select('id, long_lived_token')
    .eq('user_id', session.userId)
    .maybeSingle()

  let body: React.ReactNode

  if (!conn) {
    body = <ConnectButton />
  } else {
    const { data: pages } = await supabase
      .from('facebook_pages')
      .select('id, fb_page_id, name, category')
      .eq('connection_id', conn.id)
      .order('created_at', { ascending: true })

    if (!pages || pages.length === 0) {
      let pickerPages: Awaited<ReturnType<typeof fetchUserPages>> = []
      let pickerError: string | null = null
      try {
        pickerPages = await fetchUserPages(decryptToken(conn.long_lived_token))
      } catch {
        pickerError = 'fetch_failed'
      }
      body = pickerError ? (
        <ErrorBanner code="exchange_failed" />
      ) : (
        <PagePicker pages={pickerPages} />
      )
    } else {
      body = <ConnectedView pages={pages} />
    }
  }

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-[20px] font-semibold text-[#111827] mb-4">Facebook</h1>
      <ErrorBanner code={error} />
      {body}
    </div>
  )
}
```

- [ ] **Step 7: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: no new errors from these files.

- [ ] **Step 8: Run all tests**

```bash
npm test
```

Expected: all `facebook/` tests pass; nothing else regressed.

- [ ] **Step 9: Commit**

```bash
git add 'src/app/(app)/dashboard/settings/facebook/'
git commit -m "$(cat <<'EOF'
feat(fb-oauth): add Facebook settings page with picker + connected view

Three-state UI driven by DB: not-connected, picking, connected.
Server actions saveSelectedPages and disconnect; tokens are decrypted
only inside the action / picker render to call /me/accounts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: End-to-end smoke test (manual)

**Files:** none

This task is a manual run-through to confirm the wiring works. It assumes the
remote Supabase project is set up and the Facebook app's OAuth redirect URI is
registered.

- [ ] **Step 1: Add the redirect URI in the Facebook App dashboard**

In the Meta for Developers console for the FB app referenced by `FB_APP_ID`,
add `${NEXT_PUBLIC_APP_URL}/api/auth/facebook/callback` to **Valid OAuth
Redirect URIs**.

- [ ] **Step 2: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 3: Sign in as a user and visit `/dashboard/settings/facebook`**

Expected: "Connect Facebook" button visible.

- [ ] **Step 4: Click "Connect Facebook"**

Expected: redirected to facebook.com consent dialog, scopes listed include
`pages_show_list` etc.

- [ ] **Step 5: Approve consent**

Expected: redirected back to `/dashboard/settings/facebook`. The page now
shows the page picker with all of your managed pages as checkboxes (or empty
state if none).

- [ ] **Step 6: Verify a connection row exists in Supabase**

Use the Supabase MCP `mcp__supabase__execute_sql`:

```sql
select id, user_id, fb_user_id, token_expires_at, length(long_lived_token)
from public.facebook_connections;
```

Expected: one row, `length(long_lived_token)` ~150–250 (encrypted base64).

- [ ] **Step 7: Pick at least one page and submit**

Expected: page reloads showing the connected view with the page(s) listed.

- [ ] **Step 8: Verify pages rows exist**

```sql
select id, connection_id, fb_page_id, name, length(page_access_token)
from public.facebook_pages;
```

Expected: one row per selected page; encrypted token length non-trivial.

- [ ] **Step 9: Click Disconnect**

Expected: page reverts to the "Connect Facebook" button.

```sql
select count(*) from public.facebook_connections;
select count(*) from public.facebook_pages;
```

Expected: both `0` (cascade worked).

- [ ] **Step 10: Negative test — invalid state**

Visit `/api/auth/facebook/callback?code=foo&state=bar` directly while signed
in. Expected: redirected to `/dashboard/settings/facebook?error=invalid_state`
with the red banner.

- [ ] **Step 11: Report results**

If any step fails, fix in the responsible task before claiming done. If all
pass, this plan is complete.

---

## Done When

- All Vitest unit tests for `crypto`, `state`, `oauth` pass.
- TypeScript compiles cleanly for the new files.
- Manual smoke test (Task 8) goes through every state cleanly: not-connected →
  consent → picking → connected → disconnect → not-connected.
- Tokens stored in DB are encrypted (not plaintext); RLS still enforced.
- All commits in place; main branch clean.
