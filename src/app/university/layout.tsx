import type { Metadata } from 'next'
import { getSession } from '@/lib/auth/get-session'
import { getViewer } from '@/lib/university/access'
import { UniversityShell, UniversityFooter } from './_components/UniversityShell'

export const metadata: Metadata = {
  title: 'WhatStage University',
  description:
    'Free courses on chatbots, action pages, and Messenger growth — plus a Pro track for the full playbook.',
}

const NAV = [
  { href: '/university', label: 'Courses' },
  { href: '/university/pricing', label: 'Pricing' },
]

function initialsFrom(name: string, email: string): string {
  const source = name.trim() || email.trim()
  if (!source) return '–'
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

export default async function UniversityLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await getSession()
  const viewer = getViewer(session)
  const user = session
    ? {
        name: session.fullName || session.email,
        initials: initialsFrom(session.fullName, session.email),
      }
    : undefined

  return (
    <div data-university-root style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <UniversityShell viewer={viewer} user={user} nav={NAV} />
      <main style={{ flex: 1 }}>{children}</main>
      <UniversityFooter />
    </div>
  )
}
