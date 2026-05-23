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
import type { CapiFormState } from './_lib/capi-form-state'

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

export async function saveCapiConfigAction(
  _prev: CapiFormState,
  formData: FormData,
): Promise<CapiFormState> {
  const session = await getSession()
  if (!session) return { status: 'error', message: 'Your session expired. Please sign in again.' }

  const pageId = String(formData.get('page_id') ?? '')
  if (!pageId) return { status: 'error', message: 'Missing page id.', field: 'page' }

  const enabled = formData.get('capi_enabled') === 'on'
  const datasetId = String(formData.get('capi_dataset_id') ?? '').trim() || null
  const testCode = String(formData.get('capi_test_event_code') ?? '').trim() || null
  const newToken = String(formData.get('capi_access_token') ?? '').trim()

  if (datasetId && !/^\d{6,}$/.test(datasetId)) {
    return {
      status: 'error',
      message: 'Dataset ID should be the numeric Pixel ID from Events Manager.',
      field: 'dataset',
    }
  }
  if (enabled && !datasetId) {
    return { status: 'error', message: 'Dataset ID is required when CAPI is enabled.', field: 'dataset' }
  }

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('facebook_pages')
    .select('id, capi_access_token, connection_id')
    .eq('id', pageId)
    .maybeSingle<{ id: string; capi_access_token: string | null; connection_id: string }>()
  if (!existing) return { status: 'error', message: 'Page not found.', field: 'page' }

  const { data: conn } = await supabase
    .from('facebook_connections')
    .select('id, user_id')
    .eq('id', existing.connection_id)
    .maybeSingle<{ id: string; user_id: string }>()
  if (!conn || conn.user_id !== session.userId) {
    return { status: 'error', message: 'You do not have access to this page.', field: 'page' }
  }

  // Blank token never wipes a stored one. Explicit clear happens via a
  // separate "Clear token" action, not by submitting an empty input.
  const tokenToStore: string | null = newToken ? encryptToken(newToken) : existing.capi_access_token
  if (enabled && !tokenToStore) {
    return {
      status: 'error',
      message: 'Paste a CAPI access token before enabling. You can create one in Events Manager → Settings → Conversions API.',
      field: 'token',
    }
  }

  const { error } = await supabase
    .from('facebook_pages')
    .update({
      capi_enabled: enabled,
      capi_dataset_id: datasetId,
      capi_access_token: tokenToStore,
      capi_test_event_code: testCode,
    })
    .eq('id', pageId)
  if (error) return { status: 'error', message: error.message }

  revalidatePath(SETTINGS_PATH)
  return {
    status: 'ok',
    message: enabled ? 'Saved. Events will be sent on the next action page submission.' : 'Saved.',
  }
}

export async function sendCapiTestEventAction(
  _prev: CapiFormState,
  formData: FormData,
): Promise<CapiFormState> {
  const session = await getSession()
  if (!session) return { status: 'error', message: 'Your session expired. Please sign in again.' }

  const pageId = String(formData.get('page_id') ?? '')
  if (!pageId) return { status: 'error', message: 'Missing page id.', field: 'page' }

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
  if (!existing) return { status: 'error', message: 'Page not found.', field: 'page' }

  const { data: conn } = await admin
    .from('facebook_connections')
    .select('user_id')
    .eq('id', existing.connection_id)
    .maybeSingle<{ user_id: string }>()
  if (!conn || conn.user_id !== session.userId) {
    return { status: 'error', message: 'You do not have access to this page.', field: 'page' }
  }

  if (!existing.capi_enabled || !existing.capi_dataset_id || !existing.capi_access_token) {
    return {
      status: 'error',
      message: 'Enable CAPI and save a dataset ID + token before sending a test event.',
    }
  }

  // Meta validates that user_data.page_scoped_user_id is numeric (real PSIDs
  // are 15–17 digit numbers). Prefer a real PSID from this page's messenger
  // history so the test event resolves to a known user in Events Manager;
  // otherwise fall back to a numeric placeholder so the format check passes.
  const { data: thread } = await admin
    .from('messenger_threads')
    .select('psid')
    .eq('page_id', existing.id)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle<{ psid: string }>()
  const testPsid = thread?.psid && /^\d+$/.test(thread.psid) ? thread.psid : '1000000000000000'

  // Prefix with 'test-' so isUuid() returns false and the log row's
  // submission_id stays null — avoiding a FK violation against action_page_submissions.
  const fakeSubmissionId = `test-${crypto.randomUUID()}`
  let result: Awaited<ReturnType<typeof dispatchCapiEvent>>
  try {
    result = await dispatchCapiEvent({
      admin,
      userId: session.userId,
      submissionId: fakeSubmissionId,
      actionPageId: 'test-action-page',
      actionPageKind: 'form',
      outcome: 'submitted',
      psid: testPsid,
      pageRowId: existing.id,
      parsedData: {},
      pageConfig: {},
      leadId: null,
      submissionCreatedAt: new Date(),
      businessOrderId: null,
      catalogOrder: null,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return { status: 'error', message: `Test event failed: ${msg}` }
  }

  if (result.status === 'error') {
    return {
      status: 'error',
      message: `Test event rejected by Meta: ${result.error_message ?? 'unknown error'}`,
    }
  }

  revalidatePath(SETTINGS_PATH)
  return {
    status: 'ok',
    message: existing.capi_test_event_code
      ? `Test event sent. Check Events Manager → Test events (code: ${existing.capi_test_event_code}).`
      : 'Test event sent. Check Events Manager for delivery.',
  }
}
