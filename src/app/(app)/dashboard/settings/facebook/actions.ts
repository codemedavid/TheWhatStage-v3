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
  if (cErr) {
    console.error('[saveSelectedPages] load connection failed:', cErr)
    throw new Error(`Could not load Facebook connection: ${cErr.message}`)
  }
  if (!conn) {
    throw new Error('No Facebook connection found for this user')
  }

  const longLived = decryptToken(conn.long_lived_token)
  const allPages = await fetchUserPages(longLived)
  const selected = allPages.filter((p) => pageIds.includes(p.id))
  if (selected.length === 0) {
    throw new Error('None of the selected pages were returned by Facebook')
  }

  const rows = selected.map((p) => ({
    connection_id: conn.id,
    fb_page_id: p.id,
    name: p.name,
    category: p.category,
    page_access_token: encryptToken(p.accessToken),
  }))

  const { error: insertErr } = await supabase.from('facebook_pages').insert(rows)
  if (insertErr) {
    console.error('[saveSelectedPages] insert failed:', insertErr)
    throw new Error(
      `Could not save pages: ${insertErr.message}${insertErr.details ? ' — ' + insertErr.details : ''}`,
    )
  }

  revalidatePath(SETTINGS_PATH)
  redirect(SETTINGS_PATH)
}

export async function disconnect(): Promise<void> {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = await createClient()
  const { error } = await supabase
    .from('facebook_connections')
    .delete()
    .eq('user_id', session.userId)
  if (error) {
    console.error('[disconnect] failed:', error)
    throw new Error(`Could not disconnect: ${error.message}`)
  }
  revalidatePath(SETTINGS_PATH)
  redirect(SETTINGS_PATH)
}
