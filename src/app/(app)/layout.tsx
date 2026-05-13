import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { createClient } from '@/lib/supabase/server'
import { Sidebar } from './_components/sidebar'
import { Topbar } from './_components/topbar'
import { SuggestionsToast } from './dashboard/leads/_components/SuggestionsToast.client'
import { countPendingSuggestions } from './dashboard/leads/actions/suggestions'

export default function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="ws-app">
      <Suspense fallback={<Sidebar />}>
        <SidebarWithSession />
      </Suspense>
      <div className="flex flex-1 flex-col min-w-0">
        <Suspense fallback={<TopbarFallback />}>
          <TopbarWithSession />
        </Suspense>
        <main className="flex-1 px-8 py-6 min-w-0">{children}</main>
      </div>
      <SuggestionsToast />
    </div>
  )
}

async function SidebarWithSession() {
  const session = await getSession()
  if (!session) redirect('/login')
  const initial = (session.fullName || 'A').trim().charAt(0).toUpperCase() || 'A'
  const supabase = await createClient()
  const { data: conn } = await supabase
    .from('facebook_connections')
    .select('id')
    .eq('user_id', session.userId)
    .maybeSingle()
  let hasFacebookPage = false
  if (conn) {
    const { count } = await supabase
      .from('facebook_pages')
      .select('id', { count: 'exact', head: true })
      .eq('connection_id', conn.id)
    hasFacebookPage = (count ?? 0) > 0
  }
  let pendingSuggestionCount = 0
  try {
    pendingSuggestionCount = await countPendingSuggestions()
  } catch {
    // transient failure — leave count at 0
  }
  return (
    <Sidebar
      userInitial={initial}
      userName={session.fullName || 'Account'}
      hasFacebookPage={hasFacebookPage}
      pendingSuggestionCount={pendingSuggestionCount}
    />
  )
}

async function TopbarWithSession() {
  const session = await getSession()
  if (!session) redirect('/login')
  return <Topbar fullName={session.fullName} />
}

function TopbarFallback() {
  return (
    <header className="flex items-center justify-between border-b border-[#E8E6DE] bg-[var(--ws-bg)] px-6 py-3">
      <div className="text-[14px] text-[#6B6960]">Welcome back</div>
      <div className="flex items-center gap-4">
        <span className="h-4 w-24 rounded bg-[#EFEEE8] animate-pulse" />
        <span className="h-7 w-20 rounded-full bg-[#EFEEE8] animate-pulse" />
      </div>
    </header>
  )
}
