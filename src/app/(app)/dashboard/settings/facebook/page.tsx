import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { createClient } from '@/lib/supabase/server'
import { decryptToken } from '@/lib/facebook/crypto'
import { fetchUserPages } from '@/lib/facebook/oauth'
import { ErrorBanner } from './_components/error-banner'
import { ConnectButton } from './_components/connect-button'
import { PagePicker } from './_components/page-picker'
import { ConnectedView } from './_components/connected-view'
import { CapiSection } from './_components/capi-section'

type SearchParams = { error?: string; detail?: string }

export default async function FacebookSettingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const session = await getSession()
  if (!session) redirect('/login')
  const { error, detail } = await searchParams

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
      .select('id, fb_page_id, name, category, picture_url, capi_enabled, capi_dataset_id, capi_access_token, capi_test_event_code')
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
      const capiPages = (pages ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        capi_enabled: Boolean(p.capi_enabled),
        capi_dataset_id: p.capi_dataset_id ?? null,
        has_capi_token: Boolean(p.capi_access_token),
        capi_test_event_code: p.capi_test_event_code ?? null,
      }))

      const { data: capiLogs } = await supabase
        .from('capi_event_logs')
        .select('id, created_at, status, skip_reason, event_name, http_status, fb_trace_id, error_message, page_id')
        .eq('user_id', session.userId)
        .order('created_at', { ascending: false })
        .limit(20)

      const pageNameById = new Map((pages ?? []).map((p) => [p.id, p.name]))
      const recentRows = (capiLogs ?? []).map((row) => ({
        id: row.id,
        created_at: row.created_at,
        status: row.status as 'sent' | 'skipped' | 'error',
        skip_reason: row.skip_reason,
        event_name: row.event_name,
        http_status: row.http_status,
        fb_trace_id: row.fb_trace_id,
        error_message: row.error_message,
        page_name: row.page_id ? pageNameById.get(row.page_id) ?? null : null,
      }))

      body = (
        <>
          <ConnectedView pages={pages} />
          <CapiSection pages={capiPages} recentRows={recentRows} />
        </>
      )
    }
  }

  return (
    <section className="space-y-4">
      <ErrorBanner code={error} detail={detail} />
      {body}
    </section>
  )
}
