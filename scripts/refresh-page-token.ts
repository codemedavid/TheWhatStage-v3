/**
 * One-off: refresh a single page's stored page access token from the owning
 * user's long-lived token, then (re-)subscribe it to the webhook fields and
 * read back the live subscription to confirm message_echoes is active.
 *
 * Why: a stored page_access_token can go stale (password change, app review
 * scope change, 60-day expiry on the parent long-lived token). Refreshing
 * re-derives a fresh page token via /me/accounts before re-subscribing.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/refresh-page-token.ts "Kanta Mo Kwento Mo"
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * FB_TOKEN_ENCRYPTION_KEY (and the long-lived token must still be valid).
 */
import { createClient } from '@supabase/supabase-js'
import { decryptToken, encryptToken } from '../src/lib/facebook/crypto'
import { fetchUserPages } from '../src/lib/facebook/oauth'
import { subscribePageToWebhook } from '../src/lib/facebook/messenger'

const GRAPH = 'https://graph.facebook.com/v24.0'

type SubscribedApp = {
  id: string
  name?: string
  subscribed_fields?: string[]
}

async function fetchSubscribedFields(pageAccessToken: string): Promise<SubscribedApp[]> {
  const u = new URL(`${GRAPH}/me/subscribed_apps`)
  u.searchParams.set('access_token', pageAccessToken)
  const res = await fetch(u.toString())
  const body = await res.text()
  if (!res.ok) throw new Error(`subscribed_apps read ${res.status}: ${body}`)
  return (JSON.parse(body) as { data: SubscribedApp[] }).data
}

async function main() {
  const nameQuery = process.argv[2] ?? 'Kanta Mo Kwento Mo'

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  }
  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // 1. Locate the page (case-insensitive match on name).
  const { data: pages, error: pagesErr } = await admin
    .from('facebook_pages')
    .select('id, fb_page_id, name, connection_id, page_access_token')
    .ilike('name', `%${nameQuery}%`)
  if (pagesErr) throw pagesErr
  if (!pages?.length) {
    throw new Error(`No facebook_pages row matching name ~ "${nameQuery}"`)
  }
  if (pages.length > 1) {
    console.log('Multiple matches — refreshing all:')
    for (const p of pages) console.log(`  - ${p.name} (${p.fb_page_id})`)
  }

  for (const page of pages) {
    console.log(`\n=== ${page.name} (fb_page_id=${page.fb_page_id}) ===`)

    // 2. Load + decrypt the owning user's long-lived token.
    const { data: conn, error: connErr } = await admin
      .from('facebook_connections')
      .select('long_lived_token, token_expires_at')
      .eq('id', page.connection_id)
      .single()
    if (connErr) throw connErr
    const longLived = decryptToken(conn.long_lived_token as string)
    console.log(
      `long-lived token expires: ${conn.token_expires_at ?? 'unknown'}`,
    )

    // 3. Re-fetch pages from Graph and find the fresh page token.
    const livePages = await fetchUserPages(longLived)
    const match = livePages.find((p) => p.id === page.fb_page_id)
    if (!match) {
      throw new Error(
        `Page ${page.fb_page_id} not returned by /me/accounts — the long-lived ` +
          `token may lack access or the user must reconnect.`,
      )
    }

    // 4. Persist the refreshed (encrypted) page token.
    const { error: updErr } = await admin
      .from('facebook_pages')
      .update({
        page_access_token: encryptToken(match.accessToken),
        updated_at: new Date().toISOString(),
      })
      .eq('id', page.id)
    if (updErr) throw updErr
    console.log('page_access_token refreshed ✓')

    // 5. (Re-)subscribe to webhook fields (includes message_echoes).
    await subscribePageToWebhook(match.accessToken)
    console.log('subscribed_apps POST ✓')

    // 6. Read back the live subscription to confirm.
    const apps = await fetchSubscribedFields(match.accessToken)
    const ours = apps[0]
    const fields = ours?.subscribed_fields ?? []
    console.log(`subscribed app: ${ours?.name ?? '(unknown)'} (${ours?.id ?? '?'})`)
    console.log(`subscribed_fields (${fields.length}): ${fields.join(', ') || '(none)'}`)
    console.log(
      fields.includes('message_echoes')
        ? '✅ message_echoes is ACTIVE'
        : '❌ message_echoes NOT present — app may lack the field permission',
    )
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
