/**
 * One-shot backfill: refetch FB display names for messenger_threads whose
 * full_name is null or still the generic "Messenger user" placeholder.
 * Updates both the thread and the linked lead.
 *
 * Run once with:   npx tsx scripts/backfill-messenger-names.ts
 *
 * Requires the same env you use in dev: NEXT_PUBLIC_SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, FB_TOKEN_ENCRYPTION_KEY.
 */
import { createClient } from '@supabase/supabase-js'
import { decryptToken } from '../src/lib/facebook/crypto'
import { fetchMessengerProfile } from '../src/lib/facebook/messenger'

function isGeneric(name: string | null): boolean {
  if (!name) return true
  const t = name.trim()
  if (!t) return true
  return /^messenger user(\s|$)/i.test(t)
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')
  }
  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: threads, error } = await admin
    .from('messenger_threads')
    .select('id, psid, full_name, lead_id, page_id, facebook_pages(page_access_token)')
  if (error) throw error
  if (!threads?.length) {
    console.log('No threads found.')
    return
  }

  let updated = 0
  let skipped = 0
  for (const t of threads) {
    if (!isGeneric(t.full_name as string | null)) {
      skipped += 1
      continue
    }
    const pageRow = Array.isArray(t.facebook_pages)
      ? t.facebook_pages[0]
      : (t.facebook_pages as { page_access_token?: string } | null)
    if (!pageRow?.page_access_token) {
      console.warn(`thread ${t.id}: no page access token, skipping`)
      skipped += 1
      continue
    }
    const pageToken = decryptToken(pageRow.page_access_token)
    const profile = await fetchMessengerProfile({
      pageAccessToken: pageToken,
      psid: t.psid as string,
    })
    if (isGeneric(profile.fullName)) {
      console.log(`thread ${t.id}: FB still won't return a name`)
      skipped += 1
      continue
    }
    await admin
      .from('messenger_threads')
      .update({ full_name: profile.fullName, picture_url: profile.pictureUrl })
      .eq('id', t.id)
    if (t.lead_id) {
      await admin
        .from('leads')
        .update({ name: profile.fullName })
        .eq('id', t.lead_id as string)
    }
    console.log(`thread ${t.id} → "${profile.fullName}"`)
    updated += 1
  }

  console.log(`\nDone. updated=${updated} skipped=${skipped}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
