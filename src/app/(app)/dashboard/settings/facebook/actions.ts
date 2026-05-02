'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { createClient } from '@/lib/supabase/server'
import { decryptToken, encryptToken } from '@/lib/facebook/crypto'
import { fetchUserPages } from '@/lib/facebook/oauth'
import { subscribePageToWebhook } from '@/lib/facebook/messenger'

const SETTINGS_PATH = '/dashboard/settings/facebook'

function errRedirect(code: string, detail?: string): never {
  const qs = new URLSearchParams({ error: code })
  if (detail) qs.set('detail', detail.slice(0, 300))
  redirect(`${SETTINGS_PATH}?${qs.toString()}`)
}

export async function savePagesForm(formData: FormData): Promise<void> {
  console.log('[savePagesForm] invoked')

  const pageIds = formData.getAll('page_id').map(String).filter(Boolean)
  console.log('[savePagesForm] pageIds:', pageIds)
  if (pageIds.length === 0) errRedirect('no_selection')

  const session = await getSession()
  if (!session) redirect('/login')
  console.log('[savePagesForm] session.userId:', session.userId)

  const supabase = await createClient()

  const { data: conn, error: cErr } = await supabase
    .from('facebook_connections')
    .select('id, long_lived_token')
    .eq('user_id', session.userId)
    .single()
  if (cErr) {
    console.error('[savePagesForm] load connection failed:', cErr)
    errRedirect('no_connection', cErr.message)
  }
  if (!conn) errRedirect('no_connection')
  console.log('[savePagesForm] connection.id:', conn.id)

  let allPages: Awaited<ReturnType<typeof fetchUserPages>> = []
  try {
    const longLived = decryptToken(conn.long_lived_token)
    allPages = await fetchUserPages(longLived)
    console.log('[savePagesForm] fb returned', allPages.length, 'pages')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[savePagesForm] fetchUserPages failed:', msg)
    errRedirect('fetch_failed', msg)
  }

  const selected = allPages.filter((p) => pageIds.includes(p.id))
  if (selected.length === 0) errRedirect('no_match')

  const rows = selected.map((p) => ({
    connection_id: conn.id,
    fb_page_id: p.id,
    name: p.name,
    category: p.category,
    picture_url: p.pictureUrl,
    page_access_token: encryptToken(p.accessToken),
  }))

  const { error: insertErr, data: inserted } = await supabase
    .from('facebook_pages')
    .upsert(rows, { onConflict: 'fb_page_id' })
    .select('id')
  if (insertErr) {
    console.error('[savePagesForm] insert failed:', insertErr)
    errRedirect('save_failed', insertErr.message)
  }
  console.log('[savePagesForm] inserted/upserted', inserted?.length ?? 0, 'rows')

  // Subscribe each selected page to Messenger webhook events. Failures here
  // do not block the save — the dashboard surfaces the issue separately.
  await Promise.allSettled(
    selected.map(async (p) => {
      try {
        await subscribePageToWebhook(p.accessToken)
        console.log('[savePagesForm] subscribed page', p.id)
      } catch (e) {
        console.error('[savePagesForm] subscribe failed', p.id, e)
      }
    }),
  )

  revalidatePath(SETTINGS_PATH)
  redirect(SETTINGS_PATH)
}

export async function disconnectForm(): Promise<void> {
  console.log('[disconnectForm] invoked')
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = await createClient()
  const { error } = await supabase
    .from('facebook_connections')
    .delete()
    .eq('user_id', session.userId)
  if (error) {
    console.error('[disconnectForm] failed:', error)
    errRedirect('disconnect_failed', error.message)
  }
  revalidatePath(SETTINGS_PATH)
  redirect(SETTINGS_PATH)
}
