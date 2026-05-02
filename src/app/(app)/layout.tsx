import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { Sidebar } from './_components/sidebar'
import { Topbar } from './_components/topbar'

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
    </div>
  )
}

async function SidebarWithSession() {
  const session = await getSession()
  if (!session) redirect('/login')
  const initial = (session.fullName || 'A').trim().charAt(0).toUpperCase() || 'A'
  return <Sidebar userInitial={initial} userName={session.fullName || 'Account'} />
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
