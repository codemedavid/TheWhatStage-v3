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
    <section className="space-y-4">
      <ErrorBanner code={error} />
      {body}
    </section>
  )
}
