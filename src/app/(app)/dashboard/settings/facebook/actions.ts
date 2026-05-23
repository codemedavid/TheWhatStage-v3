'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { createClient } from '@/lib/supabase/server'
import { decryptToken, encryptToken } from '@/lib/facebook/crypto'
import { fetchUserPages } from '@/lib/facebook/oauth'
import { subscribePageToWebhook } from '@/lib/facebook/messenger'
import { createAdminClient } from '@/lib/supabase/admin'
import { dispatchCapiEvent } from '@/lib/facebook/capi'
import crypto from 'node:crypto'

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

  // Note: we used to auto-submit every draft/rejected utility template here.
  // That was removed because Meta will 403 every submission when the app is
  // missing the `pages_utility_messaging` permission, marking the user's
  // whole registry as rejected on first connect. Templates are now submitted
  // explicitly from the Templates dashboard.

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
}

export async function saveCapiConfigForm(formData: FormData): Promise<void> {
  const session = await getSession()
  if (!session) redirect('/login')

  const pageId = String(formData.get('page_id') ?? '')
  if (!pageId) errRedirect('missing_page_id')

  const enabled = formData.get('capi_enabled') === 'on'
  const datasetId = String(formData.get('capi_dataset_id') ?? '').trim() || null
  const testCode = String(formData.get('capi_test_event_code') ?? '').trim() || null
  const tokenUnchanged = formData.get('token_unchanged') === '1'
  const newToken = String(formData.get('capi_access_token') ?? '').trim()

  if (enabled && !datasetId) errRedirect('capi_missing_dataset')

  const supabase = await createClient()

  // Ownership check + load current token.
  const { data: existing } = await supabase
    .from('facebook_pages')
    .select('id, capi_access_token, connection_id')
    .eq('id', pageId)
    .maybeSingle<{ id: string; capi_access_token: string | null; connection_id: string }>()
  if (!existing) errRedirect('page_not_found')
  const { data: conn } = await supabase
    .from('facebook_connections')
    .select('id, user_id')
    .eq('id', existing.connection_id)
    .maybeSingle<{ id: string; user_id: string }>()
  if (!conn || conn.user_id !== session.userId) errRedirect('forbidden')

  let tokenToStore: string | null = existing.capi_access_token
  if (!tokenUnchanged) {
    tokenToStore = newToken ? encryptToken(newToken) : null
  }
  if (enabled && !tokenToStore) errRedirect('capi_missing_token')

  const { error } = await supabase
    .from('facebook_pages')
    .update({
      capi_enabled: enabled,
      capi_dataset_id: datasetId,
      capi_access_token: tokenToStore,
      capi_test_event_code: testCode,
    })
    .eq('id', pageId)
  if (error) errRedirect('capi_save_failed', error.message)

  revalidatePath(SETTINGS_PATH)
  redirect(`${SETTINGS_PATH}?capi_saved=1`)
}

export async function sendCapiTestEventForm(formData: FormData): Promise<void> {
  const session = await getSession()
  if (!session) redirect('/login')

  const pageId = String(formData.get('page_id') ?? '')
  if (!pageId) errRedirect('missing_page_id')

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from('facebook_pages')
    .select('id, connection_id, capi_enabled, capi_dataset_id, capi_access_token, capi_test_event_code')
    .eq('id', pageId)
    .maybeSingle<{
      id: string
      connection_id: string
      capi_enabled: boolean
      capi_dataset_id: string | null
      capi_access_token: string | null
      capi_test_event_code: string | null
    }>()
  if (!existing) errRedirect('page_not_found')

  const { data: conn } = await admin
    .from('facebook_connections')
    .select('user_id')
    .eq('id', existing.connection_id)
    .maybeSingle<{ user_id: string }>()
  if (!conn || conn.user_id !== session.userId) errRedirect('forbidden')

  if (!existing.capi_enabled || !existing.capi_dataset_id || !existing.capi_access_token) {
    errRedirect('capi_not_configured')
  }

  const fakeSubmissionId = crypto.randomUUID()
  await dispatchCapiEvent({
    admin,
    userId: session.userId,
    submissionId: fakeSubmissionId,
    actionPageId: 'test-action-page',
    actionPageKind: 'form',
    actionPageSlug: 'test',
    outcome: 'submitted',
    psid: 'TEST_PSID',
    pageRowId: existing.id,
    parsedData: {},
    pageConfig: {},
    leadId: null,
    clientIp: '127.0.0.1',
    clientUserAgent: 'capi-test',
    submissionCreatedAt: new Date(),
    businessOrderId: null,
    catalogOrder: null,
  })

  revalidatePath(SETTINGS_PATH)
  redirect(`${SETTINGS_PATH}?capi_test=1`)
}
