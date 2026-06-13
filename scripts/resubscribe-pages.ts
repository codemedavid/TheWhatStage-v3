/**
 * One-shot re-subscribe: re-run subscribed_apps for every connected Facebook
 * page so it picks up newly added SUBSCRIBED_FIELDS (notably message_echoes,
 * required for human-takeover detection from Page Inbox / Business Suite /
 * the Messenger app). Idempotent — safe to run any time.
 *
 * Run once with:   npx tsx scripts/resubscribe-pages.ts
 *
 * Requires the same env you use in dev: NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, FB_TOKEN_ENCRYPTION_KEY.
 */
import { createClient } from '@supabase/supabase-js'
import { decryptToken } from '../src/lib/facebook/crypto'
import { subscribePageToWebhook } from '../src/lib/facebook/messenger'

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  }
  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: pages, error } = await admin
    .from('facebook_pages')
    .select('id, fb_page_id, name, page_access_token')
  if (error) throw error
  if (!pages?.length) {
    console.log('No connected pages found.')
    return
  }

  let ok = 0
  let failed = 0
  for (const p of pages) {
    try {
      const token = decryptToken(p.page_access_token as string)
      await subscribePageToWebhook(token)
      ok += 1
      console.log(`subscribed: ${p.name} (${p.fb_page_id})`)
    } catch (e) {
      failed += 1
      console.error(
        `FAILED: ${p.name} (${p.fb_page_id}) — ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
  console.log(`Done. ${ok} subscribed, ${failed} failed, of ${pages.length} pages.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
