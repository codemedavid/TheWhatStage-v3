import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { Sidebar } from './_components/sidebar'
import { Topbar } from './_components/topbar'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <div className="flex min-h-screen bg-[#F9FAFB]">
      <Sidebar activeHref="/dashboard" />
      <div className="flex flex-1 flex-col">
        <Topbar fullName={session.fullName} />
        <main className="flex-1 px-8 py-6">{children}</main>
      </div>
    </div>
  )
}
