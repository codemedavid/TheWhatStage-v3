'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { createClient } from '@/lib/supabase/server'
import { decryptToken, encryptToken } from '@/lib/facebook/crypto'
import { fetchUserPages } from '@/lib/facebook/oauth'

const SETTINGS_PATH = '/dashboard/settings/facebook'

export async function savePagesForm(formData: FormData): Promise<void> {
  const pageIds = formData.getAll('page_id').map(String).filter(Boolean)
  if (pageIds.length === 0) {
    redirect(`${SETTINGS_PATH}?error=no_selection`)
  }

  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = await createClient()
  const { data: conn, error: cErr } = await supabase
    .from('facebook_connections')
    .select('id, long_lived_token')
    .eq('user_id', session.userId)
    .single()
  if (cErr || !conn) {
    console.error('[savePagesForm] load connection failed:', cErr)
    redirect(`${SETTINGS_PATH}?error=no_connection`)
  }

  const longLived = decryptToken(conn.long_lived_token)
  const allPages = await fetchUserPages(longLived)
  const selected = allPages.filter((p) => pageIds.includes(p.id))
  if (selected.length === 0) {
    redirect(`${SETTINGS_PATH}?error=no_match`)
  }

  const rows = selected.map((p) => ({
    connection_id: conn.id,
    fb_page_id: p.id,
    name: p.name,
    category: p.category,
    page_access_token: encryptToken(p.accessToken),
  }))

  const { error: insertErr } = await supabase
    .from('facebook_pages')
    .upsert(rows, { onConflict: 'fb_page_id' })
  if (insertErr) {
    console.error('[savePagesForm] insert failed:', insertErr)
    redirect(
      `${SETTINGS_PATH}?error=save_failed&detail=${encodeURIComponent(insertErr.message)}`,
    )
  }

  revalidatePath(SETTINGS_PATH)
  redirect(SETTINGS_PATH)
}

export async function disconnectForm(): Promise<void> {
  const session = await getSession()
  if (!session) redirect('/login')

  const supabase = await createClient()
  const { error } = await supabase
    .from('facebook_connections')
    .delete()
    .eq('user_id', session.userId)
  if (error) {
    console.error('[disconnectForm] failed:', error)
    redirect(
      `${SETTINGS_PATH}?error=disconnect_failed&detail=${encodeURIComponent(error.message)}`,
    )
  }
  revalidatePath(SETTINGS_PATH)
  redirect(SETTINGS_PATH)
}
